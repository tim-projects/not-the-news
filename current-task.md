# Current Task: Add Theme Styles

## Objective
Add a 'Theme Style' dropdown to the settings modal that allows users to choose from various theme presets.
1. Create 4 additional themes (2 light, 2 dark) in separate CSS files.
2. Add a dropdown UI element that filters options based on the current Light/Dark mode.
3. Implement logic to persist and apply selected theme styles.
4. Ensure selected light and dark theme styles are remembered independently when switching modes.

## Progress
- [x] Create theme CSS files.
- [x] Update AppState type and database schemas.
- [x] Implement theme switching logic in main.ts.
- [x] Add dropdown to settings modal.
- [x] Verify functionality.
- [ ] Update `AppState` and database to store `themeStyleLight` and `themeStyleDark`.
- [ ] Update `toggleTheme` logic to swap between stored light and dark styles.
- [ ] Update `saveThemeStyle` to update the specific style for the current mode.
- [ ] Verify independent persistence of light/dark styles.