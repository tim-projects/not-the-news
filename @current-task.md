# Current Task: RSS Feed Auto-Discovery

## Objectives
- [ ] **Discovery Logic**: Implement JavaScript logic to fetch a website and find its RSS feed URL by parsing `<link>` tags or checking response headers.
- [ ] **Discovery UI**: Add an "Add by Website URL" input and button at the top of the RSS feed configuration screen.
- [ ] **Feedback Mechanism**: Provide clear feedback (success/error messages) during the discovery process.
- [ ] **Automated Addition**: Automatically append the discovered RSS feed URL to the user's feed list upon confirmation.

## Proposed Plan
1. **Discovery Helper**:
    - Create `src/js/helpers/discoveryManager.ts`.
    - Implement `discoverFeedFromUrl(siteUrl: string)` function.
    - Logic:
        - Fetch the URL (via a proxy if necessary, or directly if allowed). Note: Direct client-side fetch might hit CORS. I might need a small backend endpoint or use the existing API if possible.
        - Parse HTML for `<link rel="alternate" type="application/rss+xml">` or `application/atom+xml`.
2. **AppState Integration**:
    - Add `discoveryUrl` string and `isDiscovering` boolean to `AppState`.
    - Add `discoverFeed()` method to `AppState`.
3. **UI Implementation**:
    - Update `src/index.html` in the `#rss-settings-block`.
    - Add input field bound to `discoveryUrl`.
    - Add "Find Feed" button that triggers `discoverFeed()`.
    - Show a loading spinner or text while `isDiscovering` is true.
4. **Integration**:
    - After discovery, show the found URL and a button to "Add to List".
    - Append to `rssFeedsInput`.
