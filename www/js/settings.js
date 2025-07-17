import { dbPromise, bufferedChanges, saveShuffleState, loadShuffleState } from "./database.js";

export async function loadSyncEnabled() {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('syncEnabled');
  return entry?.value ?? true;
}

export async function loadImagesEnabled() {
  const db = await dbPromise;
  const entry = await db.transaction('userState', 'readonly').objectStore('userState').get('imagesEnabled');
  return entry?.value ?? true;
}

export function initSync(app) {
  const toggle = document.getElementById('sync-toggle');
  const syncText = document.getElementById('sync-text');
  if (!toggle || !syncText) return;
  toggle.checked = app.syncEnabled;
  bufferedChanges.push({ key: 'settings', value: { syncEnabled: app.syncEnabled } });
  toggle.addEventListener('change', async () => {
    app.syncEnabled = toggle.checked;
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'syncEnabled', value: app.syncEnabled });
    await tx.done;
    syncText.textContent = app.syncEnabled ? 'yes' : 'no';
    if (app.syncEnabled) {
      console.log("AutoSync enabled – kicking off full feed sync");
      app.init();
    }
  });
}

export function initImages(app) {
  const toggle = document.getElementById('images-toggle');
  const imagesText = document.getElementById('images-text');
  if (!toggle || !imagesText) return;
  toggle.checked = app.imagesEnabled;
  bufferedChanges.push({ key: 'settings', value: { imagesEnabled: app.imagesEnabled } });
  toggle.addEventListener('change', async () => {
    app.imagesEnabled = toggle.checked;
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'imagesEnabled', value: app.imagesEnabled });
    await tx.done;
    imagesText.textContent = app.imagesEnabled ? 'yes' : 'no';
  });
}

export async function initTheme() {
  const html = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const themeText = document.getElementById('theme-text');
  if (!toggle || !themeText) return;
  let saved;
  try {
    const db = await dbPromise;
    const e = await db.transaction('userState', 'readonly').objectStore('userState').get('theme');
    saved = e?.value;
  } catch {
    saved = null;
  }
  const useDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  html.classList.add(useDark ? 'dark' : 'light');
  toggle.checked = useDark;
  themeText.textContent = useDark ? 'dark' : 'light';
  toggle.addEventListener('change', async () => {
    const newTheme = toggle.checked ? 'dark' : 'light';
    html.classList.toggle('dark', toggle.checked);
    html.classList.toggle('light', !toggle.checked);
    const db = await dbPromise;
    const tx = db.transaction('userState', 'readwrite');
    tx.objectStore('userState').put({ key: 'theme', value: newTheme });
    await tx.done;
    themeText.textContent = newTheme;
    bufferedChanges.push({ key: 'settings', value: { theme: newTheme } });
  });
}

export async function initScrollPos(app) {
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
  const db2 = await dbPromise;
  const savedY = (await db2.transaction('userState', 'readonly').objectStore('userState').get('feedScrollY'))?.value;
  if (!savedY || savedY === '0') return;
  window.requestAnimationFrame(async () => {
    const link = (await db2.transaction('userState', 'readonly').objectStore('userState').get('feedVisibleLink'))?.value;
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

export async function initShuffleCount(app) {
  const { shuffleCount, lastShuffleResetDate } = await loadShuffleState();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let shouldReset = false;
  if (!lastShuffleResetDate || lastShuffleResetDate.toDateString() !== today.toDateString()) {
    shouldReset = true;
  }
  if (shouldReset) {
    app.shuffleCount = 2;
    await saveShuffleState(app.shuffleCount, today);
  } else {
    app.shuffleCount = shuffleCount;
  }
  const shuffleCountSpan = document.getElementById('shuffle-count-display');
  if (shuffleCountSpan) {
    shuffleCountSpan.textContent = app.shuffleCount;
  }
}

function showRssFeeds(app) {
  app.modalView = 'rss';
  document.getElementById('main-settings').style.display = 'none';
  document.getElementById('rss-settings-block').style.display = 'block';
  document.getElementById('back-button').style.display = 'block';
  fetch(`/load-config?filename=feeds.txt`)
    .then(r => r.json())
    .then(data => {
      app.rssFeedsInput = data.content || "";
      const rssArea = document.getElementById("rss-feeds-textarea");
      if (rssArea) rssArea.value = app.rssFeedsInput;
    })
    .catch(e => console.error("Error loading feeds:", e));
}

function showKeywordBlacklist(app) {
  app.modalView = 'keywords';
  document.getElementById('main-settings').style.display = 'none';
  document.getElementById('keywords-settings-block').style.display = 'block';
  document.getElementById('back-button').style.display = 'block';
  fetch(`/load-config?filename=filter_keywords.txt`)
    .then(r => r.json())
    .then(data => (
      app.keywordBlacklistInput = (data.content || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).join("\n"),
      document.getElementById("keywords-blacklist-textarea") && (document.getElementById("keywords-blacklist-textarea").value = app.keywordBlacklistInput)
    ))
    .catch(e => console.error("Error loading keywords:", e));
}

function goBackToMainSettings(app) {
  app.modalView = 'main';
  document.getElementById('main-settings').style.display = 'block';
  document.getElementById('rss-settings-block').style.display = 'none';
  document.getElementById('keywords-settings-block').style.display = 'none';
  document.getElementById('back-button').style.display = 'none';
}

export async function initConfigComponent(app) {
  app.modalView = 'main';
  app.$watch("openSettings", value => {
    if (value) {
      goBackToMainSettings(app);
    }
  });
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
  document.getElementById("save-keywords-btn").addEventListener("click", () => {
    const kwArea = document.getElementById("keywords-blacklist-textarea");
    app.keywordBlacklistInput = kwArea ? kwArea.value : app.keywordBlacklistInput;
    fetch(`/save-config?filename=filter_keywords.txt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: app.keywordBlacklistInput }),
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
  document.getElementById("save-rss-btn").addEventListener("click", () => {
    const rssArea = document.getElementById("rss-feeds-textarea");
    app.rssFeedsInput = rssArea ? rssArea.value : app.rssFeedsInput;
    fetch(`/save-config?filename=feeds.txt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: app.rssFeedsInput }),
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