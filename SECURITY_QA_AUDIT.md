# Security and QA audit

**Reviewed revision:** `ba2f0de1d2780f9a9b2f71a7fa24a3835f8b93f0` (`main`, 2026-09-28)  
**Target:** Chromium MV3, including the stated Chromium 155 environment  
**Review type:** static source review through the repository files; no live Twitch session or local Chromium runtime was available.

## Summary

The project is a small, dependency-free MV3 extension. Its main components are `manifest.json`, `background.js`, `content.js`, and the dashboard files `options.html/js/css`. There is no package manifest, build step, automated test suite, or CI workflow in the reviewed tree.

This branch removes the unused `activeTab` and `scripting` permissions and adds a minimal manifest regression test. It does not expand User-Agent modification, identity randomization, or repeated report submission.

## Findings

### P1 — Automated submission, synthetic contact data, and reload-resume are coupled

The content script automates the Twitch report wizard through submission, generates random email-shaped strings, supports unlimited cycles (`cycleLimit === 0`), and can reload/resume after a step timeout. Combined, these controls can produce repeated submissions without a fresh, per-submission human confirmation. This is a significant abuse and account-integrity risk as well as a reliability risk when Twitch changes the wizard.

**Recommendation:** do not expand automated submissions or detection-evasion behavior. For a maintainable reporting helper, require the user to review each report and explicitly submit it; use a real contact address where the form requires one, and do not automate verification challenges.

### P1 — User-Agent rotation is not browser compatibility

`background.js` installs a session DNR rule for Twitch requests and selects strings for Chrome, Firefox, Edge, Opera, and Safari. Changing only the User-Agent does not make Chromium emulate those browsers and can create inconsistent client signals. The DNR rule also applies across multiple request resource types for the Twitch domain, so its effects should be tested against the exact Chromium build before any claims of compatibility are made.

**Recommendation:** remove User-Agent spoofing rather than adding more pool entries or evasion strategies. Keep the browser's native request identity and validate behavior with the target Chromium build.

### P1 — Incognito mode must not be treated as an ephemeral-storage guarantee

The extension uses `incognito: "split"`, but persists settings, descriptions, progress, logs, and an email history in `chrome.storage.local`. The code has no explicit cleanup-on-close policy. Users should not be told that persisted records disappear when an incognito window closes.

**Recommendation:** document persistence accurately; minimize stored fields and retention. Verify regular/incognito storage behavior in the target browser if separation is a product requirement.

### P2 — Two unused manifest permissions

The reviewed source does not use `chrome.scripting` or the `activeTab` permission. They have been removed from the manifest on this branch. The remaining permissions correspond to storage, notifications, and DNR functionality currently referenced by the source.

### P2 — Panel observer and document event-listener lifecycle

`content.js` observes the entire document subtree for the lifetime of the page. If Twitch or another page component removes the panel, the observer rebuilds it. Each rebuilt panel creates new document-level `mousemove`/`mouseup` listeners in the drag/resize helpers, and those listeners are not detached. Repeated removals can accumulate listeners and retain detached panel instances.

**Recommendation:** add a single teardown path for the observer and panel-level document listeners (for example, using an `AbortController` signal or named handlers), and ensure teardown runs before rebuilding. This is pending; it was not changed in this branch because the current reporting automation should be redesigned before further operational hardening.

### P2 — Twitch SPA navigation is not handled as an explicit lifecycle event

The observer only checks whether the panel exists; it does not observe route changes. Channel extraction reads `location.pathname`, while the report loop updates its target during cycle execution. In client-side navigation, the active channel can change without a new content-script injection, so UI state and the current route can drift.

**Recommendation:** define explicit behavior on `popstate` and Twitch route transitions. Stop an in-progress workflow on route change and require the user to confirm the new target before continuing. Do not automatically resume a report flow against a changed target.

### P2 — Settings can be invalid or stale

The panel and dashboard write a complete settings object after a short debounce. When both contexts edit settings, a delayed write can overwrite a newer value from the other context. Validation also differs between controls and runtime initialization; for example, minimum/maximum delays are not normalized as a pair after reading persisted settings.

**Recommendation:** centralize validation and normalize settings on load. Prefer field-level updates or a revision-aware write strategy, and test simultaneous edits in the panel and dashboard.

### P2 — Debug-log updates use a non-atomic read/modify/write sequence

`flushDebugQueue()` reads the current log, appends entries, then writes the full array. Concurrent content contexts can interleave these operations and overwrite one another's entries.

**Recommendation:** make loss of log entries acceptable by design or serialize writes through one owner; keep logs bounded and avoid storing unnecessary user-entered text.

### P3 — Duplicate report-reason data can drift

`reasons.json` is described as a reference file and is not imported by the runtime. Reason data is duplicated in the content script and dashboard.

**Recommendation:** establish one source of truth and add a consistency test when the reporting workflow is redesigned.

### P3 — No build/test pipeline

There is no `package.json`, dependency lockfile, automated test suite, or workflow configuration in the reviewed root. This branch adds a built-in Node test for basic manifest structure and local entrypoint existence; it does not replace extension-runtime tests.

**Manual QA still required:** load the unpacked extension in the exact target Chromium build; verify console/service-worker errors; test incognito behavior and storage persistence; exercise panel removal/recreation and SPA navigation; check dashboard clipboard flows and keyboard accessibility. Do not use real users or production report targets as test fixtures.

## Security review notes

- No remote script loading or dynamic code evaluation was found in the files reviewed.
- The panel's `innerHTML` initialization is a fixed markup template in the reviewed code. The dashboard escapes email-history values before interpolating them into table cells, and uses `textContent` for debug logs.
- `options.html` relies on the default MV3 extension-page CSP; there is no custom CSP declaration.
- Message types in `background.js` should still be validated centrally, including payload type and length, before any future message handlers are added.
- The current code was statically inspected only. Absence of a finding in this review is not proof that a runtime vulnerability does not exist.
