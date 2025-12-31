# Future Features & Enhancements

## Text-to-Speech Enhancements
- Control speed/voice with utterance.rate and utterance.voice, pausing via speechSynthesis.pause(). Add event listeners for article load to auto-read or use a shortcut like 'v'.

---

## Reader View / Extractor Integration
- `o` key opens the website article in the right side pane (using the extractor).
- `Shift+o` opens the website in a new tab.
- Folders for website-specific extractor modules or a generic extraction module.
- Expose per-website settings to users for custom extraction rules (with upstream submission support).

---

## Play Icon Visibility Scroll
- If using keyboard navigation and an item description is long, ensure the "Play" icon is scrolled into view when selected.
- Logic: Only scroll if the bottom of the item (or the icon itself) is currently off-screen.