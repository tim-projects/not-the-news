# Current Task: Add Global Font Size Scaling

## Objective
Add a locally stored setting to allow users to increase or decrease the global font size (50% to 200%).
1.  Add a `fontSize` property to `AppState` and `dbUserState` (local storage only).
2.  Create a UI control (slider or range input) in the settings modal to adjust the percentage.
3.  Implement logic to apply the font size scaling to the `html` or `body` element using a CSS variable or `font-size` percentage.
4.  Ensure the setting persists across reloads but is not synced to the backend (device-specific).

## Progress
- [x] Add `fontSize` to `AppState` and `dbUserState`.
- [x] Implement font size application logic (CSS variable `--font-scale` or similar).
- [x] Add font size slider to settings UI.
- [x] Verify functionality and persistence.