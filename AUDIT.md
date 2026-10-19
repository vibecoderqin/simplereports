# Audit: MV3 / Chromium hardening

Reviewed the tracked source files on main: manifest.json, background.js, content.js, options.html, options.js, panel.css, options.css, reasons.json, and README.md.

## Scope and verification limits

This is a static source review. The repository has no package manifest, build pipeline, automated tests, or browser test harness, so runtime behavior on Chromium 155 has not been verified. The extension targets Manifest V3 and declares Chromium 120 as its minimum.

## Findings

### High priority

1. Bulk report submission and identity/traffic manipulation are tightly coupled. The content script loops through a report wizard, fabricates email addresses, submits reports, retries failures, and can reload/resume automatically. The background worker rotates a large, inconsistent User-Agent pool and installs a declarativeNetRequest header rewrite for Twitch. This can create misleading reports, trigger platform anti-abuse controls, and make request headers inconsistent with Chromium's actual UA Client Hints/platform. Do not expand these behaviors; replace automated submission with a user-reviewed report draft and explicit user action.
2. Broad, permanent DOM observer. content.js observes the entire document subtree for the lifetime of the page and runs a callback for every mutation. Twitch is highly dynamic, so this can cause repeated work. Scope observation to panel removal/reinsertion, debounce callbacks, and disconnect when no longer needed.
3. SPA navigation is not explicitly tracked. The content script does not patch/subscribe to history.pushState or popstate. Its observer only ensures that the panel exists; it does not establish a clean automation lifecycle when Twitch routes change without a full reload.
4. Retry/reload/resume state needs bounds and cancellation tests. Resume is persisted across reloads and starts after a fixed delay. Test repeated failures, a missing target channel, stale storage, manual navigation, and stopping during a pending wait to ensure the process does not restart unexpectedly.

### Medium priority

5. Unused permissions. No use of chrome.scripting or activeTab was found in the reviewed JavaScript. These permissions were removed from the manifest in this branch. Keep declarativeNetRequest only while its rule functionality remains; remove it if UA rewriting is removed.
6. User-Agent pool is internally inconsistent. It mixes Chrome, Firefox, Edge, Opera, and Safari signatures while modifying only the User-Agent header. Browser-generated Client Hints and other platform signals will not necessarily match. The pool also lags the target Chromium version.
7. Persistent data volume and privacy. Local storage keeps up to 2,000 generated-email records and 500 debug lines. Add an explicit retention/export policy and avoid recording fabricated identities or unnecessary personal/report details.
8. Error handling and message validation. Background message handlers accept notification text and log payloads without type/length bounds. Validate message shape and cap strings before logging or notifying.
9. Options page accessibility/responsiveness. The dashboard uses a 600px minimum width, which can force horizontal scrolling in narrow windows. Add responsive layout rules and visible keyboard focus states.
10. No regression checks. Add manifest JSON validation, static checks for remote code and dangerous DOM sinks, and browser smoke tests for extension startup, storage, panel lifecycle, and route changes.

### Positive observations

- Manifest V3 service worker is declared correctly.
- Content script is limited to Twitch pages and does not run in frames.
- Dynamic option labels use textContent; dashboard table values are HTML-escaped before interpolation.
- No eval(), new Function(), remote script import, or build-time dependency was found in the reviewed files.

## Recommended next steps

1. Replace automatic report submission with a review-first helper that opens the native report flow and leaves final submission to the user.
2. Remove UA spoofing and its DNR rule rather than expanding the pool or adding anti-abuse evasion.
3. Implement a lifecycle-managed, debounced observer and explicit SPA route detection.
4. Add tests using a local Twitch DOM fixture and run a manual smoke test on Chromium 155.0.8059.79 (ungoogled build).
5. Re-audit permissions after removing UA rewriting and any other unused features.
