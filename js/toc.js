// toc.js - side drawer with three tabs: chapters, bookmarks (highlights) and images
// Uses globals from app.js: book, rendition, library, currentBookId

const dEl = (id) => document.getElementById(id);
const IMG_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

let drawerTab = "chapters";
let tocReversed = false;
let imgBookId = null; // which book the image tab was built for
let imgEntries = [];
let imgShown = 0;
let imgUrls = []; // blob urls, freed when the book changes
let imgBusy = false;

function openDrawer() {
  setDrawerTab(drawerTab);
  dEl("drawer").classList.add("open");
  dEl("drawer-backdrop").classList.add("show");
}

function closeDrawer() {
  dEl("drawer")?.classList.remove("open");
  dEl("drawer-backdrop")?.classList.remove("show");
}

// called when the book is closed
function resetDrawer() {
  closeDrawer();
  dEl("lightbox")?.classList.add("hidden");
  imgUrls.forEach((u) => URL.revokeObjectURL(u));
  imgUrls = [];
  imgEntries = [];
  imgBookId = null;
  const list = dEl("img-list");
  if (list) list.innerHTML = "";
}

function setDrawerTab(tab) {
  drawerTab = tab;
  document
    .querySelectorAll(".drawer-tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  dEl("toc-list").classList.toggle("hidden", tab !== "chapters");
  dEl("hl-list").classList.toggle("hidden", tab !== "bookmarks");
  dEl("img-list").classList.toggle("hidden", tab !== "images");
  dEl("sort-toc").style.visibility = tab === "chapters" ? "visible" : "hidden";

  if (tab === "chapters") renderToc();
  else if (tab === "bookmarks") renderHlPanel();
  else renderImages();
  renderFooter();
}

// toc links can include a #fragment and a different folder prefix than the page href
function sameFile(a, b) {
  const x = (a || "").split("#")[0];
  const y = (b || "").split("#")[0];
  return !!x && !!y && (x.endsWith(y) || y.endsWith(x));
}

function flatToc(items, out = []) {
  items.forEach((it) => {
    out.push(it);
    if (it.subitems?.length) flatToc(it.subitems, out);
  });
  return out;
}

function currentHref() {
  try {
    return rendition.currentLocation().start.href;
  } catch (e) {
    return "";
  }
}

// toc links don't always match the book's file names exactly, so try a few spellings
async function goToChapter(href) {
  if (!rendition || !book) return;
  closeDrawer();
  const [file, frag] = (href || "").split("#");
  const sec = book.spine.spineItems.find((s) => sameFile(s.href, file));
  const tries = [href];
  if (sec) tries.push(sec.href + (frag ? "#" + frag : ""), sec.href);
  tries.push(file);
  const errors = [];
  for (const target of [...new Set(tries)]) {
    try {
      await rendition.display(target);
      if (!frag) resetChapterTop(); // scroll mode: start exactly at the top of the chapter (scrollnav.js)
      return;
    } catch (err) {
      errors.push(`${target}: ${err?.message || err}`);
    }
  }
  console.log("Chapter link did not work:", errors);
  // the details help to find the cause on a phone, where there is no console
  alert(
    `Could not open this chapter.\n\nLink: ${href}\nBook files start with: ${book.spine.spineItems[0]?.href}\nError: ${errors[0] || "none"}`,
  );
}

function renderToc() {
  const list = dEl("toc-list");
  list.innerHTML = "";
  const toc = book?.navigation?.toc || [];

  if (!toc.length) {
    const p = document.createElement("p");
    p.className = "notes-empty";
    p.textContent = "This book has no table of contents.";
    list.append(p);
    return;
  }

  const here = currentHref();
  let currentRow = null;
  const walk = (items, depth) => {
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "toc-row";
      row.style.paddingLeft = 16 + depth * 18 + "px";
      row.textContent = (item.label || "").trim() || "Untitled";

      if (!currentRow && sameFile(item.href, here)) {
        currentRow = row;
        row.classList.add("current");
      }
      row.addEventListener("click", () => goToChapter(item.href));
      list.append(row);
      if (item.subitems?.length) walk(item.subitems, depth + 1);
    });
  };
  walk(tocReversed ? [...toc].reverse() : toc, 0);

  if (currentRow) {
    const body = list.parentElement; // the scrolling area
    body.scrollTop = currentRow.offsetTop - body.clientHeight / 2;
  }
}

