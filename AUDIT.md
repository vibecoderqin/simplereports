# Audit notes — manual-reporting hardening

## Scope reviewed
Manifest, service worker, content script, options page logic/markup/styles, panel styles, README, and report-reason reference data.

## High-priority findings addressed in this branch
- Removed the `declarativeNetRequest` permission and User-Agent rotation/header modification. Spoofing a client identity is not needed for draft preparation and can cause compatibility and trust issues.
- Replaced the Run behavior with a user-initiated, single-draft clipboard action. It does not traverse Twitch's report wizard or click submit.
- Updated project documentation to accurately describe manual behavior and QA checks.

## Remaining QA / maintenance work
- Exercise the extension in the specified Chromium build; a remote code review cannot substitute for runtime testing.
- The options dashboard still exposes legacy cycle/retry and historical email-log controls from the previous automation design. These are now stale UI and should be removed in a follow-up cleanup.
- Add a lightweight lint/test workflow for manifest JSON, JavaScript syntax, settings parsing, and draft-file parsing.
- Consider a bounded log retention policy and avoid logging report text or other sensitive user content.
- Validate all saved settings on load and enforce `delayMin <= delayMax` if delay controls remain.

## Deliberate non-goals
This branch does not add anti-abuse evasion, identity rotation, automated or bulk complaint submission, or CAPTCHA/verification bypass.
