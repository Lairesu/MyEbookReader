// stats.js - counts reading time (per day and per hour) for the dashboard page
// Uses globals from app.js: library, currentBookId, readerView, saveLibrary, isFinished
//
// readlog is stored as { "2026-10-07": [seconds in hour 0, ..., seconds in hour 23] }
// Time only counts while a book is open, the page is visible, and you did something
// (turned a page, tapped, pressed a key) in the last few minutes.

const READLOG_KEY = "readlog";
const TICK_MS = 10000; // how often we check
const IDLE_MS = 3 * 60000; // no activity for 3 minutes = not reading
const SAVE_EVERY_MS = 30000;

let readLog = {};
let readDirty = false;
let lastActivity = 0;
let lastReadSave = 0;

function noteActivity() {
  lastActivity = Date.now();
}

function statDayKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readTick() {
  const reading =
    currentBookId &&
    !document.hidden &&
    !readerView.classList.contains("hidden");
  if (reading && Date.now() - lastActivity < IDLE_MS) {
    const now = new Date();
    const key = statDayKey(now);
    const hours = readLog[key] || (readLog[key] = new Array(24).fill(0));
    hours[now.getHours()] += TICK_MS / 1000;
    readDirty = true;
  }
  if (readDirty && Date.now() - lastReadSave > SAVE_EVERY_MS) saveReadLog();
}

async function saveReadLog() {
  if (!readDirty) return;
  readDirty = false;
  lastReadSave = Date.now();
  try {
    await localforage.setItem(READLOG_KEY, readLog);
  } catch (err) {
    readDirty = true; // try again on the next tick
    console.error("Could not save reading time:", err);
  }
}

// used by backup.js: keeps the larger value per hour, so importing twice never doubles anything
async function mergeReadLog(incoming) {
  Object.entries(incoming || {}).forEach(([day, hours]) => {
    if (!Array.isArray(hours) || hours.length !== 24) return;
    const mine = readLog[day] || (readLog[day] = new Array(24).fill(0));
    hours.forEach((s, h) => {
      if (Number.isFinite(s) && s > mine[h]) mine[h] = s;
    });
  });
  readDirty = true;
  await saveReadLog();
}

// books that were finished before this feature existed get a finish date
function backfillFinished() {
  let changed = false;
  Object.values(library).forEach((b) => {
    if (isFinished(b) && !b.finishedAt) {
      b.finishedAt = b.lastOpened || b.addedAt || Date.now();
      changed = true;
    }
  });
  if (changed) saveLibrary();
}

document.addEventListener("DOMContentLoaded", async () => {
  readLog = (await localforage.getItem(READLOG_KEY)) || {};
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach((t) =>
    document.addEventListener(t, noteActivity, { passive: true }),
  );
  setInterval(readTick, TICK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveReadLog();
  });
  window.addEventListener("pagehide", saveReadLog);
});
