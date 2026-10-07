// backup.js - export and import the whole library as one .zip
// Uses globals from app.js: library, saveLibrary, renderLibrary

const bkEl = (id) => document.getElementById(id);

function setBackupStatus(msg) {
  bkEl("backup-status").textContent = msg;
}

function setBackupBusy(busy) {
  document
    .querySelectorAll("#backup-panel button:not(#close-backup)")
    .forEach((b) => (b.disabled = busy));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000); // give the download time to start
}

async function exportBackup(includeBooks) {
  const ids = Object.keys(library);
  if (!ids.length) return setBackupStatus("Nothing to export yet.");
  if (typeof JSZip.prototype.generateAsync !== "function") {
    return setBackupStatus("This JSZip version can't create files.");
  }

  setBackupBusy(true);
  try {
    const zip = new JSZip();
    const books = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setBackupStatus(`Packing book ${i + 1} of ${ids.length}…`);
      const notes = await localforage.getItem("notes-" + id);
      const entry = {
        ...library[id],
        id,
        highlights: notes?.highlights || [],
        file: null,
      };

      if (includeBooks) {
        const buf = await localforage.getItem("file-" + id);
        if (buf) {
          entry.file = `books/${id}.epub`;
          zip.file(entry.file, buf, { compression: "STORE" }); // epubs are already compressed
        }
      }
      books.push(entry);
    }

    zip.file(
      "backup.json",
      JSON.stringify({
        app: "ebook-reader",
        version: 1,
        exportedAt: new Date().toISOString(),
        books,
      }),
    );

    setBackupStatus("Creating file…");
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const day = new Date().toISOString().slice(0, 10);
    downloadBlob(
      blob,
      `ebook-backup-${day}${includeBooks ? "" : "-notes-only"}.zip`,
    );
    setBackupStatus(`Exported ${books.length} book(s).`);
  } catch (err) {
    console.error("Export failed:", err);
    setBackupStatus("Export failed: " + err.message);
  } finally {
    setBackupBusy(false);
  }
}

// same title + author counts as the same book, even when ids differ between devices
function findExistingId(b) {
  if (library[b.id]) return b.id;
  const key = (x) =>
    `${(x.title || "").toLowerCase()}|${(x.author || "").toLowerCase()}`;
  return Object.keys(library).find((id) => key(library[id]) === key(b));
}

async function mergeInto(id, b) {
  const notes = (await localforage.getItem("notes-" + id)) || {
    highlights: [],
  };
  const have = new Set(notes.highlights.map((h) => h.cfiRange));
  (b.highlights || []).forEach((h) => {
    if (!have.has(h.cfiRange)) notes.highlights.push(h);
  });
  await localforage.setItem("notes-" + id, notes);

  // keep whichever reading position is newer
  if ((b.lastOpened || 0) > (library[id].lastOpened || 0) && b.cfi) {
    library[id].cfi = b.cfi;
    library[id].percent = b.percent || 0;
    library[id].lastOpened = b.lastOpened;
  }
  if (!library[id].words && b.words) library[id].words = b.words;
}

async function importBackup(file) {
  setBackupBusy(true);
  try {
    const zip = await JSZip.loadAsync(file);
    const jsonFile = zip.file("backup.json");
    if (!jsonFile) throw new Error("this isn't a backup from this app");
    const data = JSON.parse(await jsonFile.async("string"));
    if (data.app !== "ebook-reader" || !Array.isArray(data.books)) {
      throw new Error("this isn't a backup from this app");
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < data.books.length; i++) {
      const b = data.books[i];
      setBackupStatus(`Importing book ${i + 1} of ${data.books.length}…`);
      const existingId = findExistingId(b);

      if (existingId) {
        await mergeInto(existingId, b);
        updated++;
      } else if (b.file && zip.file(b.file)) {
        const buf = await zip.file(b.file).async("arraybuffer");
        await localforage.setItem("file-" + b.id, buf);
        await localforage.setItem("notes-" + b.id, {
          highlights: b.highlights || [],
        });
        library[b.id] = {
          title: b.title,
          author: b.author,
          addedAt: b.addedAt || Date.now(),
          lastOpened: b.lastOpened || 0,
          cfi: b.cfi || null,
          percent: b.percent || 0,
          words: b.words,
        };
        added++;
      } else {
        skipped++; // notes-only backup, and this device doesn't have the book
      }
    }

    await saveLibrary();
    renderLibrary();
    if (typeof backfillCovers === "function") backfillCovers(); // restored books get covers
    let msg = `Done: ${added} added, ${updated} updated`;
    if (skipped) msg += `, ${skipped} skipped (book file not in backup)`;
    setBackupStatus(msg + ".");
  } catch (err) {
    console.error("Import failed:", err);
    setBackupStatus("Import failed: " + err.message);
  } finally {
    setBackupBusy(false);
    bkEl("import-input").value = ""; // allows picking the same file again
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bkEl("backup-btn").addEventListener("click", () => {
    setBackupStatus("");
    bkEl("backup-panel").classList.remove("hidden");
  });
  bkEl("close-backup").addEventListener("click", () =>
    bkEl("backup-panel").classList.add("hidden"),
  );
  bkEl("export-full").addEventListener("click", () => exportBackup(true));
  bkEl("export-notes").addEventListener("click", () => exportBackup(false));
  bkEl("import-btn").addEventListener("click", () =>
    bkEl("import-input").click(),
  );
  bkEl("import-input").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
  });
});
