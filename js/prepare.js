// prepare.js - prepares books in the background: page locations (for the progress bar) and word counts
// Uses globals from app.js: library, saveLibrary, currentBookId. Uses ICONS from icons.js.
//
// A book is prepared once, right after it is added. The work runs on its own copy of the book,
// so opening, closing or switching books never stops it. Up to PREP_CONCURRENCY books are
// prepared at the same time, and a message at the bottom of the screen shows what is going on.
// If the app is closed in the middle, the unfinished books are picked up again on the next start.

// library[id].prepV === PREP_VERSION means "locations and text counts are saved".
// Version 2 counts Japanese by characters (language.js), so books counted by version 1 are counted again once.
const PREP_VERSION = 2;
const PREP_CONCURRENCY = 2; // books prepared at the same time (more is faster but heavier on phones)
const PREP_DONE_MS = 8000; // how long the "done" message stays

const prep = {
  queue: [], // ids waiting for their turn
  active: new Map(), // id -> job { id, title, progress 0..1, cancelled, ok }
  total: 0, // books in the current batch
  done: 0, // finished fine
  failed: [], // titles that failed
  startedAt: 0,
};
let prepDoneMsg = ""; // shown after a batch finishes
let prepNotice = ""; // short message from app.js, e.g. "Adding book 2 of 5…"
let prepHidden = false; // user dismissed the progress message for this batch
let prepTicker = null;
let prepRenderTimer = null;
let prepDoneTimer = null;
let prepEl = null;

const prepRunning = () => prep.queue.length > 0 || prep.active.size > 0;
const isBookPrepared = (id) => library[id]?.prepV === PREP_VERSION;

// saved locations are only usable when they hold at least one entry
// (an empty list would leave the progress bar stuck on "Calculating" forever)
function hasValidLocations(saved) {
  try {
    const arr = typeof saved === "string" ? JSON.parse(saved) : saved;
    return Array.isArray(arr) && arr.length > 0;
  } catch (e) {
    return false;
  }
}

// ---------- queue ----------

// ids: books to prepare. urgent: start right now, in front of the queue (used when a book is opened)
function queueBookPrep(ids, { urgent = false } = {}) {
  if (!prepRunning()) resetPrepBatch();
  for (const id of ids) {
    if (!library[id] || prep.active.has(id)) continue;
    const at = prep.queue.indexOf(id);
    if (at >= 0) {
      if (urgent) {
        prep.queue.splice(at, 1);
        startPrepJob(id);
      }
      continue;
    }
    delete library[id].prepFail; // asked again, so try again
    prep.total++;
    if (urgent) startPrepJob(id);
    else prep.queue.push(id);
  }
  pumpPrep();
  startPrepTicker();
  renderPrepStatus();
}

// on startup and after an import: every book that is not prepared yet
async function queueUnpreparedBooks() {
  const ids = Object.keys(library).filter((id) => {
    const b = library[id];
    return b.prepV !== PREP_VERSION && !b.prepFail; // failed ones are retried when opened
  });
  if (ids.length) queueBookPrep(ids);
}

// used when a book is deleted
function cancelBookPrep(id) {
  const at = prep.queue.indexOf(id);
  if (at >= 0) {
    prep.queue.splice(at, 1);
    prep.total--;
  }
  const job = prep.active.get(id);
  if (job) job.cancelled = true; // the job cleans up after itself
  if (at >= 0) {
    if (!prepRunning()) finishPrepBatch();
    else renderPrepStatus();
  }
}

function resetPrepBatch() {
  prep.total = 0;
  prep.done = 0;
  prep.failed = [];
  prep.startedAt = Date.now();
  prepDoneMsg = "";
  prepHidden = false;
  clearTimeout(prepDoneTimer);
}

function pumpPrep() {
  while (prep.queue.length && prep.active.size < PREP_CONCURRENCY) {
    startPrepJob(prep.queue.shift());
  }
}

function startPrepJob(id) {
  const job = {
    id,
    title: library[id]?.title || "Untitled",
    progress: 0,
    cancelled: false,
    ok: false,
  };
  prep.active.set(id, job);
  runPrepJob(job);
}

function setJobProgress(job, p) {
  job.progress = Math.max(job.progress, Math.min(p, 1));
  if (typeof currentBookId !== "undefined" && job.id === currentBookId) {
    document.dispatchEvent(
      new CustomEvent("book-prep-progress", { detail: { id: job.id } }),
    );
  }
  scheduleRender();
}

