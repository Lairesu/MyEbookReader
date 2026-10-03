// highlights.js - step 1: select text, pick a color, change color, delete
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
  hlEl("hl-panel")?.classList.add("hidden");
  hlBookId = null;
  highlights = [];
}

function drawHighlight(h) {
  rendition.annotations.remove(h.cfiRange, "highlight"); // avoid duplicates
  rendition.annotations.highlight(
    h.cfiRange,
    {},
    () => openBar({ cfiRange: h.cfiRange, contents: null, existing: h }),
    "hl",
    { fill: HL_COLORS[h.color] || h.color, "fill-opacity": "0.4" },
  );
}

function openBar(state) {
  activeHl = state;
  hlEl("hl-delete").style.display = state.existing ? "inline-block" : "none";
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
  rendition.annotations.remove(h.cfiRange, "highlight");
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
  hlEl("hl-list-btn").addEventListener("click", () => {
    renderHlPanel();
    hlEl("hl-panel").classList.remove("hidden");
  });
  hlEl("close-hl-panel").addEventListener("click", () =>
    hlEl("hl-panel").classList.add("hidden"),
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
  hlEl("hl-panel-title").textContent = `Highlights (${highlights.length})`;

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

    const del = document.createElement("button");
    del.className = "note-del";
    del.textContent = "✕";
    del.addEventListener("click", async (e) => {
      e.stopPropagation(); // don't also jump to it
      if (!confirm("Delete this highlight?")) return;
      rendition.annotations.remove(h.cfiRange, "highlight");
      highlights = highlights.filter((x) => x !== h);
      await saveHighlights();
      renderHlPanel();
    });
    row.append(del);

    row.addEventListener("click", () => {
      rendition?.display(h.cfiRange);
      hlEl("hl-panel").classList.add("hidden");
    });
    list.append(row);
  });
}
