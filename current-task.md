# Current Task: Fix Status Message Bar

## Objective
The status message bar (toast) never appears. It needs to be implemented such that it:
1. Appears at the bottom of the screen when a message is generated.
2. Stays visible long enough to be read.
3. Automatically hides after a delay.
4. Uses a non-distracting animation to avoid interrupting the user's reading experience.

## Progress
- [ ] Investigate `createStatusBarMessage` implementation in `src/js/ui/uiUpdaters.ts`.
- [ ] Check `src/css/status.css` for existing styles and animations.
- [ ] Update logic in `main.ts` or `uiUpdaters.ts` to manage the visibility lifecycle.
- [ ] Ensure the animation is subtle and non-distracting.
- [ ] Verify with tests or manual check.
