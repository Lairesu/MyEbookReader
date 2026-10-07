// library.js - status filter, shelves (tags) and drag-and-drop adding
// Uses globals from app.js: library, saveLibrary, renderLibrary, addFiles, libraryView,
// isFinished, toggleSelectMode

let libFilter = { status: "all", shelf: "" }; // shelf: "" = all, "__none" = books without a shelf
const libEl = (id) => document.getElementById(id);

function statusOf(b) {
  if (isFinished(b)) return "finished";
  if (!b.cfi && !(b.percent > 0)) return "unread";
  return "reading";
}

const shelvesOf = (b) => (Array.isArray(b.shelves) ? b.shelves : []);

function allShelves() {
  const set = new Set();
  Object.values(library).forEach((b) =>
    shelvesOf(b).forEach((s) => set.add(s)),
  );
  return [...set].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

// keeps only the books that match the chosen status and shelf
function applyFilters(ids) {
  const shelves = allShelves();
  if (
    libFilter.shelf &&
    libFilter.shelf !== "__none" &&
    !shelves.includes(libFilter.shelf)
  ) {
    libFilter.shelf = ""; // that shelf no longer exists
  }
  return ids.filter((id) => {
    const b = library[id];
    if (libFilter.status !== "all" && statusOf(b) !== libFilter.status)
      return false;
    if (libFilter.shelf === "__none") return !shelvesOf(b).length;
    if (libFilter.shelf) return shelvesOf(b).includes(libFilter.shelf);
    return true;
  });
}

// called at the end of renderLibrary: counts on the chips, shelf list, storage banner
function afterLibraryRender() {
  const ids = Object.keys(library);
  const counts = { all: ids.length, reading: 0, unread: 0, finished: 0 };
  ids.forEach((id) => counts[statusOf(library[id])]++);
  document.querySelectorAll("#status-chips .chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.status === libFilter.status);
    c.textContent = `${c.dataset.label} ${counts[c.dataset.status]}`;
  });

  const sel = libEl("shelf-filter");
  const shelves = allShelves();
  sel.innerHTML = "";
  const add = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sel.append(o);
  };
  add("", "All shelves");
  shelves.forEach((s) => add(s, s));
  if (shelves.length) add("__none", "No shelf");
  sel.value = libFilter.shelf;
  sel.style.display = shelves.length ? "" : "none";

  renderStorage();
}

function parseShelves(text) {
  const known = allShelves();
  const seen = new Map(); // lowercase -> spelling; reuses the spelling of an existing shelf
  text
    .split(",")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .forEach((s) => {
      const key = s.toLowerCase();
      if (seen.has(key)) return;
      seen.set(key, known.find((k) => k.toLowerCase() === key) || s);
    });
  return [...seen.values()];
}

// mode "set": replace the shelves of one book. mode "add": add shelves to many books
async function editShelves(ids, mode) {
  const existing = allShelves();
  const hint = existing.length
    ? "\nExisting shelves: " + existing.join(", ")
    : "";

  if (mode === "set") {
    const current = shelvesOf(library[ids[0]]).join(", ");
    const text = prompt(
      "Shelves for this book (separate with commas, empty to remove all):" +
        hint,
      current,
    );
    if (text === null) return false;
    library[ids[0]].shelves = parseShelves(text);
  } else {
    const text = prompt(
      `Add ${ids.length} book(s) to shelves (separate with commas):` + hint,
      "",
    );
    const names = text ? parseShelves(text) : [];
    if (!names.length) return false;
    ids.forEach((id) => {
      library[id].shelves = [...new Set([...shelvesOf(library[id]), ...names])];
    });
  }
  await saveLibrary();
  renderLibrary();
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  libEl("status-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    libFilter.status = chip.dataset.status;
    renderLibrary();
  });
  libEl("shelf-filter").addEventListener("change", (e) => {
    libFilter.shelf = e.target.value;
    renderLibrary();
  });
  libEl("shelf-selected-btn").addEventListener("click", async () => {
    const ids = Array.from(
      document.querySelectorAll(".book-checkbox:checked"),
    ).map((cb) => cb.dataset.id);
    if (!ids.length) return alert("No books selected");
    if (await editShelves(ids, "add")) toggleSelectMode(false);
  });
});

// drag and drop: drop .epub files anywhere on the library screen
let dragDepth = 0; // dragenter/dragleave also fire for child elements, so count them
const dragHasFiles = (e) =>
  Array.from(e.dataTransfer?.types || []).includes("Files");
const dropOverlay = () => libEl("drop-overlay");

document.addEventListener("dragenter", (e) => {
  if (!dragHasFiles(e) || libraryView.classList.contains("hidden")) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay().classList.remove("hidden");
});
document.addEventListener("dragover", (e) => {
  if (dragHasFiles(e)) e.preventDefault(); // needed, or the browser opens the file instead
});
document.addEventListener("dragleave", (e) => {
  if (!dragHasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay().classList.add("hidden");
});
document.addEventListener("drop", (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay().classList.add("hidden");
  if (libraryView.classList.contains("hidden")) return; // reading a book, ignore
  const files = Array.from(e.dataTransfer.files).filter((f) =>
    /\.epub$/i.test(f.name),
  );
  if (!files.length) return alert("Only .epub files can be added.");
  addFiles(files);
});
