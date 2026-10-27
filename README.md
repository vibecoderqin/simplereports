# TS Reporter

**An experimental Chrome extension for interacting with Twitch's reporting interface in incognito windows.**

![Version](https://img.shields.io/badge/version-2.3.0-a970ff)
![Manifest](https://img.shields.io/badge/manifest-v3-9147ff)
![Chrome](https://img.shields.io/badge/chrome-%E2%89%A5120-00c176)

## Overview

TS Reporter is a Manifest V3 Chrome extension prototype. The repository contains a page-side control panel, a settings dashboard, DOM-based reporting-workflow automation, progress recovery, diagnostic logging, request throttling, and browser-environment modification code.

Some of these capabilities can submit reports automatically and alter browser-identification signals. That makes the project sensitive to misuse and means it should be reviewed carefully before any testing.

> **Responsible use:** Do not use this project for mass or coordinated reporting, false reports, harassment, retaliation, or to bypass platform moderation and anti-abuse protections. For a genuine concern on Twitch, use Twitch's built-in reporting tools manually and provide accurate information. The project is not affiliated with or endorsed by Twitch.

## Capabilities at a glance

- **Chrome extension:** Uses Manifest V3 and declares Chrome 120 or later as its minimum version.
- **In-page interface:** Provides a configurable panel for the reporting workflow.
- **Settings dashboard:** Includes configuration, progress information, and diagnostic views.
- **Workflow state:** Includes retry and recovery logic intended to preserve progress when a page reloads.
- **Description variants:** Supports a text file format for storing alternative report descriptions.
- **Diagnostics and exports:** Keeps local debug and activity records and provides log-export functionality.
- **Browser-environment modification:** Contains code that changes browser-identification and related client signals.
- **Request throttling:** Includes a local limiter for report attempts.

This is a high-level project overview, not a recommendation to automate reports against a live service.

## Repository status

**There is a file-path mismatch to resolve before attempting to load the extension.** In the current main branch, **manifest.json** references **content/isolated.js** and **content/injected.js**, but those paths could not be found during review; files named **isolated.js** and **injected.js** are present at the repository root instead. Check the manifest and file layout and reconcile them before testing.

The source and permissions should also be reviewed before use. In particular, check which websites the extension can access, what request modifications it performs, what information is stored, and when data is exported.

## Source layout

| File | Purpose |
| --- | --- |
| **manifest.json** | Extension metadata, permissions, host access, and entry points |
| **background.js** | Extension service worker |
| **content.js** | In-page panel and reporting-workflow logic |
| **isolated.js** | Root-level isolated-world script present in the repository |
| **injected.js** | Root-level page-world script present in the repository |
| **options.html**, **options.css**, **options.js** | Settings and diagnostics dashboard |
| **panel.css** | In-page panel styles |
| **reasons.json** | Reporting reason data |
| **LICENSE** | MIT license |

Note: the source layout above reflects the files visible in the repository. The script paths declared in the manifest should be checked against that layout.

## Privacy and data handling

The project includes local diagnostic and activity records, and its interface provides export functionality. Some records may contain report-attempt metadata or generated email values. Treat exported logs as potentially sensitive:

- Review the contents before sharing them.
- Avoid including personal or account information in test data.
- Inspect the current implementation to understand storage and retention behavior.
- Clear local records when they are no longer needed.

## Reviewing or testing the code

Before running the extension, review **manifest.json** and the scripts it loads. Pay particular attention to requested permissions, website access, browser-environment modification, automatic submissions, and local data storage.

Do not test automated submissions against real people or live accounts. Use only a controlled environment for which you have explicit authorization. When investigating a moderation issue, prefer the platform's normal reporting flow.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for the full text.