const prepYield = () => new Promise((r) => setTimeout(r, 0));

async function runPrepJob(job) {
  const id = job.id;
  let bk = null; // our own copy of the book, never the one in the reader
  try {
    const buf = await localforage.getItem("file-" + id);
    if (job.cancelled || !library[id]) {
      job.cancelled = true;
      return;
    }
    if (!buf) throw new Error("the book file is missing");

    bk = ePub(buf);
    await bk.ready;

    const hasLoc = hasValidLocations(
      await localforage.getItem("locations-" + id),
    );
    // count the text when it was never counted, or was counted with an older method
    const needWords = !library[id].words || library[id].prepV !== PREP_VERSION;
    // share of the progress bar for each step
    const wLoc = hasLoc ? 0 : needWords ? 0.75 : 1;
    const wWords = needWords ? 1 - wLoc : 0;

    // step 1: locations (what the reader's progress bar is based on)
    if (!hasLoc) {
      const sections = bk.spine.spineItems.filter((s) => s.linear).length || 1;
      let seen = 0;
      try {
        // epub.js has no progress callback, so count the sections it has processed
        const original = bk.locations.process.bind(bk.locations);
        bk.locations.process = (section) =>
          original(section).then((r) => {
            seen++;
            setJobProgress(job, Math.min(seen / sections, 1) * wLoc);
            return r;
          });
        if ("pause" in bk.locations) bk.locations.pause = 10; // default is 100 ms per chapter
      } catch (e) {
        console.log("Progress counting not available:", e);
      }
      await bk.locations.generate(1600);
      if (job.cancelled || !library[id]) {
        job.cancelled = true;
        return;
      }
      const json = bk.locations.save();
      if (!hasValidLocations(json))
        throw new Error("no text found in this book");
      await localforage.setItem("locations-" + id, json);
      setJobProgress(job, wLoc);
    }

    // step 2: count the text (for "time left"): words, or characters for Japanese (language.js)
    if (needWords) {
      const items = bk.spine.spineItems;
      const sums = { tokens: 0, letters: 0, cjk: 0, kana: 0 };
      for (let i = 0; i < items.length; i++) {
        if (job.cancelled || !library[id]) {
          job.cancelled = true;
          return;
        }
        const item = items[i];
        const doc = await item.load(bk.load.bind(bk));
        const text = item.document?.body?.textContent ?? doc?.textContent ?? "";
        const part = countText(text);
        for (const k in sums) sums[k] += part[k];
        item.unload();
        setJobProgress(job, wLoc + ((i + 1) / items.length) * wWords);
        await prepYield(); // keeps the app responsive
      }
      const r = summarizeCounts(sums);
      library[id].words = r.words;
      if (r.chars) {
        library[id].chars = r.chars; // Japanese: characters instead of words
        library[id].lang = r.lang;
      } else {
        delete library[id].chars;
        delete library[id].lang;
      }
    }

    library[id].prepV = PREP_VERSION;
    delete library[id].prepFail;
    await saveLibrary();
    job.ok = true;
  } catch (err) {
    if (!job.cancelled) {
      console.error("Prepare failed for", job.title, err);
      if (library[id]) {
        library[id].prepFail = Date.now(); // not retried on every start, only when opened
        saveLibrary();
      }
    }
  } finally {
    try {
      bk?.destroy();
    } catch (e) {}
    prep.active.delete(id);

    if (job.cancelled) {
      prep.total--;
    } else if (job.ok) {
      prep.done++;
      document.dispatchEvent(
        new CustomEvent("book-prepared", { detail: { id } }),
      );
    } else {
      prep.failed.push(job.title);
      document.dispatchEvent(
        new CustomEvent("book-prep-failed", { detail: { id } }),
      );
    }

    pumpPrep();
    if (!prepRunning()) finishPrepBatch();
    else scheduleRender();
  }
}

function finishPrepBatch() {
  stopPrepTicker();
  prepHidden = false;
  clearTimeout(prepDoneTimer);
  if (prep.total > 0) {
    const ok = prep.done;
    const bad = prep.failed.length;
    if (bad) {
      const names = prep.failed.slice(0, 2).join(", ");
      const more = bad > 2 ? ` and ${bad - 2} more` : "";
      prepDoneMsg = `${ok} of ${prep.total} books are ready. Could not prepare: ${names}${more}. Open the book to try again.`;
    } else {
      prepDoneMsg = `\u2713 Done! ${ok} book${ok === 1 ? " is" : "s are"} ready. Progress and word counts are calculated.`;
    }
    prepDoneTimer = setTimeout(
      () => {
        prepDoneMsg = "";
        renderPrepStatus();
      },
      bad ? PREP_DONE_MS * 2 : PREP_DONE_MS,
    );
  }
  renderPrepStatus();
}