function renderFooter() {
  const here = currentHref();
  const item = flatToc(book?.navigation?.toc || []).find((it) =>
    sameFile(it.href, here),
  );
  const pct = Math.round((library[currentBookId]?.percent || 0) * 100);
  dEl("drawer-footer").textContent =
    (item ? item.label.trim() + " · " : "") + pct + "%";
}

// images are read straight from the epub file, only when the tab is opened
async function renderImages() {
  const list = dEl("img-list");
  if (imgBookId === currentBookId) return; // already built for this book
  resetImagesOnly();
  imgBookId = currentBookId;
  list.innerHTML = '<p class="notes-empty">Loading images…</p>';

  try {
    const buf = await localforage.getItem("file-" + currentBookId);
    const zip = await JSZip.loadAsync(buf);
    if (imgBookId !== currentBookId) return; // user switched books meanwhile
    imgEntries = zip
      .file(/\.(png|jpe?g|gif|webp|svg)$/i)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  } catch (err) {
    console.error("Image scan failed:", err);
    list.innerHTML =
      '<p class="notes-empty">Could not read images from this book.</p>';
    return;
  }

  if (!imgEntries.length) {
    list.innerHTML = '<p class="notes-empty">This book has no images.</p>';
    return;
  }
  list.innerHTML =
    '<div class="img-grid"></div><button id="img-more" class="btn btn-secondary full-width">Load more</button>';
  dEl("img-more").addEventListener("click", showMoreImages);
  showMoreImages();
}

function resetImagesOnly() {
  imgUrls.forEach((u) => URL.revokeObjectURL(u));
  imgUrls = [];
  imgEntries = [];
  imgShown = 0;
}

async function showMoreImages() {
  if (imgBusy) return;
  imgBusy = true;
  const grid = dEl("img-list").querySelector(".img-grid");
  const forBook = imgBookId;
  const batch = imgEntries.slice(imgShown, imgShown + 30); // 30 at a time keeps memory low
  for (const entry of batch) {
    const data = await entry.async("arraybuffer");
    if (forBook !== imgBookId) break; // book changed, stop
    const ext = entry.name.split(".").pop().toLowerCase();
    const url = URL.createObjectURL(
      new Blob([data], { type: IMG_TYPES[ext] || "image/*" }),
    );
    imgUrls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.addEventListener("click", () => {
      dEl("lightbox-img").src = url;
      dEl("lightbox").classList.remove("hidden");
    });
    grid.append(img);
  }
  imgShown += batch.length;
  const left = imgEntries.length - imgShown;
  const more = dEl("img-more");
  if (more) {
    more.style.display = left > 0 ? "block" : "none";
    more.textContent = `Load more (${left} left)`;
  }
  imgBusy = false;
}

document.addEventListener("DOMContentLoaded", () => {
  dEl("drawer-btn").addEventListener("click", openDrawer);
  dEl("drawer-close").addEventListener("click", closeDrawer);
  dEl("drawer-backdrop").addEventListener("click", closeDrawer);
  document
    .querySelectorAll(".drawer-tab")
    .forEach((b) =>
      b.addEventListener("click", () => setDrawerTab(b.dataset.tab)),
    );
  dEl("sort-toc").addEventListener("click", () => {
    tocReversed = !tocReversed;
    renderToc();
  });
  dEl("lightbox").addEventListener("click", () =>
    dEl("lightbox").classList.add("hidden"),
  );
});
