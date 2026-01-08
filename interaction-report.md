# Interaction Report: Not The News

This report lists every possible user interaction within the application, categorized by functional area.

## 1. Global Navigation & Header
- **Search Button (`#search-button`)**: Toggle search bar visibility.
- **Help Button (`#help-button`)**: Toggle keyboard shortcuts panel.
- **Shuffle Button (`#shuffle-button`)**: Trigger feed shuffle (re-decking).
- **Settings Button (`#settings-button`)**: Toggle main settings modal.
- **Title Click (`#ntn-title h2`)**: Implicitly scrolls to top (via header click if sticky, though currently relative).
- **Sliding Container Click (`@click.self`)**: Deselects current item and closes shortcuts panel.

## 2. Search Overlay
- **Search Input (`#search-input`)**: Type to filter feed items by title or description.
- **Escape Key on Search Input**: Close search bar.
- **Search Close Button (`.search-close`)**: Close search bar.

## 3. Feed Item (Article Card)
- **Item Container Click**: Selects the item (if not already selected).
- **Menu Trigger Button (`.menu-trigger`)**:
    - If `itemButtonMode` is `play`: Starts/Stops Text-to-Speech (TTS).
    - If `itemButtonMode` is `menu`: Toggles the item's popup menu.
- **Popup Menu Items**:
    - **Play Button**: Start TTS for the item.
    - **Share Button**: Trigger sharing (currently a placeholder).
- **Item Title Click**:
    - If item is partially off-screen at bottom: Selects item and prevents link opening.
    - If item is fully visible: Selects item and allows normal behavior.
- **Read Button (`.read-button`)**:
    - If item is partially off-screen at bottom: Selects item.
    - If item is fully visible: Toggles read status (with animations).
- **Star Button (`.star`)**:
    - If item is partially off-screen at bottom: Selects item.
    - If item is fully visible: Toggles starred status.
- **Link Clicks (`a` tags in description)**:
    - If item coverage > 90%: Opens link immediately.
    - If item coverage < 90%: Selects item first, requires second click to open.
- **Main Image Click (`.entry-image`)**:
    - First click: Shows expand icon overlay.
    - Second click (or click on expand icon): Opens image in fullscreen lightbox.
- **Fullscreen Lightbox Click**: Closes the lightbox.
- **Escape Key (Lightbox)**: Closes the lightbox.

## 4. Keyboard Shortcuts (Global)
- **`j` / `ArrowDown`**: Move selection to next item.
- **`k` / `ArrowUp`**: Move selection to previous item.
- **`Space` / `n`**: Mark current item as read and move to next.
- **`s` / `L`**: Toggle star status for current item.
- **`/`**: Toggle search bar.
- **`i`**: Toggle image visibility.
- **`p`**: Read current item out loud (TTS).
- **`o` / `Enter`**:
    - If `item` sub-element focused: Open article link in new tab.
    - If `read` button sub-element focused: Toggle read status.
    - If `star` button sub-element focused: Toggle star status.
    - If `play` button sub-element focused: Toggle menu or play TTS.
- **`r` / `m`**: Toggle read status for current item.
- **`t`**: Scroll to top of the feed.
- **`u`**: Undo last "Mark as Read" action.
- **`?` / `Ctrl + k`**: Toggle keyboard shortcuts panel.
- **`h` / `ArrowLeft`**: Move sub-element focus left (Play -> Star -> Read -> Item).
- **`l` / `ArrowRight`**: Move sub-element focus right (Item -> Read -> Star -> Play).
- **`Ctrl + z`**: Undo last "Mark as Read" action.
- **`Escape`**:
    - Close shortcuts panel.
    - Close settings modal.
    - Deselect current item.

## 5. Settings Modal
- **Back Button (`#back-button`)**: Navigate back in sub-menus (Backup/Restore/Appearance -> Main).
- **Close Button (`.close`)**: Close settings modal (prompts if settings are dirty).
- **Filter View Selector (`#filter-selector`)**: Change feed view (Unread, Starred, Read, All).
- **Auto-Sync Toggle (`#sync-toggle`)**: Enable/Disable background sync.
- **Appearance Button**: Navigate to Appearance sub-menu.
- **Behavior Button**: Navigate to Behavior sub-menu.
- **RSS Feeds Button**: Navigate to RSS configuration.
- **Keyword Blacklist Button**: Navigate to Blacklist configuration.
- **Install Button**: Trigger PWA installation (if available).
- **Advanced Settings Button**: Navigate to Advanced sub-menu.

### 5.1 Appearance Sub-menu
- **Theme Selector (`#theme-style-selector`)**: Change theme and color style.
- **Title Font Selector (`#font-title-selector`)**: Change title font family.
- **Body Font Selector (`#font-body-selector`)**: Change content font family.
- **Font Size Slider/Buttons**: Increase/Decrease base font size.
- **Feed Width Slider/Buttons**: Adjust content area width (Desktop only).
- **Animation Speed Slider/Buttons**: Adjust UI transition speeds.
- **Custom CSS Button**: Navigate to CSS editor.
- **Show Images Toggle**: Enable/Disable image visibility.
- **Item Shadows Toggle**: Toggle card shadows.
- **Curves Toggle**: Toggle rounded corners.

### 5.2 Behavior Sub-menu
- **Item Button Mode Selector**: Change item button function (Menu, Play, Hide).
- **Open Links in New Tab Toggle**: Toggle link opening behavior.

### 5.3 RSS Feeds Sub-menu
- **Auto-Discover Input**: Enter URL for feed scanning.
- **Find Feed Button**: Trigger discovery scan.
- **Discovery Results**: Add discovered feeds to list.
- **RSS Feeds Textarea**: Manually edit feed URLs.
- **Save Feeds Button**: Persist changes and trigger full sync.

### 5.4 Keyword Blacklist Sub-menu
- **Blacklist Textarea**: Edit filtered keywords.
- **Save Keywords Button**: Persist changes.

### 5.5 Custom CSS Sub-menu
- **CSS Textarea**: Enter custom styles.
- **Reset to Default Button**: Revert to template CSS.
- **Save CSS Button**: Apply and persist styles.

### 5.6 Advanced Sub-menu
- **Backup Button**: Navigate to Backup selections.
- **Restore Button**: Trigger file picker for restoration.
- **Change Password Button**: Navigate to password change form.
- **Logout Button**: Sign out of account.
- **Reset Application Button**: Clear local data and re-sync.
- **Delete Account Button**: Permanent account removal.

### 5.7 Backup Sub-menu
- **Category Checkboxes**: Select data to include in backup.
- **Download Backup Button**: Generate and download JSON file.

### 5.8 Restore Sub-menu
- **Category Checkboxes**: Select data to restore from file.
- **Confirm Restore Button**: Apply file data and reload.
- **Cancel Button**: Return to Advanced settings.

### 5.9 Change Password Sub-menu
- **New Password Input**: Enter new password.
- **Update Password Button**: Submit password change.
- **Cancel Button**: Return to Advanced settings.

## 6. Footer & Status
- **Scroll to Top Button (`#scroll-to-top`)**: Quick scroll to the start of the feed.
- **Undo Notification Button**: Perform undo within the 5-second window.
- **Offline Status Bar**: Displayed when connectivity is lost.