// text for the reader's progress area while the open book is still being prepared
function prepProgressLabel(id) {
  const job = prep.active.get(id);
  if (job)
    return `Calculating progress\u2026 ${Math.round(job.progress * 100)}%`;
  if (prep.queue.includes(id)) return "Waiting to calculate progress\u2026";
  if (library[id]?.prepFail) return "Could not calculate progress";
  return "Calculating progress\u2026";
}

// ---------- messages ----------

function showPrepNotice(text) {
  prepNotice = text;
  renderPrepStatus();
}
function clearPrepNotice() {
  prepNotice = "";
  renderPrepStatus();
}

function ensurePrepEl() {
  if (prepEl) return prepEl;
  prepEl = document.createElement("div");
  prepEl.id = "prep-status";
  prepEl.className = "hidden";
  prepEl.setAttribute("role", "status");
  prepEl.setAttribute("aria-live", "polite");
  prepEl.innerHTML =
    '<div class="prep-row"><span class="prep-title"></span>' +
    '<button class="btn-icon prep-close" aria-label="Dismiss"></button></div>' +
    '<div class="prep-bar"><div class="prep-fill"></div></div>' +
    '<div class="prep-detail"></div>';
  prepEl.querySelector(".prep-close").innerHTML = ICONS.close;
  prepEl.querySelector(".prep-close").addEventListener("click", () => {
    prepHidden = true; // hides this batch's progress; the "done" message still comes
    prepDoneMsg = "";
    prepNotice = "";
    renderPrepStatus();
  });
  document.body.append(prepEl);
  return prepEl;
}

function scheduleRender() {
  if (prepRenderTimer) return;
  prepRenderTimer = setTimeout(() => {
    prepRenderTimer = null;
    renderPrepStatus();
  }, 250);
}

function startPrepTicker() {
  if (!prepTicker) prepTicker = setInterval(renderPrepStatus, 1000); // keeps the time estimate moving
}
function stopPrepTicker() {
  clearInterval(prepTicker);
  prepTicker = null;
}

function fmtEta(sec) {
  if (sec < 45) return "less than a minute left";
  const m = Math.round(sec / 60);
  if (m < 60) return `about ${m} min left`;
  return `about ${Math.floor(m / 60)} h ${m % 60} min left`;
}

const shortTitle = (t) => (t.length > 26 ? t.slice(0, 25) + "\u2026" : t);

function renderPrepStatus() {
  const el = ensurePrepEl();
  const title = el.querySelector(".prep-title");
  const fill = el.querySelector(".prep-fill");
  const detail = el.querySelector(".prep-detail");

  if (prepRunning()) {
    if (prepHidden) return el.classList.add("hidden");
    const jobs = [...prep.active.values()];
    const finished = prep.done + prep.failed.length;
    const frac = Math.min(
      1,
      (finished + jobs.reduce((s, j) => s + j.progress, 0)) / prep.total,
    );

    // time left = time spent so far, scaled by how much work is still open
    const elapsed = (Date.now() - prep.startedAt) / 1000;
    const workDone = frac * prep.total;
    const eta =
      elapsed > 4 && workDone >= 0.05
        ? fmtEta((elapsed / workDone) * (prep.total - workDone))
        : "estimating time\u2026";

    title.textContent = `Preparing books: ${finished} of ${prep.total} done`;
    fill.style.width = Math.round(frac * 100) + "%";
    detail.textContent =
      "Working on: " +
      jobs
        .map((j) => `${shortTitle(j.title)} ${Math.round(j.progress * 100)}%`)
        .join(" \u00b7 ") +
      (prep.queue.length ? ` \u00b7 ${prep.queue.length} waiting` : "") +
      `\nCounting pages and words so progress and time left are accurate \u00b7 ${eta}`;
    el.className = "running";
  } else if (prepDoneMsg) {
    title.textContent = prepDoneMsg;
    detail.textContent = "";
    el.className = "done";
  } else if (prepNotice) {
    title.textContent = prepNotice;
    detail.textContent = "";
    el.className = "notice";
  } else {
    el.className = "hidden";
  }
}
