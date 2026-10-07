// state
let book = null;
let rendition = null;
let currentBookId = null;
let library = {}; // id -> {title, author, addedAt, lastOpened, cfi, percent, words}
let settings = {
  fontSize: 100,
  theme: "light",
  fontFamily: "original",
  lineHeight: 0,
  keepAwake: true,
  dim: 0, // reading overlay: darkness in % (0-70)
  warm: 0, // reading overlay: warm tint in % (0-80)
};
let coverUrls = {}; // id -> blob url of the small cover image
let saveTimer = null;

const FINISHED_AT = 0.98; // a book counts as finished from this progress on
const isFinished = (b) => (b.percent || 0) >= FINISHED_AT;

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

// Move old single-"books" storage into the new split format (runs once)
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

// startup
document.addEventListener("DOMContentLoaded", async () => {
  registerServiceWorker();

  settings = {
    ...settings,
    ...((await localforage.getItem("settings")) || {}),
  };
  applyBodyTheme(settings.theme);
  fontSizeValue.textContent = settings.fontSize + "%";
  $("font-family-select").value = settings.fontFamily;
  $("line-height-select").value = String(settings.lineHeight);
  $("keep-awake").checked = settings.keepAwake;
  applyOverlay();

  await migrate();
  library = (await localforage.getItem("library")) || {};
  backfillFinished(); // stats.js: finish dates for books that were already finished
  await loadCovers();
  renderLibrary();
  backfillCovers(); // books without a cover get one in the background
  queueUnpreparedBooks(); // prepare.js: page locations and word counts, in the background
  initStorage(); // storage.js: ask the browser to keep our data

  $("update-reload").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    await saveLibrary(); // don't lose the reading position by reloading
    location.reload();
  });
  $("update-dismiss").addEventListener("click", () =>
    $("update-toast").classList.add("hidden"),
  );

  $("add-book-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileSelect);
  $("back-btn").addEventListener("click", leaveReader);
  $("menu-btn").addEventListener("click", () =>
    settingsPanel.classList.remove("hidden"),
  );
  $("close-settings").addEventListener("click", () =>
    settingsPanel.classList.add("hidden"),
  );
  $("prev-btn").addEventListener("click", () => turnPage(-1));
  $("next-btn").addEventListener("click", () => turnPage(1));
  $("font-decrease").addEventListener("click", () => changeFontSize(-10));
  $("font-increase").addEventListener("click", () => changeFontSize(10));
  document
    .querySelectorAll(".theme-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => setTheme(btn.dataset.theme)),
    );

  document.addEventListener("keydown", (e) => {
    if (readerView.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") turnPage(-1);
    if (e.key === "ArrowRight") turnPage(1);
  });

  $("font-family-select").addEventListener("change", (e) => {
    settings.fontFamily = e.target.value;
    saveSettings();
    updateReadingStyle();
  });
  $("line-height-select").addEventListener("change", (e) => {
    settings.lineHeight = parseFloat(e.target.value);
    saveSettings();
    updateReadingStyle();
  });
  $("keep-awake").addEventListener("change", (e) => {
    settings.keepAwake = e.target.checked;
    saveSettings();
    setWakeLock(settings.keepAwake && !!book);
  });

  // dim and warm overlay: update live while sliding, save when let go
  $("dim-range").addEventListener("input", (e) => {
    settings.dim = Number(e.target.value);
    applyOverlay();
  });
  $("warm-range").addEventListener("input", (e) => {
    settings.warm = Number(e.target.value);
    applyOverlay();
  });
  ["dim-range", "warm-range"].forEach((id) =>
    $(id).addEventListener("change", saveSettings),
  );

  // phone back button: close what is open on top, then leave the book
  window.addEventListener("popstate", () => {
    if (readerView.classList.contains("hidden")) return; // already in the library
    if (closeTopOverlay()) {
      history.pushState({ reader: true }, ""); // stay in the book
      return;
    }
    showLibrary();
  });
  document.addEventListener("visibilitychange", () => {
    // the browser drops the wake lock when the app is hidden, so ask again on return
    if (!document.hidden && book && settings.keepAwake) setWakeLock(true);
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

// tell the user when a new version of the app has been deployed
async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");

    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      worker?.addEventListener("statechange", () => {
        // a controller only exists when this is an update, not the very first install
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          $("update-toast").classList.remove("hidden");
        }
      });
    });

    // installed phone apps stay alive in the background, so check again when it comes back
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  } catch (err) {
    console.log("SW registration failed:", err);
  }
}

