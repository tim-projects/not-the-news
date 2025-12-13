**Task:** Fixed npm version and decommissioned Playwright containers within the dev environment.

**Resolution:**

1.  Removed redundant `nodejs` and `npm` installations from the main development container stage in `dockerfile-dev`.
2.  Added the `retry` package to the `apt-get install` list in `dockerfile-dev` for improved network robustness.
3.  Explicitly created the `/rss/` directory in `dockerfile-dev` for volume mounting.
4.  Removed `COPY playwright.config.js` and `COPY tests/` from `dockerfile-dev`.
5.  Removed Playwright Chromium runtime dependencies from both the `frontend-builder` stage and the main development container stage in `dockerfile-dev`.
6.  Rebuilt the `ntn-dev` container using `bash build-dev.sh -n`.
7.  Verified that `npm -v` shows `10.8.2` and `retry` is installed inside the container.