// Uses globals from app.js: book, rendition, currentBookId

const HL_COLORS = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

let highlights = []; // { cfiRange, color, text, note, createdAt }
let hlBookId = null;
let activeHl = null; // { cfiRange, contents, existing }

const hlEl = (id) => document.getElementById(id);
const saveHighlights = () =>
  localforage.setItem("notes-" + hlBookId, { highlights });

async function initHighlights(id) {
  const stored = await localforage.getItem("notes-" + id);
  if (id !== currentBookId || !rendition) return; // user already left
  hlBookId = id;
  highlights = stored?.highlights || [];
  highlights.forEach(drawHighlight);
  rendition.on("selected", (cfiRange, contents) =>
    openBar({ cfiRange, contents, existing: null }),
  );
  rendition.on("relocated", closeBar);
}

function closeHighlights() {
  closeBar();
  if (typeof resetDrawer === "function") resetDrawer();
  hlBookId = null;
  highlights = [];
}

function drawHighlight(h) {
  eraseHighlight(h); // avoid duplicates
  const open = () =>
    openBar({ cfiRange: h.cfiRange, contents: null, existing: h });
  rendition.annotations.highlight(h.cfiRange, {}, open, "hl", {
    fill: HL_COLORS[h.color] || h.color,
    "fill-opacity": "0.4",
  });
  // highlights with a note also get a thin underline so they stand out on the page
  if (h.note) {
    rendition.annotations.underline(h.cfiRange, {}, open, "hl-note", {
      stroke: "#555",
      "stroke-opacity": "0.8",
    });
  }
}

function eraseHighlight(h) {
  rendition.annotations.remove(h.cfiRange, "highlight");
  rendition.annotations.remove(h.cfiRange, "underline");
}

function openBar(state) {
  activeHl = state;
  hlEl("hl-delete").style.display = state.existing ? "" : "none";
  hlEl("hl-note").style.display = state.existing ? "" : "none";
  hlEl("hl-bar").classList.remove("hidden");
}

function clearSelection() {
  try {
    rendition
      ?.getContents()
      .forEach((c) => c.window.getSelection().removeAllRanges());
  } catch (e) {
    console.log("Could not clear selection:", e);
  }
}

function closeBar() {
  hlEl("hl-bar")?.classList.add("hidden");
  clearSelection();
  activeHl = null;
}

async function pickColor(name) {
  if (!activeHl) return;
  if (activeHl.existing) {
    activeHl.existing.color = name; // change color of existing highlight
    drawHighlight(activeHl.existing);
  } else {
    let text = "";
    try {
      text = (await book.getRange(activeHl.cfiRange)).toString();
    } catch (e) {}
    const h = {
      cfiRange: activeHl.cfiRange,
      color: name,
      text: text.trim(),
      note: "",
      createdAt: Date.now(),
    };
    highlights.push(h);
    drawHighlight(h);
  }
  await saveHighlights();
  closeBar();
  renderHlPanel();
}

async function deleteHighlight() {
  const h = activeHl?.existing;
  if (!h) return;
  eraseHighlight(h);
  highlights = highlights.filter((x) => x !== h);
  await saveHighlights();
  closeBar();
  renderHlPanel();
}

document.addEventListener("DOMContentLoaded", () => {
  const box = hlEl("hl-colors");
  Object.entries(HL_COLORS).forEach(([name, hex]) => {
    const dot = document.createElement("button");
    dot.className = "hl-dot";
    dot.style.background = hex;
    dot.setAttribute("aria-label", name);
    dot.addEventListener("click", () => pickColor(name));
    box.append(dot);
  });
  hlEl("hl-custom").addEventListener("change", (e) =>
    pickColor(e.target.value),
  ); // change, not input, so dragging the wheel saves once
  hlEl("hl-delete").addEventListener("click", deleteHighlight);
  hlEl("hl-note").addEventListener(
    "click",
    () => activeHl?.existing && editNoteFor(activeHl.existing),
  );
  hlEl("hl-cancel").addEventListener("click", closeBar);
});

// highlights list for the open book (each book has its own list because of the notes-<id> key)
function sortedHighlights() {
  const cfi = new ePub.CFI();
  return [...highlights].sort((a, b) => {
    try {
      return cfi.compare(a.cfiRange, b.cfiRange);
    } catch (e) {
      return a.createdAt - b.createdAt; // fall back to the order they were made
    }
  });
}

function renderHlPanel() {
  const list = hlEl("hl-list");
  if (!list) return;
  list.innerHTML = "";

  if (!highlights.length) {
    const p = document.createElement("p");
    p.className = "notes-empty";
    p.textContent =
      "No highlights in this book yet. Select some text while reading.";
    list.append(p);
    return;
  }

  sortedHighlights().forEach((h) => {
    const row = document.createElement("div");
    row.className = "note-row";
    row.style.borderLeft = `5px solid ${HL_COLORS[h.color] || h.color}`;

    const text = document.createElement("div");
    text.className = "note-text";
    text.textContent = h.text || "(highlight)";
    const date = document.createElement("div");
    date.className = "note-sub";
    date.textContent = new Date(h.createdAt).toLocaleDateString();
    row.append(text, date);

    if (h.note) {
      const note = document.createElement("div");
      note.className = "note-body";
      note.innerHTML = ICONS.note;
      const noteText = document.createElement("span");
      noteText.textContent = h.note;
      note.append(noteText);
      row.append(note);
    }

    const edit = document.createElement("button");
    edit.className = "note-edit";
    edit.innerHTML = ICONS.edit;
    edit.title = "Add or edit note";
    edit.addEventListener("click", (e) => {
      e.stopPropagation(); // don't also jump to it
      editNoteFor(h);
    });
    row.append(edit);

    const del = document.createElement("button");
    del.className = "note-del";
    del.innerHTML = ICONS.trash;
    del.addEventListener("click", async (e) => {
      e.stopPropagation(); // don't also jump to it
      if (!confirm("Delete this highlight?")) return;
      eraseHighlight(h);
      highlights = highlights.filter((x) => x !== h);
      await saveHighlights();
      renderHlPanel();
    });
    row.append(del);

    row.addEventListener("click", () => {
      rendition?.display(h.cfiRange);
      closeDrawer();
    });
    list.append(row);
  });
}

// add, change or remove (empty text) the note of one highlight
async function editNoteFor(h) {
  const text = prompt(
    "Note for this highlight (leave empty to remove):",
    h.note || "",
  );
  if (text === null) return; // cancelled
  h.note = text.trim();
  drawHighlight(h); // redraw so the underline appears or disappears
  await saveHighlights();
  closeBar();
  renderHlPanel();
}
