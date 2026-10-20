# 🪱 TS Reporter

**Incognito-only Twitch report automation with fingerprint anti-detect.**

![version](https://img.shields.io/badge/version-2.0.1-a970ff)
![manifest](https://img.shields.io/badge/manifest-v3-9147ff)
![chrome](https://img.shields.io/badge/chrome-%E2%89%A5120-00c176)
![incognito](https://img.shields.io/badge/incognito-split-2f2f35)

---

## What it is

TS Reporter is a Chrome MV3 extension that automates the Twitch report wizard inside **incognito windows**. It walks the report flow end-to-end (menu → report → wizard → confirmation), applies per-cycle fingerprint rotation, and logs every submission so you can audit what was sent.

Two layers, one binary:

1. **Automation layer** — DOM-driven wizard walker with retries, timeouts, localized selectors, and reload-on-failure failsafe.
2. **Anti-detect layer** — per-cycle UA rotation, HTTP header rewriting via `declarativeNetRequest`, MAIN-world `navigator`/`userAgentData` overrides, canvas noise, WebGL spoofing, and WebRTC relay-only enforcement.

Everything runs in **incognito split mode**. The extension is completely inert in normal windows — this is enforced at the top of `content.js`, `isolated.js`, and `background.js` via `chrome.extension.inIncognitoContext`.

---

## Features

### Automation

- Step-driven wizard walker with per-step `detect()` / `action()` and interruptible sleeps.
- Full i18n selector set: EN, DE, FR, ES, PT, IT, RU, PL, TR, ZH, JA, KO.
- Retry chain per step (`maxRetries`) with timeout (`timeoutMs`) and failsafe reload.
- Auto-resume after reload — the extension remembers target channel, cycle, and progress via `chrome.storage`.
- `.reports` file support with `$`-prefixed multi-variant descriptions, picked without repetition until the pool empties.
- Random email generation per submission (prefix + suffix + domain pool), logged for audit.
- Cycle limit (0 = ∞), cycle counter, live progress line in the panel.

### Fingerprint rotation

- 13-profile UA pool (Chrome/Firefox/Safari × Windows/macOS/Linux, current versions).
- 5-entry `Accept-Language` rotation pool (en-US, en-GB, de-DE, fr-FR, es-ES).
- Session-scoped `declarativeNetRequest` rule rewriting outbound headers for Twitch and all CDN/asset domains.
- MAIN-world `navigator` surface overrides — full `userAgentData` reconstruction with `getHighEntropyValues()`.
- Deterministic-per-session canvas noise via `toDataURL` / `toBlob` overrides.
- WebGL `VENDOR` / `RENDERER` spoofing matched to spoofed platform.
- WebRTC `RTCPeerConnection` wrapper forcing `iceTransportPolicy = "relay"`.
- Auto-rotate on navigation: 15% chance, minimum 30 min interval.

### Observability

- In-page panel (draggable, resizable, collapse-to-header).
- Full dashboard (`options.html`) with live fingerprint status, progress, settings, debug log, emails-used table.
- Debug log ring buffer (800 lines), email audit log (2000 rows).
- One-click export of debug and email logs (`.log` / `.tsv`).

### Rate limiting

- Token bucket: **3 tokens per hour**, refill **1 per 20 min**.
- Every report submission acquires a token before running.
- `ACQUIRE_TOKEN` message returns `{ ok, waitMs }` when throttled.

---

## Install

### From source

1. Clone the repo.
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → select the folder.
3. Right-click the extension → **Manage extensions** → enable **Allow in incognito**.
4. Open any incognito window → navigate to a Twitch channel → the panel appears automatically.

### From release

Download the `.crx` or the zipped build, unpack, load unpacked. Same incognito toggle as above.

> **Important:** the extension **will not activate** in normal windows. This is by design — `chrome.extension.inIncognitoContext` gates every entry point.

---

## Quick start

1. Open an incognito window.
2. Navigate to the Twitch channel you want to report: `https://www.twitch.tv/<channel>`.
3. Panel appears top-left. Fill in:
   - **content type** — what you're reporting (chat, whispers, username, user, off-twitch).
   - **reason (parent)** — parent reason category.
   - **detailed reason** — sub-reason (auto-populated).
   - **cycles** — how many reports to fire (1–999, 0 = ∞).
4. Load a `.reports` file with your description variants.
5. Click **run**.

The extension walks the wizard, rotates UA each cycle, submits, confirms, closes, and repeats.

If any step fails three times, the page reloads, the target is remembered, and the wizard resumes from the top.

---

## `.reports` file format

Multi-variant description file. Each variant begins with `$` on its own line; everything until the next `$` belongs to that variant.

Variants are picked without repetition until the pool is exhausted, then the cycle resets. This avoids identical descriptions within a reporting streak while keeping the rotation deterministic enough to audit.

---

## Architecture

```text
manifest.json          — MV3 manifest, incognito: split
background.js          — service worker: profile rotation, DNR rules, rate limit
content.js             — panel UI + wizard automation (document_idle, main frame)
content/isolated.js    — bridge: chrome.storage.session → localStorage → postMessage
content/injected.js    — MAIN world: navigator / canvas / WebGL / WebRTC overrides
options.html/.css/.js  — dashboard
panel.css              — in-page panel styles
```

### Message flow

```text
background ──(applyProfile)──▶ chrome.storage.session[PROFILE_KEY]
   │
   ▼
content/isolated.js (ISOLATED world)
   │
   localStorage.__tsr_profile_v1
   │
   window.postMessage({ __tsr, CONFIG })
   │
   ▼
content/injected.js (MAIN world)
   │
   CFG.profile applied to Navigator / Canvas / WebGL
   │
   ▼
content.js reads profile via GET_PROFILE (optional)
```

### Wizard step chain (`content.js` → `STEPS`)

1. `open-menu` — click `more-options`
2. `click-report` — click `Report Channel` item
3. `click-file-report` — dismiss prompt, enter wizard
4. `wizard-content` — content-type radio
5. `wizard-reason` — parent reason (or `Search` if not directly present)
6. `wizard-search-pick` — pick sub-reason from search results (if search was used)
7. `wizard-detail` — detailed-reason radio (if no search)
8. `wizard-description` — fill from `.reports` variant
9. `wizard-confirm` — check verification, fill email, submit
10. `wizard-done` — close confirmation screen

Each step has a `detect()` (polled every 150 ms up to `timeoutMs`) and an `action()`. `runStepWithRetries` retries `StepTimeoutError` up to `maxRetries`, then triggers failsafe reload.

---

## Anti-detect layer

> This section is intentionally technical. If you don't care how it works, skip to **Settings**.

### Profile pool (13 entries)

| Browser | Platform | Versions |
|---------|----------|----------|
| Chrome  | Windows  | 154, 153, 152 |
| Chrome  | macOS    | 154, 153 |
| Chrome  | Linux    | 154, 153 |
| Firefox | Windows  | 156, 155 |
| Firefox | macOS    | 156 |
| Firefox | Linux    | 156 |
| Safari  | macOS    | 27, 26 |

`pickProfile()` never returns the previous UA — it filters the current `lastUa` out of the pool before sampling. The chosen profile is persisted in `chrome.storage.session` under `tsr_profile_v1`, so a background-worker restart does not lose the active fingerprint.

Each profile is **enriched** before application (`enrichProfile`): language tag picked from `LANG_POOL`, `uaBrands` and `fullVersionList` synthesized for Chrome, `oscpu` for Firefox, `platformVersion` per OS. This is what gets fed to `navigator.userAgentData.getHighEntropyValues()`.

### HTTP header rewriting

Single session-scoped `declarativeNetRequest` rule, id `9001`, priority `1`, scoped to:

- `twitch.tv`
- `jtvnw.net`
- `ttvnw.net`
- `twitchcdn.net`
- `live-video.net`

Headers rewritten per request:

| Header | Chrome | Firefox | Safari |
|--------|--------|---------|--------|
| `user-agent` | set | set | set |
| `accept-language` | set | set | set |
| `sec-ch-ua` | set | **remove** | **remove** |
| `sec-ch-ua-mobile` | set | **remove** | **remove** |
| `sec-ch-ua-platform` | set | **remove** | **remove** |
| `sec-ch-ua-full-version-list` | set | **remove** | **remove** |
| `sec-fetch-site` | keep | keep | **remove** |
| `sec-fetch-mode` | keep | keep | **remove** |
| `sec-fetch-user` | keep | keep | **remove** |
| `sec-fetch-dest` | keep | keep | **remove** |

Chrome-mimic and Firefox-mimic send *different client hint sets*. Safari removes the `Sec-Fetch-*` family entirely (Safari 26/27 does send some, but the profile pool above does not — removal keeps the outbound header set internally consistent). Legacy rule IDs `9002..9005` from earlier versions are cleared on bootstrap via `migrateLegacyDynamicRules()`.

### `navigator` surface (`content/injected.js`)

All getters are wrapped via `Object.defineProperty` on `Navigator.prototype`, preserving the original accessor chain when `CFG.profile` is `null`:

- `userAgent`
- `appVersion`
- `platform`
- `vendor`
- `language`
- `languages` (returned frozen — the real `navigator.languages` is frozen, so mimicking)
- `userAgentData` (Chrome profiles only; returns `undefined` for Firefox/Safari — matching real browsers)

`FakeNavigatorUAData` reconstructs the whole `NavigatorUAData` interface:

- `brands`, `mobile`, `platform` as own frozen properties
- `getHighEntropyValues(hints)` returns `architecture`, `bitness`, `formFactors`, `model`, `platformVersion`, `uaFullVersion`, `wow64`, `fullVersionList` — all gated by the caller's `hints` set
- `toJSON()` for serialization
- `Symbol.toStringTag = "NavigatorUAData"` so feature-detection code sees the right class name

Cache (`uaDataCache`, `WeakMap`) keyed by profile object — a single `getHighEntropyValues` call chain cannot observe two different profile states mid-session.

### Canvas fingerprint noise

Two overrides:

- `HTMLCanvasElement.prototype.toDataURL`
- `HTMLCanvasElement.prototype.toBlob`

Both route through `serializeNoisy()`, which:

1. Extracts pixel data via `getImageData(0, 0, w, h)`
2. Applies `addDetNoise()` — LSB flip on a deterministic schedule
3. Draws the result to an off-screen canvas
4. Runs the original serializer against the off-screen canvas

Noise seed: `hash32(width + "x" + height)` XORed with `sessionSalt`. `sessionSalt` is stored in `localStorage.__tsr_salt_v1` — a new random salt is generated only when the key is missing. Result:

- **Stable within a session** — same canvas produces the same hash every time.
- **Different across sessions** — cross-session correlation fails.
- **Different across canvas dimensions** — no universal hash to query.

Cross-origin tainted canvases (`getImageData` throws) fall back gracefully to the original serializer — no exception leaks into page code.

### WebGL

`getParameter` overridden on `WebGLRenderingContext.prototype` and `WebGL2RenderingContext.prototype`. Only two parameter constants are intercepted:

| Constant | Value | Spoof per platform |
|----------|-------|--------------------|
| `UNMASKED_VENDOR_WEBGL` | `0x9245` | Chrome only |
| `UNMASKED_RENDERER_WEBGL` | `0x9246` | Chrome only |

Mapping:

- **Windows** → `Google Inc. (NVIDIA)` / `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)`
- **macOS** → `Google Inc. (Apple)` / `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)`
- **Linux** → `Google Inc. (Intel)` / `ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)`

Firefox/Safari profiles return the native value — those browsers do not expose the `UNMASKED_*` extension in the way Chrome does, and spoofing them would be a tell.

### WebRTC

`RTCPeerConnection` is wrapped:

```js
const Patched = function (config, ...rest) {
  const cfg = config ? { ...config } : {};
  cfg.iceTransportPolicy = "relay";
  return new RTC(cfg, ...rest);
};
Patched.prototype = RTC.prototype;
Object.setPrototypeOf(Patched, RTC);
```

`iceTransportPolicy: "relay"` filters out host candidates — no local RFC1918 IPs leak via SDP. The constructor name is preserved (`Object.defineProperty(Patched, "name", { value: "RTCPeerConnection" })`), and the prototype chain is restored so `instanceof RTCPeerConnection` still works for detection code that inspects it.

### Auto-rotation

`chrome.tabs.onUpdated` watches every incognito tab completion. If the URL matches `https?://([^/]+\.)?twitch\.tv/`, and:

- ≥ 30 min since last rotation (`ROT_MIN_MS`)
- `Math.random() < 0.15` (`ROT_PROB`)

…then `pickProfile()` → `applyProfile()` → persist `ROT_KEY`. This gives organic-feeling rotation (occasional, not rhythmic) while keeping the profile sticky across a browsing session.

### Rate limiting

`acquireReportToken()` implements a classic token bucket:

- **Capacity:** 3
- **Window:** 1 hour
- **Refill:** 1 token per `REFILL_MS = 20 * 60 * 1000`

Bucket state persists in `chrome.storage.local[tsr_rate_v2]`. Elapsed intervals are added on read (`Math.floor(elapsed / REFILL_MS)`); `last` is advanced by `intervals * REFILL_MS` so drift does not accumulate. Returning `{ ok: false, waitMs }` lets the caller back off without spinning.

---

## Settings reference

| Key | Default | Notes |
|-----|---------|-------|
| `content` | `Chat Messages` | Content-type radio on wizard step 1 |
| `reason` | `Hateful Conduct` | Parent reason radio on step 2 |
| `subreason` | `Slurs or Symbols` | Detailed reason (or search-pick) |
| `descriptionText` | `""` | Raw `.reports` content |
| `delayMin` / `delayMax` | `800` / `1800` | Per-step jitter, ms |
| `timeoutMs` | `8000` | Per-step `detect()` timeout |
| `maxRetries` | `3` | Retries per step before failsafe |
| `cycleLimit` | `10` | `0` = ∞ |
| `reloadOnFail` | `true` | Failsafe reload on total step failure |
| `debug` | `true` | Verbose logging + ring buffer |

`DEFAULT_PROGRESS` — `{ usedLines: [], cycleCount: 0, lastUA: null }`.

## Storage keys

All under `chrome.storage.local` unless noted.

| Key | Purpose |
|-----|---------|
| `tsr_settings_v1` | Settings (synced with dashboard) |
| `tsr_progress_v1` | Cycle counter, used `.reports` lines, last UA |
| `tsr_debug_v1` | Debug ring buffer (800 lines) |
| `tsr_emails_v1` | Email audit log (2000 rows) |
| `tsr_resume_v1` | Auto-resume flag (post-reload) |
| `tsr_target_channel_v1` | Last target channel |
| `tsr_rate_v2` | Token bucket state |
| `tsr_last_rotate_v1` | Timestamp of last auto-rotation |
| `tsr_panel_pos_v1` | Panel geometry |
| `tsr_profile_v1` *(session)* | Active fingerprint profile |

LocalStorage keys (per origin, in-page):

| Key | Purpose |
|-----|---------|
| `__tsr_profile_v1` | Cached profile for `injected.js` |
| `__tsr_salt_v1` | Session canvas-noise salt |

## Dashboard

`options.html` — reachable from the panel's open dashboard button. Provides:

- **Fingerprint card** — active browser / platform / version / rate tokens, plus rotate UA and clear rules buttons.
- **Progress card** — cycle, limit, variants used, target channel, last UA.
- **Settings** — same fields as the panel; changes sync bidirectionally via `chrome.storage.onChanged`.
- **Debug log** — live, autoscroll, export, copy, clear.
- **Emails used** — table of `ts / email / channel / reason / subreason / user-agent`, with `.tsv` export.

If the dashboard is opened outside the extension context (e.g. from disk), `HAS_EXT` check fires and the whole UI is disabled with an explicit "wrong context" banner. This is deliberate — `chrome.storage` is not exposed to `file://` pages.

---

## File structure

```text
.
├── manifest.json
├── background.js
├── content.js
├── content/
│   ├── isolated.js
│   └── injected.js
├── panel.css
├── options.html
├── options.css
└── options.js
```

Single-package, no build step. `chrome://extensions` → **Load unpacked** → done.

## License

MIT.
