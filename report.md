File: src/js/data/dbUserState.js
Status: Fixed
Issue 1: Potential duplicate GUIDs during data migration.
Location: Line(s) 80-83
Code Snippet:
\`\`\`javascript
80 |                 const migratedItems = allItems.map(item => ({
81 |                     guid: typeof item === 'string' ? item : item.guid,
82 |                     [timestampKey]: now
83 |                 }));
\`\`\`
Violation: This is an "Incorrect Data Migration" anti-pattern. The code attempts to migrate old string-based arrays to new object-based arrays without deduplicating the source array. If the old string array had duplicate GUIDs, the migration script could attempt to create duplicate objects, which will cause a unique constraint violation.
Recommended Fix: Before mapping the `allItems` array, deduplicate it using a `Set`. For example: `const migratedItems = [...new Set(allItems)].map(item => ({ guid: item, [timestampKey]: now }));`
Fixed: The code has been modified to deduplicate the array before migration.

File: src/js/helpers/userStateUtils.js
Status: Fixed
Issue 1: Incorrect data structure for synchronization operation.
Location: Line(s) 86-96
Code Snippet:
\`\`\`javascript
 86 |     // Queue the change for server-side synchronization
 87 |     const opType = `${stateKey}Delta`;
 88 |     const pendingOp = {
 89 |         type: opType,
 90 |         data: {
 91 |             itemGuid: guid,
 92 |             action,
 93 |             timestamp
 94 |         }
 95 |     };
 96 |     await queueAndAttemptSyncOperation(pendingOp);
\`\`\`
Violation: The `queueAndAttemptSyncOperation` function expects the `guid`, `action`, and `timestamp` properties directly on the `operation` object, not nested within a `data` property. This discrepancy could lead to synchronization issues.
Recommended Fix: Modify the `pendingOp` object to include the `guid`, `action`, and `timestamp` properties directly:
\`\`\`javascript
const pendingOp = {
    type: opType,
    guid: guid,
    action: action,
    timestamp: timestamp
};
\`\`\`
Fixed: The code has been modified to include the `guid`, `action`, and `timestamp` properties directly on the `pendingOp` object.

File: src/js/data/dbSyncOperations.js
Status: Compliant.

File: src/js/helpers/deckManager.js
Status: Fixed
Issue 1: Potential duplicate GUIDs in `shuffledOutGuids` after shuffle.
Location: Line(s) 192-199
Code Snippet:
\`\`\`javascript
192 |     const updatedShuffledGuidsSet = new Set([...existingShuffledGuids, ...visibleGuids]);
193 |     
194 |     // Convert the combined set of GUIDs back to an array of objects with the correct timestamp.
195 |     const timestamp = new Date().toISOString();
196 |     const newShuffledOutGuids = Array.from(updatedShuffledGuidsSet).map(guid => ({
197 |         guid,
198 |         shuffledAt: timestamp
199 |     }));
\`\`\`
Violation: The code combines existing shuffled GUIDs with the GUIDs from the current deck, but it doesn't check for duplicates in `existingShuffledGuids` before creating the new `shuffledOutGuids` array. This could lead to duplicate GUIDs in the `shuffledOutGuids` store, which could cause issues when generating a new deck.
Recommended Fix: Deduplicate the `existingShuffledGuids` array before combining it with the `visibleGuids`. For example:
\`\`\`javascript
const existingShuffledGuidsSet = new Set(existingShuffledGuids);
const updatedShuffledGuidsSet = new Set([...existingShuffledGuidsSet, ...visibleGuids]);
\`\`\`
Fixed: The code has been modified to deduplicate the `existingShuffledGuids` array before combining it with the `visibleGuids`.

File: src/js/helpers/apiUtils.js
Status: Compliant.

File: src/js/helpers/dataUtils.js
Status: Compliant.

File: src/js/ui/uiInitializers.js
Status: Fixed
Issue 1: Rebuilding deck after sync doesn't consider hidden or shuffled items.
Location: Line(s) 86-95
Code Snippet:
\`\`\`javascript
 86 |             if (!app.currentDeckGuids?.length && app.entries?.length) {
 87 |                 console.log("Deck is empty after sync. Rebuilding from all available items.");
 88 |                 const now = new Date().toISOString();
 89 |                 app.currentDeckGuids = app.entries.map(item => ({
 90 |                     guid: item.guid,
 91 |                     addedAt: now
 92 |                 }));
 93 |                 await saveArrayState('currentDeckGuids', app.currentDeckGuids);
 94 |                 console.log(`Rebuilt deck with ${app.currentDeckGuids.length} items.`);
 95 |             }
\`\`\`
Violation: The code rebuilds the deck from all available items in `app.entries` without considering the user's hidden or shuffled out items. This could re-introduce items that should be hidden or shuffled out.
Recommended Fix: When rebuilding the deck after a sync, filter the `app.entries` array to exclude items that are in the `hidden` or `shuffledOutItems` arrays.
Fixed: The code has been modified to filter the `app.entries` array to exclude items that are in the `hidden` or `shuffledOutItems` arrays.

File: src/js/ui/uiElements.js
Status: Compliant.

File: src/js/ui/uiUpdaters.js
Status: Compliant.

File: src/main.js
Status: Fixed
Issue 1: The `starred` and `shuffledOutItems` arrays are not deduplicated.
Location: Line(s) 494-514
Code Snippet:
\`\`\`javascript
494 |                 const sanitizedStarred = [];
495 |                 if (Array.isArray(rawStarredState.value)) {
496 |                     for (const item of rawStarredState.value) {
497 |                         const guid = (typeof item === 'string') ? item : item?.guid;
498 |                         if (guid) {
499 |                             sanitizedStarred.push({ guid, starredAt: item?.starredAt || new Date().toISOString() });
500 |                         }
501 |                     }
502 |                 }
503 |                 this.starred = sanitizedStarred;
504 | 
505 |                 const sanitizedShuffled = [];
506 |                 if (Array.isArray(rawShuffledOutState.value)) {
507 |                      for (const item of rawShuffledOutState.value) {
508 |                         const guid = (typeof item === 'string') ? item : item?.guid;
509 |                         if (guid) {
510 |                             sanitizedShuffled.push({ guid, shuffledAt: item?.shuffledAt || new Date().toISOString() });
511 |                         }
512 |                     }
513 |                 }
514 |                 this.shuffledOutItems = sanitizedShuffled;
\`\`\`
Violation: The code sanitizes the `starred` and `shuffledOutItems` arrays by only keeping items with a `guid` property, but it doesn't deduplicate the arrays. This could lead to duplicate GUIDs in these arrays, which could cause issues when generating a new deck or when toggling the star/hidden state of an item.
Recommended Fix: Deduplicate the `sanitizedStarred` and `sanitizedShuffled` arrays after sanitizing them. For example:
\`\`\`javascript
this.starred = [...new Map(sanitizedStarred.map(item => [item.guid, item])).values()];
this.shuffledOutItems = [...new Map(sanitizedShuffled.map(item => [item.guid, item])).values()];
\`\`\`
Fixed: The code has been modified to deduplicate the `sanitizedStarred` and `sanitizedShuffled` arrays after sanitizing them.