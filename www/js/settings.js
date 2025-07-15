// js/settings.js
import { dbPromise, bufferedChanges } from "./database.js";

/**
 * Load the saved syncEnabled flag from IndexedDB (default: true).
 * @returns {Promise<boolean>}
 */
export async function loadSyncEnabled() {
  const db = await dbPromise;
  const entry = await db
    .transaction('userState', 'readonly')
    .objectStore('userState')
    .get('syncEnabled');
  return entry?.value ?? true;
}

/**
 * Load the saved imagesEnabled flag from IndexedDB (default: true).
 * @returns {Promise<boolean>}
 */
export async function loadImagesEnabled() {
  const db = await dbPromise;
  const entry = await db
    .transaction('userState', 'readonly')
    .objectStore('userState')
    .get('imagesEnabled');
  return entry?.value ?? true;
}

// initialize the “refresh feed” toggle
export function initSync(app) {
  const toggle = document.getElementById('sync-toggle');
  const syncText = document.getElementById('sync-text');
  if (!toggle || !syncText) return;

  // reflect saved state
  toggle.checked = app.syncEnabled;
  bufferedChanges.push({ key: 'settings', value: { syncEnabled: app.syncEnabled } });

  toggle.addEventListener('change', async () => {
    app.syncEnabled = toggle.checked;
    // persist to IndexedDB
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'syncEnabled', value: app.syncEnabled });
    await tx.done;
    syncText.textContent = app.syncEnabled ? 'yes' : 'no';
    // ─── when they turn AutoSync ON, fire off a full sync + reload ───
    if (app.syncEnabled) {
      console.log("AutoSync enabled – kicking off full feed sync");
      app.init();  // re‑runs your entire init (pullUserState, performFullSync, load items, etc)
    }
  });
}

// initialize the “Show images” toggle
export function initImages(app) {
  const toggle = document.getElementById('images-toggle');
  const imagesText = document.getElementById('images-text');
  if (!toggle || !imagesText) return;

  // reflect saved state
  toggle.checked = app.imagesEnabled;
  bufferedChanges.push({ key: 'settings', value: { imagesEnabled: app.imagesEnabled } });

  toggle.addEventListener('change', async () => {
    app.imagesEnabled = toggle.checked;
    // persist to IndexedDB
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'imagesEnabled', value: app.imagesEnabled });
    await tx.done;
    imagesText.textContent = app.imagesEnabled ? 'yes' : 'no';
  });
}

// initialize the theme toggle
export async function initTheme() {
  const html = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const themeText = document.getElementById('theme-text');
  if (!toggle || !themeText) return;

  // load saved theme from IndexedDB
  let saved;
  try {
    const db = await dbPromise;
    const e = await db.transaction('userState', 'readonly').objectStore('userState').get('theme');
    saved = e?.value;
  } catch {
    saved = null;
  }
  const useDark = saved === 'dark'
    || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);

  html.classList.add(useDark ? 'dark' : 'light');
  toggle.checked = useDark;
  themeText.textContent = useDark ? 'dark' : 'light';

  toggle.addEventListener('change', async () => {
    const newTheme = toggle.checked ? 'dark' : 'light';
    html.classList.toggle('dark', toggle.checked);
    html.classList.toggle('light', !toggle.checked);

    // persist theme to IndexedDB
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'theme', value: newTheme });
    await tx.done;
    themeText.textContent = newTheme;
    // buffer this mutation for pushUserState()
    bufferedChanges.push({ key: 'settings', value: { theme: newTheme } });
  });
}
export async function initScrollPos(app) {
  // 1. Capture current scroll and first-visible link, persist to IndexedDB
  const scrollY = window.scrollY;
  const entries = document.querySelectorAll('.entry');
  const db = await dbPromise;
  const tx = db.transaction('userState', 'readwrite');
  tx.objectStore('userState').put({ key: 'feedScrollY', value: String(scrollY) });
  for (const el of entries) {
    if (el.getBoundingClientRect().top >= 0) {
      tx.objectStore('userState').put({ key: 'feedVisibleLink', value: el.dataset.link || '' });
      break;
    }
  }
  await tx.done;

  // 3. On next frame, restore from IndexedDB
  const db2 = await dbPromise;
  const savedY = (await db2.transaction('userState', 'readonly')
    .objectStore('userState')
    .get('feedScrollY'))?.value;
  if (!savedY || savedY === '0') return;

  window.requestAnimationFrame(async () => {
    const link = (await db2.transaction('userState', 'readonly')
      .objectStore('userState')
      .get('feedVisibleLink'))?.value;
    if (link) {
      const target = document.querySelector(`.entry[data-link="${link}"]`);
      if (target) {
        target.scrollIntoView({ block: 'start' });
        return;
      }
    }
    const y = Number(savedY) || 0;
    if (y) window.scrollTo({ top: y });
  });
}

