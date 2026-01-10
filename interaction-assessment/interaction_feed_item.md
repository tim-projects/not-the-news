# Interaction Assessment: Feed Items

This document verifies the interactions within individual feed items, including selection, actions, and media handling.

## Verified Behaviors

### 1. Container Selection
- **Behavior:** Clicking anywhere on an item's container selects it (adding the `.selected-item` class). Clicking another item deselects the previous one.
- **Evidence:** 
```
(Test verifies .selected-item class toggles between items)
```

### 2. Star and Read Button Toggles
- **Behavior:** Clicking the star button toggles its starred state. Clicking the read button marks the item as read (hiding it in unread-only mode). The "Undo" shortcut (`u`) can restore a recently read item.
- **Evidence:**
```
[PAGE] log: [DB] Operation buffered with ID: 1 {type: starDelta, ...}
[PAGE] log: [DB] Successfully synced and removed immediate op 1 (starDelta).
```

### 3. Menu Trigger and Popup
- **Behavior:** When `itemButtonMode` is set to 'menu', a hamburger menu trigger appears. Clicking it opens a popup with "Play" and "Share" actions.
- **Evidence:**
```
(Test verifies visibility of .item-popup-menu upon clicking .menu-trigger)
```

### 4. Image Expansion and Lightbox
- **Behavior:** Clicking an image for the first time shows an expansion overlay. A second click opens the image in a full-screen lightbox. The lightbox can be closed by clicking it or pressing `Escape`.
- **Evidence:**
```
(Test verifies visibility of #image-lightbox and its 'visible' class)
```

### 5. Link Clicks Coverage Logic ("Selection First" Pattern)
- **Behavior:** Links inside the item description have special handling. If the item covers less than 90% of the viewport (partially off-screen), the first click on a link selects the item instead of navigating. A second click while selected follows the link.
- **Evidence:**
```
[PAGE] log: [LinkClick] Item coverage: 45.1%
[PAGE] log: [LinkClick] Low coverage (45.1%), selecting item first.
(Test verifies .selected-item class is added after first click, and popup is opened after second click)
```

## Verification Logs
Test run on Sat Jan 10 2026:
```
Running 5 tests using 1 worker
...
  5 passed (54.0s)
```
