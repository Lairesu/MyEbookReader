// global variables - State
let book = null;
let rendition = null;
let currentBookId = null;
let library = {};
let settings = { fontSize: 100, theme: "light" };
let saveTimer = null;

const $ = (id) => document.getElementById(id);
const libraryView = $("library-view");
const readerView = $("reader-view");
const bookList = $("book-list");
const continueSection = $("continue-section");
const emptyMessage = $("empty-message");
const fileInput = $("file-input");
const settingsPanel = $("settings-panel");
const progressFill = $("progress-fill");
const progressText = $("progress-text");
const fontSizeValue = $("font-size-value");

// storage helpers
const saveLibrary = () => localforage.setItem("library", library);
const saveSettings = () => localforage.setItem("settings", settings);

// moving old single-"books" storage into the new split format which runs once
async function migrate() {
  const old = await localforage.getItem("books");
  if (!old) return;
  const lib = (await localforage.getItem("library")) || {};
  for (const [id, b] of Object.entries(old)) {
    await localforage.setItem("file-" + id, b.data);
    lib[id] = {
      title: b.title,
      author: b.author,
      addedAt: b.addedAt || Date.now(),
      lastOpened: 0,
      cfi: b.lastLocation || null,
      percent: 0,
    };
  }
  await localforage.setItem("library", lib);
  await localforage.removeItem("books"); // only after everything succeeded
}

// starting
document.addEventListener("DOMContentLoaded", async () => {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.log("SW registration failed:", err);
    }
  }
  navigator.storage?.persist?.();

  settings = {
    ...settings,
    ...((await localforage.getItem("settings")) || {}),
  };
  applyBodyTheme(settings.theme);
  fontSizeValue.textContent = settings.fontSize + "%";

  await migrate();
  library = (await localforage.getItem("library")) || {};
  renderLibrary();

  $("add-book-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileSelect);
  $("back-btn").addEventListener("click", showLibrary);
  $("menu-btn").addEventListener("click", () =>
    settingsPanel.classList.remove("hidden"),
  );
  $("close-settings").addEventListener("click", () =>
    settingsPanel.classList.add("hidden"),
  );
  $("prev-btn").addEventListener("click", () => rendition?.prev());
  $("next-btn").addEventListener("click", () => rendition?.next());
  $("font-decrease").addEventListener("click", () => changeFontSize(-10));
  $("font-increase").addEventListener("click", () => changeFontSize(10));
  document
    .querySelectorAll(".theme-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => setTheme(btn.dataset.theme)),
    );

  document.addEventListener("keydown", (e) => {
    if (readerView.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") rendition?.prev();
    if (e.key === "ArrowRight") rendition?.next();
  });

  $("select-mode-btn").addEventListener("click", () =>
    toggleSelectMode(!bookList.classList.contains("select-mode")),
  );
  $("delete-selected-btn").addEventListener("click", deleteSelectedBooks);
  $("select-all").addEventListener("change", (e) => {
    document
      .querySelectorAll(".book-checkbox")
      .forEach((cb) => (cb.checked = e.target.checked));
  });
});

// Library
function makeCard(id, data, big = false) {
  const card = document.createElement("div");
  card.className = "book-card" + (big ? " continue-card" : "");

  const info = document.createElement("div");
  info.className = "book-info";
  const h3 = document.createElement("h3");
  h3.textContent = data.title || "Untitled";
  const p = document.createElement("p");
  p.textContent = data.author || "Unknown Author";
  info.append(h3, p);

  const meta = document.createElement("p");
  meta.className = "book-meta";
  const pct = Math.round((data.percent || 0) * 100);
  meta.textContent = pct > 0 ? pct + "% read" : "Not started";
  info.append(meta);

  const bar = document.createElement("div");
  bar.className = "card-progress";
  const fill = document.createElement("div");
  fill.style.width = pct + "%";
  bar.append(fill);
  info.append(bar);
  card.append(info);

  if (!big) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "book-checkbox";
    cb.dataset.id = id;
    cb.addEventListener("click", (e) => e.stopPropagation());
    card.append(cb);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "✕";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${data.title}"?`)) await deleteBooks([id]);
    });
    card.append(del);
  }

  card.addEventListener("click", () => {
    if (bookList.classList.contains("select-mode")) {
      const cb = card.querySelector(".book-checkbox");
      if (cb) cb.checked = !cb.checked;
      return;
    }
    openBook(id);
  });
  return card;
}

