# Gemini CLI Agent Instructions

This document guides the agent's interaction with the project.

### Core Principles
- Prioritize simplicity, performance, and security.
- Avoid over-engineering.
- Ask for clarification instead of guessing.
- Use the `@refactor-directive` to refactor JavaScript code to be concise, modern, and functional while maintaining the same output.
- do not create your own environments. Use what is ptovided.
- do not rename variables without asking.

### Project Commands
- **Run Application:** To build and run the Docker container, use `bash run.sh`.
- **View Logs:** To view logs from the `ntn` Docker container, use `bash dockerlogs.sh`. Avoid viewing logs in realtime.
  - **Note:** Ensure `dockerlogs.sh` exists and contains `docker logs ntn`.

### Building the container
- dev version: build-dev.sh

### Testing in dev container
**Note:** All testing from this point forward should be performed within the `ntn-dev` Podman container, which is built and run using `bash build-dev.sh`.

- **Run Playwright tests within the dev container:**
  1.  Execute your Playwright test command (e.g., `podman exec ntn-dev npx playwright test tests/ui.spec.js`) to run tests and generate results.
- **Download Test Results to Host:**
  1.  After running tests, execute `bash download_test_results.sh` to copy all generated test artifacts (screenshots, logs) to your host machine, ensuring correct file structure.
- **Analyze Output:**
  1.  Review the downloaded test results, particularly the screenshots in `test-results/screenshots/` and the console log in `playwright_test_output.log`.
  2.  Only ask for user confirmation if the behavior is ambiguous or requires further investigation.

### Workflow Management
- **Issues:** Log new issues in `issues.md`. Work through them one by one. Resolved issues should be moved to `tasks-completed.md`.
- **Current Task:** Move an issue from `issues.md` to `current-task.md` to begin work. This file should track progress and problems.
- **Completing Tasks:**
  1.  When a task is complete, move its contents from `current-task.md` to `tasks-completed.md`.
  2.  Before starting a new task, `git add` and `git commit` all changes from the completed task with a clear message.

### Mitigation for Blockages
If you get stuck:
1.  Document the problem in `current-task.md`, including what you tried and why it failed.
2.  Propose alternative solutions.
3.  Seek user input, providing all relevant context.

- **Handling Long-Running Commands:**
  - When executing commands that might take a long time or hang, implement a mechanism to check their status.
  - If a command is expected to produce output, and none is received within a reasonable time, assume it has hung or failed silently.
  - Avoid indefinite waits. If a command doesn't complete or produce expected output, log the issue and proceed with alternative debugging strategies or seek user input.
