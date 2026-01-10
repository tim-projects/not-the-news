# Interaction Assessment: Keyboard Shortcuts

This document verifies the global keyboard shortcuts and navigation behavior of the "Not The News" application.

## Verified Behaviors

### 1. Navigation (j/k and Arrow Keys)
- **Behavior:** Pressing `j` or `ArrowDown` moves selection to the next item. Pressing `k` or `ArrowUp` moves selection to the previous item.
- **Evidence:** 
```
[PAGE] log: Clicking first item...
[PAGE] log: First item classes: item entry selected-item sub-focused
(Test passes verifying class change on j/k press)
```

### 2. Action: Mark Read (r/m/Space/n)
- **Behavior:** Pressing `r` toggles the read status of the selected item. In "Unread Only" mode, marking an item as read hides it from the feed. Pressing `Space` marks it as read and automatically moves to the next item.
- **Evidence:**
```
[PAGE] log: [DB] Operation buffered with ID: 1 {type: readDelta, guid: ..., action: add, ...}
[PAGE] log: [DB] Successfully synced and removed immediate op 1 (readDelta).
(Test verifies item becomes hidden and 'u' brings it back)
```

### 3. Action: Toggle Star (s/L)
- **Behavior:** Pressing `s` or `L` toggles the starred status of the selected item.
- **Evidence:**
```
[PAGE] log: [DB] Operation buffered with ID: 1 {type: starDelta, guid: ..., action: add, ...}
[PAGE] log: [DB] Successfully synced and removed immediate op 1 (starDelta).
```

### 4. Utility: Search and Help (/ and ? and Escape)
- **Behavior:** `/` opens the search overlay. `?` opens the help sidebar (shifting the viewport). `Escape` closes any open overlay or modal.
- **Evidence:**
```
(Test verifies visibility of #search-overlay and .shifted class on #app-viewport)
```

### 5. Sub-element Focus (h/l and ArrowLeft/Right)
- **Behavior:** `l` moves focus from the item container to its buttons (Read -> Star -> Play/Menu). `h` moves focus back towards the container.
- **Evidence:**
```
(Test verifies .sub-focused class on .read-button, .star, and .menu-trigger)
```

### 6. Utility: Scroll Top (t)
- **Behavior:** Pressing `t` scrolls the feed container back to the top.
- **Evidence:**
```
(Test verifies window.scrollY is less than 100 after 't' press)
```

## Verification Logs
Test run on Sat Jan 10 2026:
```
Running 6 tests using 1 worker
...
  6 passed (1.0m)
```