function renderLibrary() {
  bookList.innerHTML = "";
  continueSection.innerHTML = "";
  const ids = Object.keys(library);
  emptyMessage.style.display = ids.length ? "none" : "block";
  if (!ids.length) return;

  // Continue reading = most recently opened book that has progress
  const recent = ids
    .filter((id) => library[id].lastOpened && library[id].cfi)
    .sort((a, b) => library[b].lastOpened - library[a].lastOpened)[0];
  if (recent) {
    const label = document.createElement("h2");
    label.className = "section-label";
    label.textContent = "Continue reading";
    continueSection.append(label, makeCard(recent, library[recent], true));
  }

  ids
    .sort(
      (a, b) =>
        (library[b].lastOpened || library[b].addedAt) -
        (library[a].lastOpened || library[a].addedAt),
    )
    .forEach((id) => bookList.append(makeCard(id, library[id])));
}

async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  let added = 0;

  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const temp = ePub(buf);
      await temp.ready;
      const meta = await temp.loaded.metadata;
      temp.destroy();

      const title = (meta.title || file.name.replace(/\.epub$/i, "")).trim();
      const author = meta.creator || "Unknown Author";

      const dup = Object.values(library).some(
        (b) => b.title.toLowerCase() === title.toLowerCase(),
      );
      if (dup && !confirm(`"${title}" already exists.\nAdd it anyway?`))
        continue;

      const id =
        "book_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      await localforage.setItem("file-" + id, buf);
      library[id] = {
        title,
        author,
        addedAt: Date.now(),
        lastOpened: 0,
        cfi: null,
        percent: 0,
      };
      added++;
    } catch (err) {
      console.error("Failed to load:", file.name, err);
      alert(
        `Failed to load "${file.name}"` +
          (err?.name === "QuotaExceededError" ? " (storage full)" : ""),
      );
    }
  }

  await saveLibrary();
  renderLibrary();
  fileInput.value = "";
  if (added) alert(`${added} book(s) added.`);
}

async function deleteBooks(ids) {
  for (const id of ids) {
    delete library[id];
    await localforage.removeItem("file-" + id);
    await localforage.removeItem("locations-" + id);
  }
  await saveLibrary();
  renderLibrary();
}

function toggleSelectMode(enable) {
  bookList.classList.toggle("select-mode", enable);
  $("select-controls").style.display = enable ? "block" : "none";
  $("delete-selected-btn").style.display = enable ? "inline-block" : "none";
  $("select-mode-btn").textContent = enable ? "Cancel" : "Select";
  $("select-all").checked = false;
  document
    .querySelectorAll(".book-checkbox")
    .forEach((cb) => (cb.checked = false));
}

async function deleteSelectedBooks() {
  const ids = Array.from(
    document.querySelectorAll(".book-checkbox:checked"),
  ).map((cb) => cb.dataset.id);
  if (!ids.length) return alert("No books selected");
  if (!confirm(`Delete ${ids.length} book(s)?`)) return;
  await deleteBooks(ids);
  toggleSelectMode(false);
}

// Reader functions
async function openBook(id) {
  try {
    const buf = await localforage.getItem("file-" + id);
    if (!buf) return alert("Book file not found");

    destroyBook();
    currentBookId = id;
    libraryView.classList.add("hidden");
    readerView.classList.remove("hidden");
    $("book-title").textContent = library[id].title || "Untitled";
    $("viewer").innerHTML = "";
    progressFill.style.width = (library[id].percent || 0) * 100 + "%";
    progressText.textContent = "";

    const thisBook = ePub(buf);
    book = thisBook;
    await thisBook.ready;

    rendition = thisBook.renderTo("viewer", {
      width: "100%",
      height: "100%",
      flow: "paginated",
      manager: "default",
    });
    applyReaderTheme(settings.theme);
    rendition.themes.fontSize(settings.fontSize + "%");

    rendition.on("relocated", (loc) => onRelocated(id, loc));
    await rendition.display(library[id].cfi || undefined);
    setTimeout(() => rendition?.resize(), 150);

    library[id].lastOpened = Date.now();
    saveLibrary();

    prepareBookStats(id, thisBook); // locations + word count, in background
  } catch (err) {
    console.error("Error opening book:", err);
    alert("Failed to open book: " + err.message);
    showLibrary();
  }
}

