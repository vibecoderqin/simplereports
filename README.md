# TS Reporter

A Manifest V3 Chromium extension that helps a person prepare a Twitch report draft for **manual review and submission**. It is not affiliated with Twitch.

## Safety and behavior

- The **Copy draft** action copies only the first draft variant from a loaded `.reports` file.
- It does not submit reports, generate substitute email addresses, resume report cycles, or rotate/spoof User-Agent headers.
- Review the draft for accuracy and submit through Twitch's own interface only when you believe it describes a genuine policy violation.
- Do not use the extension to coordinate, mass-submit, or make inaccurate reports.
- The extension stores its settings and local debug history in `chrome.storage.local`; avoid putting sensitive personal information in drafts or logs.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chromium.
3. Enable Developer mode and select **Load unpacked**.
4. Select the folder containing `manifest.json`.
5. Open Twitch and use the panel's **Copy draft** action. The clipboard API may require a secure extension context and a direct user gesture.

## Draft file format

A `.reports` file may contain multiple draft variants separated by lines beginning with `$`. The helper copies only the first variant, so a person can review it before taking any action. It intentionally does not rotate through variants or submit them automatically.

```text
$A factual description of the specific behavior you observed.
$Another draft that should be reviewed separately before use.
```

## Project files

- `manifest.json`: MV3 manifest and minimum Chromium version.
- `content.js`: Twitch-page panel and manual draft preparation.
- `background.js`: dashboard opening, local debug support, and notifications.
- `options.html`, `options.js`, `options.css`: local dashboard.
- `panel.css`: injected panel styling.
- `reasons.json`: reference list of report categories.

## QA notes

Test in the target Chromium build with an unpacked extension:
- Load the extension and verify there are no manifest/service-worker errors.
- Confirm the panel appears on Twitch channel pages and not on unrelated sites.
- Load a valid `.reports` file and click **Copy draft**; confirm only the first variant is copied.
- Confirm an empty file and a blocked clipboard produce clear status messages.
- Confirm no report form is submitted and no request-header override is installed.
- Open the dashboard, change settings, refresh, and verify persistence.
- Test narrow viewport layout, keyboard focus, and dashboard operation in an extension context.

This project does not currently include an automated test harness. These checks should be run manually before release.
