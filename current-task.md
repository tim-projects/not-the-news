# Task: Test Unified Build Script and Verify Deployments

## Goal
Verify that the new `build.sh` script correctly handles local development startup, development deployment (Cloudflare + Firebase), and production deployment (Cloudflare).

## Status
- [ ] **Test Local Development:** Run `./build.sh --local` and verify services start.
- [ ] **Test Development Deployment:** Run `./build.sh --dev` (Target: dev-news.loveopenly.net) and verify Cloudflare + Firebase hosting.
- [ ] **Test Production Deployment:** Run `./build.sh --prod` (requires being on main/master branch).
- [ ] **Test Full Suite:** Run `./build.sh --all`.

## Progress
- [x] Created `build.sh`.
- [x] Consolidated deployment logic.
- [x] Added Firebase Hosting to dev flow.
- [x] Corrected DEV_DOMAIN to dev-news.loveopenly.net.