function onRelocated(id, loc) {
  if (id !== currentBookId || !book) return;

  library[id].cfi = loc.start.cfi; // position is always saved
  library[id].lastOpened = Date.now();

  const pct = getPercent(loc);
  if (pct === null) {
    progressText.textContent = "Calculating progress…"; // bar stays where it was
  } else {
    library[id].percent = pct;
    updateProgressUI(id, pct);
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLibrary, 500);
}

function getPercent(loc) {
  if (!book.locations?.length()) return null; // not ready yet
  const p = book.locations.percentageFromCfi(loc.start.cfi);
  return Number.isFinite(p) ? p : null;
}

function updateProgressUI(id, pct) {
  progressFill.style.width = pct * 100 + "%";
  const words = library[id].words;
  let text = Math.round(pct * 100) + "%";
  if (words) {
    const mins = Math.round((words * (1 - pct)) / 230);
    text += ` · ${words.toLocaleString()} words · ${mins >= 60 ? Math.floor(mins / 60) + "h " + (mins % 60) + "m" : mins + "m"} left`;
  }
  progressText.textContent = text;
}

async function prepareBookStats(id, thisBook) {
  try {
    // Locations (cached so it's only slow once)
    const saved = await localforage.getItem("locations-" + id);
    if (saved) thisBook.locations.load(saved);
    else {
      await thisBook.locations.generate(1600);
      if (book === thisBook)
        await localforage.setItem("locations-" + id, thisBook.locations.save());
    }
    if (book !== thisBook) return;

    // Word count (once per book)
    if (!library[id].words) {
      let total = 0;
      for (const item of thisBook.spine.spineItems) {
        if (book !== thisBook) return;
        const doc = await item.load(thisBook.load.bind(thisBook));
        const text = item.document?.body?.textContent ?? doc?.textContent ?? "";
        total += (text.match(/\S+/g) || []).length;
        item.unload();
      }
      library[id].words = total;
      saveLibrary();
    }

    const loc = rendition?.currentLocation();
    if (loc?.start) onRelocated(id, loc);
  } catch (err) {
    console.error("Stats failed:", err);
  }
}

function destroyBook() {
  if (book) {
    try {
      book.destroy();
    } catch (e) {}
  }
  book = null;
  rendition = null;
}

async function showLibrary() {
  clearTimeout(saveTimer);
  await saveLibrary();
  destroyBook();
  currentBookId = null;
  readerView.classList.add("hidden");
  libraryView.classList.remove("hidden");
  settingsPanel.classList.add("hidden");
  renderLibrary();
}

//  SETTINGS
function changeFontSize(delta) {
  settings.fontSize = Math.max(70, Math.min(160, settings.fontSize + delta));
  fontSizeValue.textContent = settings.fontSize + "%";
  rendition?.themes.fontSize(settings.fontSize + "%");
  saveSettings();
}

function applyBodyTheme(theme) {
  document.body.className = theme === "light" ? "" : "theme-" + theme;
}

function applyReaderTheme(theme) {
  if (!rendition) return;
  const colors = {
    dark: ["#e0e0e0", "#1a1a1a"],
    sepia: ["#5b4636", "#f4ecd8"],
    light: ["#000", "#fff"],
  }[theme] || ["#000", "#fff"];
  rendition.themes.override("color", colors[0]);
  rendition.themes.override("background", colors[1]);
}

function setTheme(theme) {
  settings.theme = theme;
  applyBodyTheme(theme);
  applyReaderTheme(theme);
  saveSettings();
}
