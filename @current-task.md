# Task: Help Modal Refactor and Star Animation Update

## Objective
1. Set star animation opacity to 66%.
2. Refactor the shortcuts help modal to look like a feed item and slide into view from the right, shifting the main feed to the left.

## Implementation Steps

### 1. Update Star Animation
- [ ] Update `.star-outline` opacity to `0.66` in `src/css/content.css`.

### 2. Prepare Layout for Sliding Animation
- [ ] Wrap `#header`, `#items`, and the new shortcuts panel in a sliding container.
- [ ] Add CSS for the sliding transition in `src/css/layout.css`.
- [ ] Define the `.shifted` state to move the container left.

### 3. Refactor Shortcuts Help
- [ ] Move shortcuts help content from a standard modal to a side panel in `src/index.html`.
- [ ] Style the side panel to match an `.item` article in `src/css/content.css` or `src/css/modal.css`.
- [ ] Implement the sliding logic controlled by `openShortcuts`.

### 4. Animation and Centering
- [ ] Ensure the shortcuts panel centers correctly on desktop when active.
- [ ] Handle transition for closing (sliding back to the right).

### 5. Verification
- [ ] Build and test the sliding effect.
- [ ] Ensure keyboard shortcuts still work correctly to toggle the state.
