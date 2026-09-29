// global variables
let book = null;
let rendition = null;
let currentBookId = null;
let currentFontSize = 100;

// dom elements
const libraryView = document.getElementById("library-view");
const readerView = document.getElementById("reader-view");
const bookList = document.getElementById("book-list");
const emptyMessage = document.getElementById("empty-message");
const fileInput = document.getElementById("file-input");
const addBookBtn = document.getElementById("add-book-btn");
const backBtn = document.getElementById("back-btn");
const menuBtn = document.getElementById("menu-btn");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const bookTitle = document.getElementById("book-title");
const settingsPanel = document.getElementById("settings-panel");
const closeSettings = document.getElementById("close-settings");
const fontDecrease = document.getElementById("font-decrease");
const fontIncrease = document.getElementById("font-increase");
const fontSizeValue = document.getElementById("font-size-value");
const progressFill = document.getElementById("progress-fill");

// starting
document.addEventListener("DOMContentLoaded", async () => {
  // Register service worker for offline
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
      console.log("Service Worker registered");
    } catch (err) {
      console.log("Service Worker registration failed:", err);
    }
  }

  // Load books from storage
  await loadLibrary();

  // Event listeners
  addBookBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileSelect);
  backBtn.addEventListener("click", showLibrary);
  menuBtn.addEventListener("click", () =>
    settingsPanel.classList.remove("hidden"),
  );
  closeSettings.addEventListener("click", () =>
    settingsPanel.classList.add("hidden"),
  );
  prevBtn.addEventListener("click", () => rendition?.prev());
  nextBtn.addEventListener("click", () => rendition?.next());

  fontDecrease.addEventListener("click", () => changeFontSize(-10));
  fontIncrease.addEventListener("click", () => changeFontSize(10));

  // Theme buttons
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme));
  });

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (readerView.classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") rendition?.prev();
    if (e.key === "ArrowRight") rendition?.next();
  });

  // select, Delete Select all checkbox interactive
  document.getElementById("select-mode-btn").addEventListener("click", () => {
    const isActive =
      document.getElementById("select-controls").style.display === "block";
    toggleSelectMode(!isActive);
  });

  document
    .getElementById("delete-selected-btn")
    .addEventListener("click", deleteSelectedBooks);

  document.getElementById("select-all").addEventListener("change", (e) => {
    document.querySelectorAll(".book-checkbox").forEach((cb) => {
      cb.checked = e.target.checked;
    });
  });
});

// Library Functions
async function loadLibrary() {
  const books = (await localforage.getItem("books")) || {};
  bookList.innerHTML = "";

  const bookIds = Object.keys(books);

  if (bookIds.length === 0) {
    emptyMessage.style.display = "block";
    return;
  }

  emptyMessage.style.display = "none";

  bookIds.forEach((id) => {
    const bookData = books[id];
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-info">
        <h3>${bookData.title || "Untitled"}</h3>
        <p>${bookData.author || "Unknown Author"}</p>
      </div>
      <button class="delete-btn" data-id="${id}">✕</button>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-btn")) return;
      openBook(id);
    });

    card.querySelector(".delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Delete this book?")) {
        await deleteBook(id);
      }
    });

    bookList.appendChild(card);
  });
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bookId = "book_" + Date.now();

    // Temporary book to get metadata
    const tempBook = ePub(arrayBuffer);
    await tempBook.ready;

    const metadata = await tempBook.loaded.metadata;
    const title = metadata.title || file.name.replace(".epub", "");
    const author = metadata.creator || "Unknown Author";

    // Save book data
    const books = (await localforage.getItem("books")) || {};
    books[bookId] = {
      title,
      author,
      data: arrayBuffer,
      lastLocation: null,
      addedAt: Date.now(),
    };

    await localforage.setItem("books", books);
    await loadLibrary();

    // Clear input
    fileInput.value = "";
  } catch (err) {
    alert("Failed to load book: " + err.message);
    console.error(err);
  }
}

async function deleteBook(id) {
  const books = (await localforage.getItem("books")) || {};
  delete books[id];
  await localforage.setItem("books", books);
  await loadLibrary();
}

// READER FUNCTIONS
async function openBook(id) {
  try {
    const books = (await localforage.getItem("books")) || {};
    const bookData = books[id];
    if (!bookData) {
      alert("Book not found");
      return;
    }

    currentBookId = id;

    // Show reader view first
    libraryView.classList.add("hidden");
    readerView.classList.remove("hidden");
    bookTitle.textContent = bookData.title || "Untitled";

    // Destroy previous book
    if (book) {
      try {
        book.destroy();
      } catch (e) {}
      book = null;
      rendition = null;
    }

    // Clear viewer
    const viewer = document.getElementById("viewer");
    viewer.innerHTML = "";

    // Create book
    book = ePub(bookData.data);

    // IMPORTANT: wait until the book is fully parsed
    await book.ready;

    // Now render
    rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%",
      flow: "paginated",
      manager: "default",
    });

    // Display
    const location = bookData.lastLocation || 0;
    await rendition.display(location);

    // Force resize after a short delay (very important)
    setTimeout(() => {
      if (rendition) {
        rendition.resize();
      }
    }, 150);

    // Save progress
    rendition.on("relocated", async (location) => {
      try {
        const books = (await localforage.getItem("books")) || {};
        if (books[currentBookId]) {
          books[currentBookId].lastLocation = location.start.cfi;
          await localforage.setItem("books", books);
        }
        if (location.start.percentage) {
          progressFill.style.width = location.start.percentage * 100 + "%";
        }
      } catch (err) {
        console.error(err);
      }
    });

    changeFontSize(0);
  } catch (err) {
    console.error("Error opening book:", err);
    alert("Failed to open book. Try hard refresh (Ctrl + Shift + R).");
  }
}

