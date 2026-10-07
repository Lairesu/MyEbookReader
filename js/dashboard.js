// dashboard.js - draws the reading dashboard
// This page shares the browser storage of the reader (same site, same localForage store),
// so it can read "library", "readlog" and "settings" directly.

const $ = (id) => document.getElementById(id);
let library = {};
let readLog = {}; // "2026-10-07" -> [seconds in hour 0 ... hour 23]
let range = 7; // days shown in the two time charts
let year = new Date().getFullYear(); // year shown in the finished-books chart

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const daySeconds = (key) => sum(readLog[key] || []);

function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? "under 1 min" : "0 min";
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
}

// the last n days, oldest first, ending today
function lastDays(n) {
  const now = new Date();
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
  }
  return days;
}

// items: [{ label, value, tip }]. step = show every nth label. Tap a bar to read its value.
function drawBars(id, readoutId, items, { cls = "", step = 1 } = {}) {
  const box = $(id);
  box.innerHTML = "";
  const max = Math.max(0, ...items.map((i) => i.value));

  items.forEach((it, idx) => {
    const col = document.createElement("div");
    col.className = "dash-col";
    col.title = it.tip;

    const wrap = document.createElement("div");
    wrap.className = "dash-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "dash-bar " + cls;
    bar.style.height = max
      ? Math.max((it.value / max) * 100, it.value > 0 ? 2 : 0) + "%"
      : "0";
    wrap.append(bar);

    const lab = document.createElement("div");
    lab.className = "dash-lab";
    if (idx % step === 0) {
      const s = document.createElement("span");
      s.textContent = it.label;
      lab.append(s);
    }

    col.append(wrap, lab);
    col.addEventListener("click", () => ($(readoutId).textContent = it.tip));
    box.append(col);
  });
  $(readoutId).textContent = max ? "Tap a bar for details." : "";
}

function render() {
  const now = new Date();

  // summary cards
  const week = sum(lastDays(7).map((d) => daySeconds(dayKey(d))));
  const total = sum(Object.values(readLog).map(sum));
  const finishedThisYear = Object.values(library).filter(
    (b) =>
      b.finishedAt &&
      new Date(b.finishedAt).getFullYear() === now.getFullYear(),
  ).length;
  $("stat-today").textContent = fmtTime(daySeconds(dayKey(now)));
  $("stat-week").textContent = fmtTime(week);
  $("stat-total").textContent = fmtTime(total);
  $("stat-finished").textContent = String(finishedThisYear);
  $("stat-finished-label").textContent = `Finished in ${now.getFullYear()}`;
  $("dash-empty").classList.toggle("hidden", total > 0);

  // time read per day
  const days = lastDays(range);
  drawBars(
    "chart-days",
    "readout-days",
    days.map((d) => ({
      label:
        range <= 7
          ? d.toLocaleDateString(undefined, { weekday: "short" })
          : String(d.getDate()),
      value: daySeconds(dayKey(d)),
      tip:
        d.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }) +
        ": " +
        fmtTime(daySeconds(dayKey(d))),
    })),
    { step: range <= 7 ? 1 : range <= 30 ? 3 : 10 },
  );

  // time read per hour of the day, added up over the chosen range
  const hours = new Array(24).fill(0);
  days.forEach((d) => {
    const row = readLog[dayKey(d)] || [];
    for (let h = 0; h < 24; h++) hours[h] += row[h] || 0;
  });
  drawBars(
    "chart-hours",
    "readout-hours",
    hours.map((sec, h) => ({
      label: pad(h),
      value: sec,
      tip: `${pad(h)}:00 to ${pad(h)}:59: ${fmtTime(sec)}`,
    })),
    { cls: "green", step: 3 },
  );

  // books finished per month of the chosen year
  $("year-label").textContent = String(year);
  $("year-next").disabled = year >= now.getFullYear();
  const finished = Object.values(library).filter(
    (b) => b.finishedAt && new Date(b.finishedAt).getFullYear() === year,
  );
  const perMonth = new Array(12).fill(0);
  finished.forEach((b) => perMonth[new Date(b.finishedAt).getMonth()]++);
  drawBars(
    "chart-months",
    "readout-months",
    perMonth.map((count, m) => {
      const name = new Date(year, m, 1).toLocaleDateString(undefined, {
        month: "short",
      });
      return {
        label: name,
        value: count,
        tip: `${name} ${year}: ${count} book${count === 1 ? "" : "s"}`,
      };
    }),
    { cls: "gold" },
  );

  const list = $("finished-list");
  list.innerHTML = "";
  finished
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .forEach((b) => {
      const li = document.createElement("li");
      li.textContent =
        `${b.title || "Untitled"} - ` +
        new Date(b.finishedAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        });
      list.append(li);
    });
}

async function init() {
  const s = await localforage.getItem("settings");
  document.body.className = !s || s.theme === "light" ? "" : "theme-" + s.theme;
  library = (await localforage.getItem("library")) || {};
  readLog = (await localforage.getItem("readlog")) || {};

  $("range-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    range = Number(chip.dataset.days);
    document
      .querySelectorAll("#range-chips .chip")
      .forEach((c) => c.classList.toggle("active", c === chip));
    render();
  });
  $("year-prev").addEventListener("click", () => {
    year--;
    render();
  });
  $("year-next").addEventListener("click", () => {
    year++;
    render();
  });
  render();
}

init();
