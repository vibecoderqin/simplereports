# TS Reporter

A Chrome extension for automating Twitch reports in incognito mode.

> **⚠️ Disclaimer:** This extension is not affiliated with Twitch. Automating reports may violate Twitch's Terms of Service. Use at your own risk.

---

## Features

- **Incognito-only** – runs exclusively in incognito windows (`incognito: "split"` in manifest).
- **Injected panel** – a draggable, resizable control panel appears on Twitch channel pages.
- **Automated report wizard** – fills out the report form step‑by‑step:
  - selects content type
  - selects reason (and detailed reason)
  - fills description from a `.reports` file
  - checks verification checkbox
  - fills a randomly generated email
  - submits the report
- **Custom report descriptions** – load a `.reports` file with multiple variants.
- **Cycle control** – run a fixed number of cycles or infinitely (0 = ∞).
- **User‑Agent rotation** – rotates the User‑Agent for Twitch requests via `declarativeNetRequest`.
- **Retries & timeouts** – per‑step timeout, automatic retries, and page reload on failure.
- **Debug logging** – live debug log stored in `chrome.storage.local`.
- **Dashboard** – full‑page options UI to view progress, debug log, emails used, and adjust settings.
- **Persistent storage** – settings, progress, logs, and email history are saved locally.

---

## Installation

1. **Download or clone** this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top‑right corner).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. The extension is now installed. Remember: it only works in **incognito windows**.

---

## Usage

1. Open an **incognito window** (Ctrl+Shift+N / ⌘+Shift+N).
2. Navigate to any Twitch channel (e.g. `https://www.twitch.tv/somechannel`).
3. A panel titled **🪱 TS Reporter** will appear. If it doesn't, try refreshing the page.
4. Configure the settings in the panel (see below).
5. Load a `.reports` file containing your report descriptions.
6. Click **Run**. The extension will start automating the report process.
7. Use **Stop** to halt, or **Reset cycles** to reset the cycle counter.
8. Click **Open Dashboard** to view detailed progress, debug logs, and the list of emails used.

> **Note:** The panel only appears in incognito windows. In normal windows the content script does nothing.

---

## Configuration

### Panel & Dashboard settings

| Setting | Description |
|--------|-------------|
| **Content type** | Chat Messages, Whispers, Username, User (Avatar, etc.), Off Twitch Behavior |
| **Reason (parent)** | Main report reason (e.g. Hateful Conduct, Spam, etc.) |
| **Detailed reason** | Sub‑reason (if applicable) |
| **Delay min / max (ms)** | Random delay range between steps |
| **Timeout (ms)** | Maximum time to wait for each wizard step |
| **Retries** | Number of retries per step before failing |
| **Cycles** | Number of report cycles (1–999, 0 = infinite) |
| **Debug logging** | Enable/disable debug log output |

### `.reports` file format

The `.reports` file is a plain text file where each **variant** is separated by a line starting with `$`.  
A variant can span multiple lines.

Example:
```
$This is the first report description.
$This is the second one.
It can span multiple lines.
$Third variant with a single line.
```

The extension picks variants in random order, tracking which ones have been used.  
When all variants are used, the cycle resets and they become available again.

---

## Dashboard

The dashboard (options page) provides a full overview:

- **Progress** – current cycle, cycle limit, variants used, target channel, last User‑Agent.
- **Settings** – same as the panel; changes are saved automatically and synced with the panel.
- **Debug log** – view, copy, or clear the debug log (up to 500 lines).
- **Emails used** – table of generated emails with channel, reason, detailed reason, User‑Agent, and timestamp. Copy all or clear.

You can open the dashboard from:
- the panel's **Open Dashboard** button
- `chrome://extensions` → TS Reporter → **Extension options**
- right‑click the extension icon → **Options**

> If you open `options.html` directly from disk, it will warn that it's outside the extension context and cannot access `chrome.storage`.

---

## How It Works

- **`content.js`** runs on `https://www.twitch.tv/*` but exits immediately if not in incognito.
- It injects the panel and, when **Run** is clicked, executes a state machine (`STEPS`) that:
  1. Opens the channel menu.
  2. Clicks "Report Channel".
  3. Clicks "File a Report".
  4. Navigates the wizard: content type → reason → (search results) → detailed reason → description → verify + email → submit → close confirmation.
- Each step waits for a specific element, applies a random delay, and performs the action.
- On timeout it retries; after all retries it can reload the page and resume automatically.
- **`background.js`** handles:
  - User‑Agent rotation (`ROTATE_UA`) using `declarativeNetRequest`.
  - Opening the dashboard (`OPEN_DASHBOARD`).
  - Notifications.
- **`options.js`** powers the dashboard UI and syncs with `chrome.storage.local`.

All data is stored locally under these keys:
- `tsr_settings_v1`
- `tsr_progress_v1`
- `tsr_debug_v1`
- `tsr_emails_v1`
- `tsr_target_channel_v1`
- `tsr_panel_pos_v1`
- `tsr_resume_v1`

No data is sent to external servers.

---

## File Structure

```
.
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker (UA rotation, dashboard opener, notifications)
├── content.js             # Content script (panel UI + report automation)
├── panel.css              # Styles for the injected panel
├── options.html           # Dashboard page
├── options.js             # Dashboard logic
├── options.css            # Dashboard styles
├── reasons.json           # Reference list of Twitch report reasons (not used directly)
└── README.md
```

---

## Important Notes

- **Incognito only** – the extension is designed to work exclusively in incognito windows. It will not run in normal windows.
- **ToS warning** – automating reports may violate Twitch's Terms of Service. You are responsible for how you use this tool.
- **Random emails** – the extension generates random email addresses for the report form; it never uses your real email.
- **Local storage** – all settings, logs, and email history are stored in `chrome.storage.local` and never leave your browser.
- **No warranty** – this software is provided as‑is, without any guarantees.
