### Feed Items Not Displaying After Login

*   **Description:** After successful login, the main screen displays without any feed items, despite the backend successfully processing `feed.xml` and returning items. Frontend tests interacting with feed items fail because elements are not visible. This indicates an issue with frontend data fetching, rendering, or persistence.
*   **User Observation:** Screenshots show feed items eventually appearing after a longer stabilization time, suggesting a timing issue where the UI is rendered before data is fully loaded and displayed.
*   **Status:** Partially addressed by adding better loading state management and progress messages. Still needs verification in UI tests.

### Build Process with --no-cache

*   **Description:** When `--no-cache` is used with the build script, `podman system prune` should be executed prior to initiating the build to ensure a clean build environment.
*   **Status:** Pending implementation.

### Playwright Browser Binary Management

*   **Description:** Local tarballs have been provided for `ffmpeg-linux.zip` and `chromium-headless-shell-linux.zip`. These should be used for Playwright installations instead of downloading from `cdn.playwright.dev`.
*   **Status:** Pending implementation.