# Ebook Reader

A personal EPUB reader that runs in the browser and works fully offline. It installs like a normal app on phones and computers, and keeps every book on your own device. No account, no server, no tracking.

Live app: [myebookreader.lairesu.workers.dev](https://myebookreader.lairesu.workers.dev/)

## Features

**Library**

- Add one or many EPUB files at once, with a warning for duplicates
- Cover thumbnails taken from the EPUB itself
- Continue reading card with progress, sorted by last opened
- Select mode with mass delete
- Responsive grid that fits phones, tablets and desktops
- Filter by Reading, Unread or Finished; finished books get a gold glow and a badge
- Shelves (tags) to group books, with a shelf filter; select mode adds many books at once
- Drag EPUB files onto the library to add them

**Reading**

- Paginated reader with swipe, arrow keys and on-screen buttons
- Saved position, progress bar, word count and estimated time left
- Page locations and word counts are calculated in the background as soon as books are added, several at once, with a message showing how many are done and the time left
- Font size, font family, line spacing, and light, dark and sepia themes
- Optional screen wake lock while reading
- Dim and warm overlay sliders for night reading
- Phone back button returns from the book to the library

**Highlights and notes**

- Select text to highlight in five colors or a custom color
- Change the color, add a note or remove a highlight by tapping it
- Side drawer with chapters, a list of highlights with notes, and all images in the book

**Offline and data**

- Works with no connection after the first visit
- Backup and restore the whole library, with or without the book files
- Asks the browser for persistent storage, shows how much space is used and warns when the library is not protected
- Reading dashboard (its own page) with bar graphs of time read per day, per hour of the day, and books finished per month
- New version prompt when an update is deployed

## How it works

| Part            | Technology                                        |
| --------------- | ------------------------------------------------- |
| EPUB rendering  | epub.js                                           |
| Storage         | IndexedDB through localForage                     |
| Backup files    | JSZip                                             |
| Offline support | Service worker, network first with cache fallback |
| Installation    | Web app manifest                                  |

Books, covers, highlights and reading positions are stored in the browser's IndexedDB, in separate entries so the library screen loads quickly however many books you add. The service worker caches the app files only. It never touches your books.

## Run locally

No build step is needed. Serve the folder with any static server, for example the Live Server extension in VS Code, or:

```
python -m http.server 5500
```

Then open `http://localhost:5500`. Service workers only run on `localhost` or over HTTPS.

## Deploy

The project is plain static files. It can be hosted on GitHub Pages, Netlify or any static host.

1. Push the repository to GitHub.
2. Open Settings, then Pages, and choose the `main` branch and the root folder.
3. Open the published link and install the app from the browser menu.

After changing any cached file, bump `CACHE_NAME` in `sw.js` so installed copies update. Keep `sw.js` in the root folder, because a service worker can only control the folder it sits in. Use lowercase file names, because GitHub Pages is case sensitive. The dashboard is a second page (`dashboard.html`); static hosts serve any number of pages, and each new page and script needs its own entry in `ASSETS`.

## Install

- **Android and desktop Chrome or Edge:** open the link and choose Install app.
- **iPhone:** open the link in Safari, then Share and Add to Home Screen.

## Backup

Your data lives only in the browser it was added in. Clearing site data or switching devices removes it, so export a backup from the Backup button in the library from time to time. Importing a backup merges into the existing library without creating duplicates, which also makes it the way to move books between devices.

## Project structure

```
ebook-reader/
├── index.html          page layout and panels
├── manifest.json       install metadata
├── sw.js               service worker (kept in the root so it covers the whole app)
├── dashboard.html      reading dashboard page
├── README.md
├── .gitignore
├── css/
│   └── styles.css      all styling, including themes
├── js/
│   ├── app.js          library, reader, settings, progress, covers
│   ├── highlights.js   highlights, colors and notes
│   ├── toc.js          side drawer: chapters, highlights list, images
│   ├── backup.js       export and import
│   ├── icons.js        shared SVG icon set
│   ├── storage.js      persistent storage request and space used
│   ├── library.js      status filter, shelves, drag and drop
│   ├── stats.js        counts reading time for the dashboard
│   ├── prepare.js      prepares books in the background (page locations, word counts)
│   └── dashboard.js    draws the dashboard page
├── icons/
│   ├── icon-192.png    app icon
│   └── icon-512.png    app icon
└── libs/
    ├── epub.min.js
    ├── jszip.min.js
    └── localforage.min.js
```

The scripts share global variables, so `index.html` loads them in a fixed order: `icons.js`, `app.js`, `highlights.js`, `backup.js`, `toc.js`, `storage.js`, `library.js`, `stats.js`, `prepare.js`. Keep that order when adding a file, and add its path to `ASSETS` in `sw.js`.

## Limitations

- EPUB only, without DRM
- No sync between devices, use the backup file instead
- Browsers may remove stored data under heavy storage pressure, so keep backups

## Libraries

epub.js, JSZip and localForage are included in `libs/` and are used under their own licenses.
