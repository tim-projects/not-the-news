import { dbPromise, bufferedChanges, saveShuffleState, loadShuffleState } from "./database.js";

async function setupBooleanToggle(app, toggleId, textId, dbKey, onToggleCallback = () => {}) {
	const toggle = document.getElementById(toggleId);
	const text = document.getElementById(textId);
	if (!toggle || !text) return;

	const db = await dbPromise;
	const entry = await db.transaction('userState', 'readonly').objectStore('userState').get(dbKey);
	app[dbKey] = entry?.value ?? true;

	toggle.checked = app[dbKey];
	text.textContent = app[dbKey] ? 'yes' : 'no';

	toggle.addEventListener('change', async () => {
		app[dbKey] = toggle.checked;
		const tx = db.transaction('userState', 'readwrite');
		tx.objectStore('userState').put({ key: dbKey, value: app[dbKey] });
		await tx.done;
		text.textContent = app[dbKey] ? 'yes' : 'no';
		bufferedChanges.push({ key: 'settings', value: { [dbKey]: app[dbKey] } });
		onToggleCallback(app[dbKey]);
	});
}

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

export async function initSync(app) {
	await setupBooleanToggle(app, 'sync-toggle', 'sync-text', 'syncEnabled', (enabled) => {
		if (enabled) {
			console.log("AutoSync enabled – kicking off full feed sync");
			app.init();
		}
	});
}

export async function initImages(app) {
	await setupBooleanToggle(app, 'images-toggle', 'images-text', 'imagesEnabled');
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

async function manageSettingsPanelVisibility(app) {
	const main = document.getElementById('main-settings');
	const rss = document.getElementById('rss-settings-block');
	const keywords = document.getElementById('keywords-settings-block');
	const backBtn = document.getElementById('back-button');
	const rssArea = document.getElementById("rss-feeds-textarea");
	const kwArea = document.getElementById("keywords-blacklist-textarea");

	main.style.display = 'none';
	rss.style.display = 'none';
	keywords.style.display = 'none';
	backBtn.style.display = 'none';

	switch (app.modalView) {
		case 'main': main.style.display = 'block'; break;
		case 'rss':
			rss.style.display = 'block';
			backBtn.style.display = 'block';
			if (rssArea && app.rssFeedsInput !== undefined) rssArea.value = app.rssFeedsInput;
			break;
		case 'keywords':
			keywords.style.display = 'block';
			backBtn.style.display = 'block';
			if (kwArea && app.keywordBlacklistInput !== undefined) kwArea.value = app.keywordBlacklistInput;
			break;
	}
}

function createAndShowSaveMessage(btn, msgId, message) {
	let msgElem = document.getElementById(msgId);
	if (!msgElem) {
		msgElem = document.createElement("span");
		msgElem.id = msgId;
		msgElem.className = "save-message";
		msgElem.style.marginLeft = "0.5em";
		msgElem.style.display = "none";
		btn.parentNode.insertBefore(msgElem, btn);
	}
	msgElem.textContent = message;
	msgElem.style.display = "inline";
	setTimeout(() => msgElem.style.display = "none", 2000);
}

export async function initConfigComponent(app) {
	app.modalView = 'main';

	app.$watch("openSettings", async value => {
		if (value) {
			app.modalView = 'main';
			await manageSettingsPanelVisibility(app);
		}
	});

	app.$watch("modalView", async () => {
		await manageSettingsPanelVisibility(app);
	});

	const rssConfigureBtn = document.getElementById('configure-rss-feeds-btn');
	if (rssConfigureBtn) {
		rssConfigureBtn.addEventListener('click', async () => {
			const data = await fetch(`/load-config?filename=feeds.txt`).then(r => r.json());
			app.rssFeedsInput = data.content || "";
			app.modalView = 'rss';
		});
	}

	const keywordConfigureBtn = document.getElementById('configure-keyword-blacklist-btn');
	if (keywordConfigureBtn) {
		keywordConfigureBtn.addEventListener('click', async () => {
			const data = await fetch(`/load-config?filename=filter_keywords.txt`).then(r => r.json());
			app.keywordBlacklistInput = (data.content || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).join("\n");
			app.modalView = 'keywords';
		});
	}

	const backButton = document.getElementById('back-button');
	if (backButton) {
		backButton.addEventListener('click', () => {
			app.modalView = 'main';
		});
	}

	const kwBtn = document.getElementById("save-keywords-btn");
	if (kwBtn) {
		kwBtn.addEventListener("click", () => {
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
				createAndShowSaveMessage(kwBtn, "keywords-save-msg", "Saved.");
			})
			.catch(e => console.error(e));
		});
	}

	const rssBtn = document.getElementById("save-rss-btn");
	if (rssBtn) {
		rssBtn.addEventListener("click", () => {
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
				createAndShowSaveMessage(rssBtn, "rss-save-msg", "Saved.");
			})
			.catch(e => console.error(e));
		});
	}
}