function showLibrary() {
  readerView.classList.add("hidden");
  libraryView.classList.remove("hidden");
  settingsPanel.classList.add("hidden");

  if (book) {
    book.destroy();
    book = null;
    rendition = null;
  }
}

//  SETTINGS
function changeFontSize(delta) {
  currentFontSize = Math.max(70, Math.min(160, currentFontSize + delta));
  fontSizeValue.textContent = currentFontSize + "%";

  if (rendition) {
    rendition.themes.fontSize(currentFontSize + "%");
  }
}

function setTheme(theme) {
  document.body.className = ""; // reset
  if (theme !== "light") {
    document.body.classList.add("theme-" + theme);
  }

  if (rendition) {
    if (theme === "dark") {
      rendition.themes.override("color", "#e0e0e0");
      rendition.themes.override("background", "#1a1a1a");
    } else if (theme === "sepia") {
      rendition.themes.override("color", "#5b4636");
      rendition.themes.override("background", "#f4ecd8");
    } else {
      rendition.themes.override("color", "#000");
      rendition.themes.override("background", "#fff");
    }
  }
}

//  MASS ADD
async function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length === 0) return;

  const books = (await localforage.getItem("books")) || {};
  let addedCount = 0;

  for (const file of files) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const tempBook = ePub(arrayBuffer);
      await tempBook.ready;

      const metadata = await tempBook.loaded.metadata;
      const title = (metadata.title || file.name.replace(".epub", "")).trim();
      const author = metadata.creator || "Unknown Author";

      // Check for duplicate title (case-insensitive)
      const existingId = Object.keys(books).find(
        (id) => books[id].title.toLowerCase() === title.toLowerCase(),
      );

      if (existingId) {
        const confirmAdd = confirm(
          `A book named "${title}" already exists.\nDo you want to add it anyway?`,
        );
        if (!confirmAdd) continue;
      }

      const bookId =
        "book_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);

      books[bookId] = {
        title,
        author,
        data: arrayBuffer,
        lastLocation: null,
        addedAt: Date.now(),
      };

      addedCount++;
    } catch (err) {
      console.error("Failed to load:", file.name, err);
      alert(`Failed to load "${file.name}"`);
    }
  }

  await localforage.setItem("books", books);
  await loadLibrary();
  fileInput.value = "";

  if (addedCount > 0) {
    alert(`${addedCount} book(s) added successfully.`);
  }
}

//  MASS DELETE
function toggleSelectMode(enable) {
  const selectControls = document.getElementById("select-controls");
  const deleteBtn = document.getElementById("delete-selected-btn");
  const selectModeBtn = document.getElementById("select-mode-btn");

  selectControls.style.display = enable ? "block" : "none";
  deleteBtn.style.display = enable ? "inline-block" : "none";
  selectModeBtn.textContent = enable ? "Cancel" : "Select";

  document.querySelectorAll(".book-checkbox").forEach((cb) => {
    cb.style.display = enable ? "block" : "none";
    cb.checked = false;
  });

  document.getElementById("select-all").checked = false;
}

async function deleteSelectedBooks() {
  const checkboxes = document.querySelectorAll(".book-checkbox:checked");
  if (checkboxes.length === 0) {
    alert("No books selected");
    return;
  }

  const confirmDelete = confirm(
    `Are you sure you want to delete ${checkboxes.length} book(s)?`,
  );
  if (!confirmDelete) return;

  const books = (await localforage.getItem("books")) || {};

  checkboxes.forEach((cb) => {
    delete books[cb.dataset.id];
  });

  await localforage.setItem("books", books);
  await loadLibrary();
  toggleSelectMode(false);
}

//  UPDATED loadLibrary
async function loadLibrary() {
  const books = (await localforage.getItem("books")) || {};
  bookList.innerHTML = "";

  const bookIds = Object.keys(books);

  if (bookIds.length === 0) {
    emptyMessage.style.display = "block";
    document.getElementById("select-controls").style.display = "none";
    return;
  }

  emptyMessage.style.display = "none";

  bookIds.forEach((id) => {
    const bookData = books[id];
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML = `
      <div class="book-info">
        <h3>${bookData.title || "Untitled"}</h3>
        <p>${bookData.author || "Unknown Author"}</p>
      </div>
      <button class="delete-btn" data-id="${id}">✕</button>
    `;

    card.addEventListener("click", (e) => {
      if (
        e.target.classList.contains("delete-btn") ||
        e.target.classList.contains("book-checkbox")
      )
        return;
      openBook(id);
    });

    card.querySelector(".delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${bookData.title}"?`)) {
        await deleteBook(id);
      }
    });

    bookList.appendChild(card);
  });
}
