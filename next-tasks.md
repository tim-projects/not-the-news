# Future Features & Enhancements

## Theme Contrast & Accessibility Fixes
- **Audit All Themes:** Review all built-in themes to identify interactive elements (buttons, dropdowns, inputs) where text and background colors have insufficient contrast.
- **Fix Contrast Issues:** Standardize the use of CSS variables (like `--fg`, `--bg`, `--primary`) across all themes to ensure that text remains readable on all interactive components regardless of the active theme.

## User Account Management (GDPR & Security)
- **Delete Account:** Implement a feature to allow users to permanently delete their account and all associated data from Firebase/Firestore (GDPR compliance).
- **Password Management:** Add options for "Change Password" and "Password Reset" (utilizing Firebase Auth's built-in functionality).

## UI/UX Improvements
- **Configuration Shortcuts:** Add "Backup/Restore" buttons to the RSS configuration and Keyword Blacklist screens. These buttons should navigate the user to the Advanced Settings screen for easier access to data management.

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