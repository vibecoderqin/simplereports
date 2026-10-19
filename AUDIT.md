# Initial Code Review — TS Reporter

Date: 2026-10-19  
Scope inspected: manifest.json, background.js, content.js, options.js, options.html, options.css, panel.css, reasons.json, and README.md.

This is a static review of the repository contents. Runtime behavior has not been verified in Chromium 155, and no automated test suite or build configuration was present in the inspected file inventory.

## Findings

### High — Automated submission and identity/header rotation create abuse risk
- The README and content.js describe a loop that drives Twitch's report wizard through submission, supports infinite cycles, generates synthetic email addresses, and resumes after reload.
- background.js defines a large UA_POOL and installs a declarativeNetRequest rule that rewrites the User-Agent for Twitch requests. content.js asks the service worker to rotate it each cycle.
- This makes automated repeated submissions harder to attribute consistently and creates a substantial risk of platform abuse. Remove the User-Agent rewriting and rotation path. Do not automate final submission or provide unlimited report cycles; keep any reporting helper user-driven and require an explicit user action for each submission.

### High — Retry handling only retries timeout errors
- runStepWithRetries() retries only StepTimeoutError. DOM changes, a missing element between detection and action, storage failures, or other transient exceptions bypass the retry loop and abort the run.
- Fix by making each step action re-check its target immediately before interacting, distinguishing retryable transient errors from permanent validation errors, and recording the failing step and cause. Never retry a final submission automatically because the outcome may be ambiguous.

### High — Reload recovery can repeat an operation with an uncertain outcome
- scheduleResumeAndReload() persists a resume flag and reloads after a timeout. If a prior action partially succeeded, restarting from the beginning can repeat actions and potentially duplicate a submission.
- Recovery should resume only from a known, non-submission state. Clear stale resume state on manual stop, navigation mismatch, and unrecoverable errors; require a human to confirm before resuming an ambiguous submission state.

### Medium — Cycle count is incremented before the cycle completes
- runAll() increments cycleCount at the beginning of a cycle. A failed or stopped cycle is therefore represented as completed progress.
- Track separate startedCount, completedCount, and failedCount (or increment the completion counter only after all steps finish). Update the dashboard labels to match the semantics.

### Medium — Delay bounds are not validated as a pair
- The panel and dashboard validate delay values individually, but do not ensure delayMin <= delayMax. Persisted settings can also be malformed or outside expected ranges.
- Normalize settings when loading and before starting: require finite integers, enforce documented bounds, and reject or correct inverted delay ranges with a visible validation message.

### Medium — Shared storage updates can lose concurrent writes
- Debug logging and email-history recording use read-modify-write operations against shared chrome.storage.local arrays. Multiple Twitch tabs can interleave reads and writes, causing entries to be overwritten.
- Serialize writes through one queue in the service worker, or store append-only records under unique keys and compact them safely. Handle quota errors and expose a visible error status.

### Medium — Clipboard operations lack error handling
- options.js calls navigator.clipboard.writeText() directly. Clipboard access can reject due to browser context or permission conditions, leaving the UI without useful feedback.
- Catch failures, preserve the original error for debug logging, and show a user-visible failure message rather than always reporting success.

### Medium — Export path assumes every timestamp is valid
- The copy-emails handler calls new Date(r.ts).toISOString() without validating r.ts. A malformed or legacy storage row can throw and abort the entire export.
- Validate timestamps and normalize each row before rendering/exporting; use an empty timestamp or a readable placeholder for invalid data.

### Medium — MV3 permissions and request rules should be minimized
- The manifest requests activeTab, scripting, notifications, and declarativeNetRequest. In the inspected files, request-header modification is the primary reason for the DNR permission.
- After removing User-Agent rewriting, remove unused permissions and verify the extension with the target Chromium build. Keep only permissions required by retained features.

### Low — No repeatable validation setup was found
- The inspected file list contains no package manifest, lint configuration, automated tests, or documented test matrix.
- Add a lightweight test suite for pure helpers (description parsing, settings normalization, progress transitions, HTML escaping) and a manual Chromium MV3 smoke-test checklist. Test the exact target build and record its version in release notes.

## Recommended verification checklist

- [ ] Load the unpacked extension in Chromium 155.0.8059.79 (64-bit) and inspect chrome://extensions for manifest/service-worker errors.
- [ ] Verify incognito behavior and dashboard opening with the extension enabled in incognito.
- [ ] Test malformed and missing settings, delay bounds, storage quota errors, and simultaneous changes from two tabs.
- [ ] Test stopping during every state and confirm no background timer or reload unexpectedly restarts work.
- [ ] Verify that ambiguous submission states never trigger automatic resubmission.
- [ ] Confirm the final manifest contains only necessary MV3 permissions and no request-header identity rotation.
- [ ] Add tests and CI before describing the repository as production-ready.

## Limitations

This review identifies static issues and remediation guidance; it does not claim that all runtime bugs have been found or fixed. The current reporting workflow was not executed against Twitch. No automated tests were run because the repository did not expose a test/build setup in the inspected files.
