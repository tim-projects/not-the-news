# Human Test Plan: Item Selection & Interaction

## Objective
To verify and refine the "Click to Select" behavior, ensuring it prevents accidental clicks on partially visible items while maintaining a smooth reading experience. We will test both **Touch** and **Mouse** interactions separately.

---

## Environment A: Desktop (Mouse)
**Simulation:** Use a desktop browser or Chrome DevTools in "Desktop" mode (no touch simulation).

### 1. The "Peek" Test (Mouse)
*   **Setup:** Scroll down until a new item title is partially visible at the bottom.
*   **Action:** Click the **Article Title**.
*   **Goal:** Does it feel right to scroll instead of open? Desktop users are precise; maybe they *want* it to open even if near the edge.

### 2. The "Button Peek" Test (Mouse)
*   **Setup:** Title is at the bottom, button is near the edge.
*   **Action:** Click the **Read (X)** button.
*   **Goal:** Prevent accidental clear while using the scrollbar or wheel.

---

## Environment B: Mobile (Touch)
**Simulation:** Use a physical mobile device or Chrome DevTools "Device Toolbar" (Touch enabled).

### 1. The "Peek" Test (Touch)
*   **Setup:** Scroll down until a new item title is partially visible.
*   **Action:** Tap the **Article Title**.
*   **Goal:** Crucial for "Fat Finger" protection. Tapping a button that's just entering the screen often happens by mistake while flicking.

### 2. The "Selection Priority" Test (Touch)
*   **New Rule Idea:** Should we require an item to be **Selected** before *any* action button works on Mobile?
*   **Setup:** Tap a non-selected item that is fully in view.
*   **Action:** Tap the **Star**.
*   **Expected Result:** 
    *   Currently: It stars the item.
    *   Alternative: It selects the item first, requiring a second tap to star.

---

## Image Visibility Verification
**Goal:** Ensure all images (Main and Description) are appearing and fading in correctly.

### 1. Main Item Image
*   **Observation:** When an item with a picture enters the screen, it should be invisible (opacity 0) and then smoothly fade in.
*   **Failure Check:** If the image stays blank/white but takes up space, the logic is likely stuck.

### 2. Description Images
*   **Observation:** Scroll down into the text description.
*   **Failure Check:** Check if images inside the text are missing.

---

## Refinement Questions for User
1.  **Desktop Precision:** On Desktop, should we allow buttons to work even if the item is at the very bottom?
2.  **Double Tap:** On Mobile, would you prefer a "Tap to Select, Tap again to Action" rule for everything (including links)?