// library
function makeCoverEl(id, data) {
  const hasCover = !!coverUrls[id];
  const cover = document.createElement(hasCover ? "img" : "div");
  cover.className = "cover" + (hasCover ? "" : " cover-empty");
  if (hasCover) {
    cover.src = coverUrls[id];
    cover.alt = "";
  } else {
    cover.textContent = (data.title || "?").trim().charAt(0).toUpperCase();
  }
  return cover;
}

// swap the placeholder for the real cover once it has been found
function setCardCover(id) {
  document.querySelectorAll(`.book-card[data-id="${id}"]`).forEach((card) => {
    card.querySelector(".cover")?.replaceWith(makeCoverEl(id, library[id]));
  });
}

function makeCard(id, data, big = false) {
  const card = document.createElement("div");
  card.className = "book-card" + (big ? " continue-card" : "");
  card.dataset.id = id;
  if (!big && isFinished(data)) card.classList.add("finished");
  const pct = Math.round((data.percent || 0) * 100);

  // the cover fills the card; progress, checkbox and delete button sit on top of it
  const wrap = document.createElement("div");
  wrap.className = "cover-wrap";
  wrap.append(makeCoverEl(id, data));
  if (!big && isFinished(data)) {
    const badge = document.createElement("span");
    badge.className = "finished-badge";
    badge.textContent = "\u2713 Finished";
    wrap.append(badge);
  }
  card.append(wrap);

  const info = document.createElement("div");
  info.className = "book-info";
  info.title = `${data.title || "Untitled"} - ${data.author || "Unknown Author"}`;
  const h3 = document.createElement("h3");
  h3.textContent = data.title || "Untitled";
  info.append(h3);

  const bar = document.createElement("div");
  bar.className = "card-progress";
  const fill = document.createElement("div");
  fill.style.width = pct + "%";
  bar.append(fill);

  if (big) {
    const p = document.createElement("p");
    p.textContent = data.author || "Unknown Author";
    const meta = document.createElement("p");
    meta.className = "book-meta";
    meta.textContent = pct > 0 ? pct + "% read" : "Not started";
    info.append(p, meta, bar);
  } else if (pct > 0) {
    wrap.append(bar);
  }
  card.append(info);

  if (!big) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "book-checkbox";
    cb.dataset.id = id;
    cb.addEventListener("click", (e) => e.stopPropagation());
    wrap.append(cb);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.innerHTML = ICONS.close;
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${data.title}"?`)) await deleteBooks([id]);
    });
    wrap.append(del);

    const shelf = document.createElement("button");
    shelf.className = "shelf-btn";
    shelf.innerHTML = ICONS.tag;
    shelf.title = "Shelves";
    shelf.addEventListener("click", (e) => {
      e.stopPropagation();
      editShelves([id], "set"); // library.js
    });
    wrap.append(shelf);
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
  $("filter-bar").style.display = ids.length ? "" : "none";
  if (!ids.length) {
    afterLibraryRender(); // library.js
    return;
  }

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

  const shown = applyFilters(ids).sort(
    (a, b) =>
      (library[b].lastOpened || library[b].addedAt) -
      (library[a].lastOpened || library[a].addedAt),
  );
  shown.forEach((id) => bookList.append(makeCard(id, library[id])));
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "filter-empty";
    p.textContent = "No books match this filter.";
    bookList.append(p);
  }
  afterLibraryRender(); // library.js: chip counts, shelf list
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  fileInput.value = ""; // allows picking the same file again
  return addFiles(files);
}

