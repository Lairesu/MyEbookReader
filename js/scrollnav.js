// scrollnav.js - scroll mode: one chapter at a time, and a heavy pull to change chapter
// Uses globals from app.js: book, rendition, currentBookId, bookView
//
// Scroll mode shows a single chapter (one file of the book) and scrolls inside it, so a chapter
// always starts exactly at its top. Reaching the end of a chapter does not move on by itself:
// the reader has to keep pulling (finger or mouse wheel) like lifting a heavy garage door.
// On a computer the left and right arrow keys, and on a phone the buttons, change chapter.

const PULL_NEED = 160; // finger travel in px past the edge before the chapter changes (long on purpose)
const WHEEL_NEED = 900; // mouse wheel travel in px past the edge
const SCROLL_FIX_CSS =
  "html, body { height: auto !important; min-height: 0 !important; max-height: none !important; }"; // fixed page heights in some books stop scrolling

let chapterBusy = false;
let pull = { dir: 0, startY: 0 }; // dir: 1 = pulling up for the next chapter, -1 = pulling down for the previous
let lastTouchY = 0;
let wheelAmount = 0;
let wheelTimer = null;
let lastScrollAt = 0;

const isScrollMode = () =>
  !!currentBookId && bookView(currentBookId).mode === "scroll";
const scrollBox = () => rendition?.manager?.container || null; // the element that scrolls

function edges() {
  const b = scrollBox();
  if (!b) return { top: false, end: false };
  return {
    top: b.scrollTop <= 1,
    end: b.scrollTop + b.clientHeight >= b.scrollHeight - 1,
  };
}

// the chapter before (-1) or after (1) the one on screen, skipping hidden "non-linear" files
function findChapter(dir) {
  const here = rendition?.currentLocation()?.start;
  if (!here || !book) return null;
  let i = here.index + dir;
  let target = book.spine.get(i);
  while (target && !target.linear) {
    i += dir;
    target = book.spine.get(i);
  }
  return target || null;
}

// fromEdge: came from pulling past the top, so land at the end of the previous chapter
async function goChapter(dir, { fromEdge = false } = {}) {
  if (chapterBusy || !rendition) return false;
  const target = findChapter(dir);
  if (!target) return false; // first or last chapter
  chapterBusy = true;
  try {
    await rendition.display(target.href);
    const box = scrollBox();
    if (box) {
      const toEnd = dir < 0 && fromEdge;
      box.scrollTop = toEnd ? box.scrollHeight : 0;
      if (toEnd) setTimeout(() => (box.scrollTop = box.scrollHeight), 150); // images can change the height
    }
    return true;
  } catch (err) {
    console.log("Could not change chapter:", err);
    return false;
  } finally {
    chapterBusy = false;
    hidePull(true);
  }
}

// used after opening a chapter from the contents list
function resetChapterTop() {
  if (!isScrollMode()) return;
  const b = scrollBox();
  if (b) b.scrollTop = 0;
}

// ---------- the pull message ----------

function pullEl() {
  let el = document.getElementById("chapter-pull");
  if (!el) {
    el = document.createElement("div");
    el.id = "chapter-pull";
    el.innerHTML =
      '<span class="pull-text"></span><div class="pull-bar"><div class="pull-fill"></div></div>';
    document.getElementById("viewer").append(el);
  }
  return el;
}

function showPull(dir, ratio) {
  const el = pullEl();
  const has = !!findChapter(dir);
  const r = Math.min(ratio, 1);
  el.className =
    (dir > 0 ? "end" : "start") + " show" + (r >= 1 && has ? " ready" : "");
  el.querySelector(".pull-text").textContent = !has
    ? dir > 0
      ? "This is the last chapter"
      : "This is the first chapter"
    : r >= 1
      ? dir > 0
        ? "Let go for the next chapter"
        : "Let go for the previous chapter"
      : dir > 0
        ? "Keep pulling up for the next chapter"
        : "Keep pulling down for the previous chapter";
  el.querySelector(".pull-fill").style.width = has ? r * 100 + "%" : "0";

  // the page lifts a little, with more effort the further you pull
  const box = scrollBox();
  if (box) {
    box.style.transition = "none";
    box.style.transform = `translateY(${-dir * r * 36}px)`;
  }
}

function hidePull(instant) {
  document.getElementById("chapter-pull")?.classList.remove("show");
  const box = scrollBox();
  if (box) {
    box.style.transition = instant ? "none" : "transform 0.25s ease";
    box.style.transform = "";
  }
}

// ---------- finger ----------
// screenY is used because clientY changes when the page scrolls underneath the finger

function onPullStart(e) {
  lastTouchY = e.touches[0].screenY;
  pull = { dir: 0, startY: 0 };
}

function onPullMove(e) {
  const y = e.touches[0].screenY;
  if (chapterBusy) return void (lastTouchY = y);
  const { top, end } = edges();

  if (!pull.dir) {
    if (end && y < lastTouchY) pull = { dir: 1, startY: lastTouchY };
    else if (top && y > lastTouchY) pull = { dir: -1, startY: lastTouchY };
  }
  if (pull.dir) {
    const amount = pull.dir > 0 ? pull.startY - y : y - pull.startY;
    if (amount <= 0) {
      pull = { dir: 0, startY: 0 }; // the finger went back
      hidePull(false);
    } else {
      showPull(pull.dir, amount / PULL_NEED);
      pull.amount = amount;
      if (e.cancelable) e.preventDefault();
    }
  }
  lastTouchY = y;
}

function onPullEnd() {
  if (!pull.dir) return;
  const { dir, amount = 0 } = pull;
  pull = { dir: 0, startY: 0 };
  if (amount >= PULL_NEED && findChapter(dir)) {
    goChapter(dir, { fromEdge: true });
  } else {
    hidePull(false); // not enough force: the page drops back
  }
}

// ---------- mouse wheel ----------

function onPullWheel(e) {
  if (chapterBusy || !e.deltaY) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  const { top, end } = edges();
  if ((dir > 0 && !end) || (dir < 0 && !top)) {
    wheelAmount = 0;
    return;
  }
  if (Date.now() - lastScrollAt < 400) return; // still gliding to the edge, do not count that
  wheelAmount += Math.abs(e.deltaY);
  showPull(dir, wheelAmount / WHEEL_NEED);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    wheelAmount = 0;
    hidePull(false);
  }, 450);
  if (wheelAmount >= WHEEL_NEED && findChapter(dir)) {
    wheelAmount = 0;
    clearTimeout(wheelTimer);
    goChapter(dir, { fromEdge: true });
  }
}

const noteScroll = () => (lastScrollAt = Date.now());

// registered as a content hook, so it runs for every chapter that is drawn
function attachScrollNav(contents) {
  const doc = contents.document;
  doc.addEventListener("touchstart", onPullStart, { passive: true });
  doc.addEventListener("touchmove", onPullMove, { passive: false });
  doc.addEventListener("touchend", onPullEnd, { passive: true });
  doc.addEventListener("touchcancel", onPullEnd, { passive: true });
  doc.addEventListener("wheel", onPullWheel, { passive: true });
  scrollBox()?.addEventListener("scroll", noteScroll, { passive: true });
}
