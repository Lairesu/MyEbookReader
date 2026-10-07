// storage.js - asks the browser to keep our data, and shows how much space is used
// Uses globals from app.js: library

const storageState = {
  supported: !!(navigator.storage && navigator.storage.persist),
  persisted: false,
  denied: false, // the browser said no when we asked
  used: 0,
  quota: 0,
};
let bannerDismissed = false; // only for this visit, so the warning comes back next time

const stoEl = (id) => document.getElementById(id);

function fmtBytes(n) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + " " + units[i];
}

async function refreshStorage() {
  try {
    if (navigator.storage?.persisted) {
      storageState.persisted = await navigator.storage.persisted();
    }
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      storageState.used = est.usage || 0;
      storageState.quota = est.quota || 0;
    }
  } catch (err) {
    console.log("Storage info not available:", err);
  }
  renderStorage();
}

// ask the browser to never clear our data on its own
async function requestPersist() {
  if (!storageState.supported) return false;
  try {
    if (!storageState.persisted) {
      storageState.persisted = await navigator.storage.persist();
      storageState.denied = !storageState.persisted;
    }
  } catch (err) {
    storageState.denied = true;
    console.log("Persist request failed:", err);
  }
  await refreshStorage();
  return storageState.persisted;
}

function renderStorage() {
  const s = storageState;
  const badge = stoEl("storage-badge");
  if (!badge) return;

  badge.textContent = !s.supported
    ? "Not supported"
    : s.persisted
      ? "Protected"
      : "Not protected";
  badge.className = "storage-badge " + (s.persisted ? "ok" : "warn");

  const pct = s.quota ? Math.min(100, (s.used / s.quota) * 100) : 0;
  stoEl("storage-fill").style.width = Math.max(pct, s.used ? 1 : 0) + "%";

  let text = s.quota
    ? `${fmtBytes(s.used)} used of about ${fmtBytes(s.quota)} available.`
    : "";
  if (!s.supported) {
    text +=
      " This browser can't protect your library, so export backups often.";
  } else if (s.persisted) {
    text += " The browser will not delete your books when space runs low.";
  } else {
    text +=
      " The browser may delete your books if the device runs low on space.";
  }
  stoEl("storage-text").textContent = text.trim();

  // the "Protect" buttons (banner and backup panel) only make sense while unprotected
  document
    .querySelectorAll(".persist-action")
    .forEach(
      (b) => (b.style.display = s.supported && !s.persisted ? "" : "none"),
    );

  const hasBooks = Object.keys(library).length > 0;
  const showBanner =
    s.supported && !s.persisted && hasBooks && !bannerDismissed;
  stoEl("persist-banner").classList.toggle("hidden", !showBanner);
  stoEl("persist-text").textContent = s.denied
    ? "Your browser did not agree to protect your library. Installing the app to your home screen often helps, and a backup keeps your books safe either way."
    : "Your books are stored in this browser, which can delete them when space runs low. Protect your library to stop that.";
}

async function initStorage() {
  document
    .querySelectorAll(".persist-action")
    .forEach((b) => b.addEventListener("click", requestPersist));
  stoEl("persist-dismiss").addEventListener("click", () => {
    bannerDismissed = true;
    renderStorage();
  });
  stoEl("open-backup").addEventListener("click", () =>
    stoEl("backup-btn").click(),
  );

  await refreshStorage();
  if (!storageState.persisted) await requestPersist(); // some browsers grant it silently
}

// the backup panel shows fresh numbers every time it opens
document.addEventListener("DOMContentLoaded", () => {
  stoEl("backup-btn").addEventListener("click", refreshStorage);
});