// used by the file picker and by drag and drop (library.js)
async function addFiles(files) {
  if (!files.length) return;
  const newIds = [];

  for (const [i, file] of files.entries()) {
    showPrepNotice(`Adding book ${i + 1} of ${files.length}\u2026`); // prepare.js
    try {
      const buf = await file.arrayBuffer();
      const temp = ePub(buf);
      await temp.ready;
      const meta = await temp.loaded.metadata;
      // never let a slow or broken cover stop the book from being added
      const cover = await Promise.race([
        makeCoverThumb(temp, buf), // must happen before destroy
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
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
      if (cover) {
        await localforage.setItem("cover-" + id, cover);
        coverUrls[id] = URL.createObjectURL(cover);
      }
      library[id] = {
        title,
        author,
        addedAt: Date.now(),
        lastOpened: 0,
        cfi: null,
        percent: 0,
        coverV: 2,
        noCover: !cover,
      };
      newIds.push(id);
    } catch (err) {
      console.error("Failed to load:", file.name, err);
      alert(
        `Failed to load "${file.name}"` +
          (err?.name === "QuotaExceededError" ? " (storage full)" : ""),
      );
    }
  }

  clearPrepNotice();
  await saveLibrary();
  renderLibrary();
  if (newIds.length) {
    requestPersist(); // storage.js: more books means more to lose
    queueBookPrep(newIds); // prepare.js: calculated in the background, several at once
  }
}

async function deleteBooks(ids) {
  for (const id of ids) {
    cancelBookPrep(id); // prepare.js: stop preparing it if that was still running
    delete library[id];
    await localforage.removeItem("file-" + id);
    await localforage.removeItem("locations-" + id);
    await localforage.removeItem("notes-" + id);
    await localforage.removeItem("cover-" + id);
    if (coverUrls[id]) URL.revokeObjectURL(coverUrls[id]);
    delete coverUrls[id];
  }
  await saveLibrary();
  renderLibrary();
}

function toggleSelectMode(enable) {
  bookList.classList.toggle("select-mode", enable);
  $("select-controls").style.display = enable ? "block" : "none";
  $("delete-selected-btn").style.display = enable ? "inline-block" : "none";
  $("shelf-selected-btn").style.display = enable ? "inline-block" : "none";
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

// reader
async function openBook(id) {
  try {
    const buf = await localforage.getItem("file-" + id);
    if (!buf) return alert("Book file not found");

    destroyBook();
    currentBookId = id;
    libraryView.classList.add("hidden");
    readerView.classList.remove("hidden");
    history.pushState({ reader: true }, ""); // so the phone back button returns to the library
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
    rendition.hooks.content.register(applyReadingStyle); // font and spacing for every page

    rendition.on("relocated", (loc) => onRelocated(id, loc));

    // swipe left = next page, swipe right = previous page
    let touchX = 0;
    let touchY = 0;
    rendition.on("touchstart", (e) => {
      touchX = e.changedTouches[0].screenX;
      touchY = e.changedTouches[0].screenY;
    });
    rendition.on("touchend", (e, contents) => {
      // skip while text is selected, so highlighting doesn't turn the page
      if (contents?.window.getSelection().toString()) return;
      const dx = e.changedTouches[0].screenX - touchX;
      const dy = e.changedTouches[0].screenY - touchY;
      // must be long enough and mostly horizontal, so taps and scrolling are ignored
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      turnPage(dx < 0 ? 1 : -1);
    });
    const cachedLoc = await localforage.getItem("locations-" + id);
    const locOk = hasValidLocations(cachedLoc); // prepare.js
    if (locOk) thisBook.locations.load(cachedLoc);
    await rendition.display(library[id].cfi || undefined);
    setTimeout(() => rendition?.resize(), 150);
    initHighlights(id);
    setWakeLock(settings.keepAwake);

    library[id].lastOpened = Date.now();
    // not prepared yet (for example added before this update): prepare.js does it now, first in line
    if (locOk && library[id].words) library[id].prepV = PREP_VERSION;
    else queueBookPrep([id], { urgent: true });
    saveLibrary();
  } catch (err) {
    console.error("Error opening book:", err);
    alert("Failed to open book: " + err.message);
    leaveReader();
  }
}

// slide the old page out, turn, then slide the new page in from the other side
let turning = false;
async function turnPage(dir) {
  if (!rendition || turning) return; // ignore taps while a turn is running
  turning = true;
  const v = $("viewer");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    v.style.transition = "transform 110ms ease-in, opacity 110ms ease-in";
    v.style.transform = `translateX(${-dir * 20}px)`;
    v.style.opacity = "0";
    await wait(100);

    await (dir > 0 ? rendition.next() : rendition.prev());

    v.style.transition = "none"; // jump to the entry side without animating
    v.style.transform = `translateX(${dir * 20}px)`;
    void v.offsetWidth; // force the browser to apply it before animating back
    v.style.transition = "transform 160ms ease-out, opacity 160ms ease-out";
    v.style.transform = "translateX(0)";
    v.style.opacity = "1";
    await wait(150);
  } finally {
    // always leave the page visible, even if the turn failed
    v.style.transition = "";
    v.style.transform = "";
    v.style.opacity = "";
    turning = false;
  }
}

function onRelocated(id, loc) {
  if (id !== currentBookId || !book) return;
  library[id].cfi = loc.start.cfi;
  library[id].lastOpened = Date.now();
  const pct = getPercent(loc);
  if (pct === null)
    progressText.textContent = prepProgressLabel(id); // prepare.js
  else {
    library[id].percent = pct;
    updateProgressUI(id, pct);
    if (pct >= FINISHED_AT && !library[id].finishedAt)
      library[id].finishedAt = Date.now(); // used by the dashboard
  }
  noteActivity(); // stats.js: a page turn counts as reading
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLibrary, 500); // debounce writes
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

function destroyBook() {
  closeHighlights();
  setWakeLock(false);
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

// settings
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

// back button: use the browser history so the phone's back gesture works too
function leaveReader() {
  if (history.state?.reader)
    history.back(); // triggers popstate, which shows the library
  else showLibrary();
}

function closeTopOverlay() {
  if (!$("lightbox").classList.contains("hidden")) {
    $("lightbox").classList.add("hidden");
    return true;
  }
  if ($("drawer").classList.contains("open")) {
    closeDrawer();
    return true;
  }
  if (!settingsPanel.classList.contains("hidden")) {
    settingsPanel.classList.add("hidden");
    return true;
  }
  if (!$("hl-bar").classList.contains("hidden")) {
    closeBar();
    return true;
  }
  return false;
}

// dim and warm overlay: two layers on top of the reader (see #reader-overlay in index.html)
function applyOverlay() {
  const o = $("reader-overlay").style;
  o.setProperty("--dim", settings.dim / 100);
  o.setProperty("--warm", settings.warm / 100);
  $("dim-range").value = settings.dim;
  $("warm-range").value = settings.warm;
  $("dim-value").textContent = settings.dim + "%";
  $("warm-value").textContent = settings.warm + "%";
}

// keep the screen awake while a book is open
let wakeLock = null;
async function setWakeLock(on) {
  try {
    if (on && "wakeLock" in navigator) {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) {
    console.log("Wake lock not available:", err);
  }
}

// font and line spacing are injected into every page of the book
const FONT_STACKS = {
  original: "",
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"Courier New", Courier, monospace',
};

function readingCss() {
  let css = "";
  const font = FONT_STACKS[settings.fontFamily];
  if (font)
    css += `html body, html body * { font-family: ${font} !important; }\n`;
  if (settings.lineHeight)
    css += `html body, html body * { line-height: ${settings.lineHeight} !important; }\n`;
  return css; // empty = leave the book's own look alone
}

function applyReadingStyle(contents) {
  const doc = contents.document;
  let el = doc.getElementById("reading-style");
  if (!el) {
    el = doc.createElement("style");
    el.id = "reading-style";
    doc.head.appendChild(el);
  }
  el.textContent = readingCss();
}

async function updateReadingStyle() {
  if (!rendition) return;
  const cfi = rendition.currentLocation()?.start?.cfi;
  rendition.getContents().forEach(applyReadingStyle);
  rendition.resize();
  if (cfi) await rendition.display(cfi); // spacing changes the pages, so return to where we were
}

// covers: a small jpeg per book, so the library never has to open the books
async function loadCovers() {
  for (const id of Object.keys(library)) {
    if (coverUrls[id]) continue;
    const blob = await localforage.getItem("cover-" + id);
    if (blob) coverUrls[id] = URL.createObjectURL(blob);
  }
}

// bk = epub.js book, buf = the epub file (used when the book doesn't declare its cover)
async function makeCoverThumb(bk, buf) {
  let url = null;
  try {
    url = await bk.coverUrl().catch(() => null);
    if (!url && buf) url = await coverFromZip(buf);
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) return null;
    const w = 360; // sharp enough for phones with high-density screens
    const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  } catch (err) {
    console.log("No cover for this book:", err);
    return null;
  } finally {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

// many epubs don't mark their cover, but still contain an image named like "cover.jpg"
async function coverFromZip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const hits = zip.file(/cover[^/]*\.(jpe?g|png|webp|gif)$/i);
  if (!hits.length) return null;
  const entry = hits.sort((x, y) => x.name.length - y.name.length)[0];
  const ext = entry.name.split(".").pop().toLowerCase();
  const type = ext === "jpg" ? "image/jpeg" : "image/" + ext;
  return URL.createObjectURL(
    new Blob([await entry.async("arraybuffer")], { type }),
  );
}

async function ensureCover(id, bk, buf) {
  const cover = await makeCoverThumb(bk, buf);
  if (cover) {
    await localforage.setItem("cover-" + id, cover);
    if (coverUrls[id]) URL.revokeObjectURL(coverUrls[id]);
    coverUrls[id] = URL.createObjectURL(cover);
  }
  library[id].coverV = 2; // 2 = made with the current size and the zip fallback
  library[id].noCover = !cover;
}

// one book at a time, so a big library doesn't freeze the app
async function backfillCovers() {
  for (const id of Object.keys(library)) {
    if (!library[id] || library[id].coverV === 2) continue;
    let bk = null;
    try {
      const buf = await localforage.getItem("file-" + id);
      if (!buf) continue;
      bk = ePub(buf);
      await bk.ready;
      await ensureCover(id, bk, buf);
      setCardCover(id);
    } catch (err) {
      console.log("Cover backfill failed for", id, err);
    } finally {
      try {
        bk?.destroy();
      } catch (e) {}
    }
  }
  await saveLibrary();
}

// prepare.js tells the reader how the open book is doing
document.addEventListener("book-prep-progress", (e) => {
  const id = e.detail.id;
  if (id === currentBookId && book && !book.locations?.length())
    progressText.textContent = prepProgressLabel(id);
});

document.addEventListener("book-prepared", async (e) => {
  const id = e.detail.id;
  if (id !== currentBookId || !book) return;
  try {
    if (!book.locations?.length()) {
      const saved = await localforage.getItem("locations-" + id);
      if (id !== currentBookId || !book) return; // left the book meanwhile
      if (hasValidLocations(saved)) book.locations.load(saved);
    }
    const loc = rendition?.currentLocation();
    if (loc?.start) onRelocated(id, loc); // shows the real percentage, words and time left
  } catch (err) {
    console.error("Could not show the new progress:", err);
  }
});

document.addEventListener("book-prep-failed", (e) => {
  if (e.detail.id === currentBookId)
    progressText.textContent = prepProgressLabel(e.detail.id);
});
