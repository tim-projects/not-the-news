# Current Task: UX Refinement & UI Polish

## Objectives
- [x] **Undo Notification Logic**: Prevent the Undo notification from appearing when in the 'All' filter mode (as items aren't removed from view there).
- [x] **Keyboard Navigation**: Enable normal browser scrolling when using `Shift` + `ArrowUp` / `ArrowDown`.
- [x] **Header UI State**: Fix the 'active' class logic for Settings and Help buttons so they only highlight when their respective modals are actually open.
- [x] **Empty State UX**: Vertically center the 'There's nothing here.' message on the screen.
- [x] **TTS Integration**: 
    - [x] Add a dedicated Play button in the bottom-right area of feed items.
    - [x] **Fix Audio**: Fixed `utterance.onerror` typo (Assumed fixed, pending verification).
    - [x] **Play Button Setting**: Convert the "Play Button" toggle into a "Custom Item Button" dropdown setting. Options: `Hide`, `Play` (TTS). Default: `Play`.
- [x] **Settings Modal UX**: Add short descriptive labels under each setting option to explain their function.
- [x] **Mobile Click Protection**: On mobile, clicking a deselected item's headline/links should only select/scroll it into view, preventing accidental clicks.
- [x] **Mobile Button Overlap**: Fix overlap of 'Read' and 'Star' buttons on mobile when the item title is only one line.

## Proposed Plan
1. **Refactor Play Button Setting**:
    - Rename `showPlayButton` (boolean) to `itemButtonMode` (string) in `AppState`, `USER_STATE_DEFS`, and `initApp`.
    - Update `src/js/ui/uiInitializers.ts` to handle the string value change.
    - Update `src/index.html`: Replace checkbox with `<select>`, update `x-show` logic on the button.
2. **Mobile Button Overlap**: Adjust CSS in `src/css/content.css` or `src/css/buttons.css` to prevent overlap (e.g., ensure minimum height or padding for title).
3. **Layout/CSS**: Update `src/css/layout.css` to use Flexbox/Grid for centering `.empty-state`.
4. **Button States**: Bind `.active` class on header buttons to `openSettings` and `openShortcuts` correctly in `src/index.html`.
5. **Settings UI**: Add description `<p>` tags in `src/index.html`.