// Function to show the RSS Feeds configuration
function showRssFeeds(app) {
  app.modalView = 'rss';
  document.getElementById('main-settings').style.display = 'none';
  document.getElementById('rss-settings-block').style.display = 'block';
  document.getElementById('back-button').style.display = 'block'; // Show back button
  // Load RSS feeds when showing the view
  fetch(`/load-config?filename=feeds.txt`)
    .then(r => r.json())
    .then(data => {
      app.feeds = data.content || "";
      const rssArea = document.getElementById("rss-feeds-textarea"); // Updated ID
      if (rssArea) rssArea.value = app.feeds;
    })
    .catch(e => console.error("Error loading feeds:", e));
}

// Function to show the Keyword Blacklist configuration
function showKeywordBlacklist(app) {
  app.modalView = 'keywords';
  document.getElementById('main-settings').style.display = 'none';
  document.getElementById('keywords-settings-block').style.display = 'block';
  document.getElementById('back-button').style.display = 'block'; // Show back button
  // Load keywords blacklist when showing the view
  fetch(`/load-config?filename=filter_keywords.txt`)
    .then(r => r.json())
    .then(data => (
      app.keywords = (data.content || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).join("\n"),
      document.getElementById("keywords-blacklist-textarea") && (document.getElementById("keywords-blacklist-textarea").value = app.keywords) // Updated ID
    ))
    .catch(e => console.error("Error loading keywords:", e));
}

// Function to go back to main settings
function goBackToMainSettings(app) {
  app.modalView = 'main';
  document.getElementById('main-settings').style.display = 'block';
  document.getElementById('rss-settings-block').style.display = 'none';
  document.getElementById('keywords-settings-block').style.display = 'none';
  document.getElementById('back-button').style.display = 'none'; // Hide back button
}

export async function initConfigComponent(app) {
  // Initialize modalView state
  app.modalView = 'main'; // 'main', 'rss', or 'keywords'

  // 1) When the modal opens, ensure correct view is shown/hidden
  app.$watch("openSettings", value => {
    if (value) {
      // Always show main settings first when opening the modal
      goBackToMainSettings(app);
    }
  }); // end app.$watch

  // Wire up the new Configure buttons
  const rssConfigureBtn = document.getElementById('configure-rss-feeds-btn');
  if (rssConfigureBtn) {
    rssConfigureBtn.addEventListener('click', () => showRssFeeds(app));
  }

  const keywordConfigureBtn = document.getElementById('configure-keyword-blacklist-btn');
  if (keywordConfigureBtn) {
    keywordConfigureBtn.addEventListener('click', () => showKeywordBlacklist(app));
  }

  const backButton = document.getElementById('back-button');
  if (backButton) {
    backButton.addEventListener('click', () => goBackToMainSettings(app));
  }

  // Create inline "Saved." message spans if they're not already in the DOM
  const kwBtn = document.getElementById("save-keywords-btn");
  let kwMsg = document.getElementById("keywords-save-msg");
  if (kwBtn && !kwMsg) {
    kwMsg = document.createElement("span");
    kwMsg.id = "keywords-save-msg";
    kwMsg.className = "save-message";
    kwMsg.style.marginLeft = "0.5em";
    kwMsg.style.display = "none";
    kwBtn.parentNode.insertBefore(kwMsg, kwBtn);
  }

  const rssBtn = document.getElementById("save-rss-btn");
  let rssMsg = document.getElementById("rss-save-msg");
  if (rssBtn && !rssMsg) {
    rssMsg = document.createElement("span");
    rssMsg.id = "rss-save-msg";
    rssMsg.className = "save-message";
    rssMsg.style.marginLeft = "0.5em";
    rssMsg.style.display = "none";
    rssBtn.parentNode.insertBefore(rssMsg, rssBtn);
  }

  // 2) Wire up save actions:
  document.getElementById("save-keywords-btn")
    .addEventListener("click", () => {
      const kwArea = document.getElementById("keywords-blacklist-textarea"); // Updated ID
      app.keywords = kwArea ? kwArea.value : app.keywords;
      fetch(`/save-config?filename=filter_keywords.txt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: app.keywords }),
      })
        .then(r => {
          if (!r.ok) throw new Error("Failed to save keywords");
          console.log("Keywords saved");
          if (kwMsg) {
            kwMsg.textContent = "Saved.";
            kwMsg.style.display = "inline";
            setTimeout(() => kwMsg.style.display = "none", 2000);
          }
        })
        .catch(e => console.error(e));
    });

  document.getElementById("save-rss-btn")
    .addEventListener("click", () => {
      const rssArea = document.getElementById("rss-feeds-textarea"); // Updated ID
      app.feeds = rssArea ? rssArea.value : app.feeds;
      fetch(`/save-config?filename=feeds.txt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: app.feeds }),
      })
        .then(r => {
          if (!r.ok) throw new Error("Failed to save feeds");
          console.log("Feeds saved");
          if (rssMsg) {
            rssMsg.textContent = "Saved.";
            rssMsg.style.display = "inline";
            setTimeout(() => rssMsg.style.display = "none", 2000);
          }
        })
        .catch(e => console.error(e));
    });
 }