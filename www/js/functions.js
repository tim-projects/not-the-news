import { dbPromise } from "./database.js";

export function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

export function attachScrollToTopHandler(buttonId = "scroll-to-top") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  let idleTimeout = null;
  window.addEventListener("scroll", () => {
    btn.classList.add("visible");
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => { btn.classList.remove("visible"); }, 1200);
  });
}

export function formatDate(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffInSeconds = Math.floor((now - date) / 1000);
  const twoWeeks = 2 * 7 * 24 * 60 * 60;

  if (diffInSeconds > twoWeeks) {
    return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const minutes = Math.floor(diffInSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (diffInSeconds < 60) { return "Just now"; }
  else if (minutes < 60) { return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`; }
  else if (hours < 24) { return `${hours} hour${hours !== 1 ? "s" : ""} ago`; }
  else if (days < 7) { return `${days} day${days !== 1 ? "s" : ""} ago`; }
  else { const weeks = Math.floor(days / 7); return `${weeks} week${weeks !== 1 ? "s" : ""} ago`; }
}

export async function setFilter(state, mode) {
  state.filterMode = mode;
  const db = await dbPromise;
  const tx = db.transaction("userState", "readwrite");
  tx.objectStore("userState").put({ key: "filterMode", value: mode });
  await tx.done;
}

export function updateCounts() {
  const hiddenSet = new Set(this.hidden.map(entry => entry.id));
  const starredSet = new Set(this.starred.map(s => s.id));

  const allCount = this.entries.length;
  const hiddenCount = this.entries.filter(e => hiddenSet.has(e.id)).length;
  const starredCount = this.entries.filter(e => starredSet.has(e.id)).length;

    // CHANGED: Calculate unreadCount based on currentDeckGuids
    const currentDeckGuidsSet = new Set(this.currentDeckGuids);
    const unreadInDeckCount = this.entries.filter(entry =>
        currentDeckGuidsSet.has(entry.id) && !hiddenSet.has(entry.id)
    ).length;

  const select = document.getElementById('filter-selector');
  if (!select) return;
  Array.from(select.options).forEach(opt => {
    switch (opt.value) {
      case 'all': opt.text = `All (${allCount})`; break;
      case 'hidden': opt.text = `Hidden (${hiddenCount})`; break;
      case 'starred': opt.text = `Starred (${starredCount})`; break;
      case 'unread': opt.text = `Unread (${unreadInDeckCount})`; break; // UPDATED: Use unreadInDeckCount
    }
  });
}

export function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function loadFilterMode() {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('filterMode');
  return entry?.value ?? 'unread';
}

export function mapRawItems(rawList, formatDate) {
  return rawList.map(item => {
    const raw = item.desc || "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");

    const imgElem = doc.querySelector("img");
    const imageUrl = imgElem ? imgElem.src : "";
    if (imgElem) imgElem.remove();

    let sourceUrl = "";
    const sourceElem = doc.querySelector(".source-url") || doc.querySelector("a");
    if (sourceElem) {
      sourceUrl = sourceElem.textContent.trim();
      sourceElem.remove();
    } else {
      sourceUrl = item.link ? new URL(item.link).hostname : "";
    }

    const description = doc.body.innerHTML.trim();
    const timestamp = Date.parse(item.pubDate) || 0;

    return {
      id: item.guid,
      image: imageUrl,
      title: item.title,
      link: item.link,
      pubDate: formatDate(item.pubDate || ""),
      description,
      source: sourceUrl,
      timestamp,
    };
  }).sort((a, b) => b.timestamp - a.timestamp);
}