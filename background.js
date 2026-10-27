// ============================================================
// TS-Reporter — Background Service Worker (unified, incognito-only)
// ============================================================
// Требует: "incognito": "split", permissions: storage/tabs/
// notifications/declarativeNetRequest, host_permissions twitch.tv
// ============================================================

const INCOGNITO_ONLY = true;
const RULE_ID_MAIN = 9001;
const RULE_ID_DEFAULT = 9010;  // Нейтральный DNR-профиль (en-US) после завершения циклов
const LEGACY_IDS   = [9001, 9002, 9003, 9004, 9005];
const SETTINGS_KEY = "tsr_settings_v1";
const RATE_KEY     = "tsr_rate_v2";
const PROGRESS_KEY = "tsr_progress_v1";
const DEBUG_KEY    = "tsr_debug_v1";
const EMAILS_KEY   = "tsr_emails_v1";
const RESUME_KEY   = "tsr_resume_v1";
const PROFILE_KEY  = "tsr_profile_v1";
const ROT_KEY      = "tsr_last_rotate_v1";
const CAPACITY     = 3;
const WINDOW_MS    = 3600000;
const REFILL_MS    = WINDOW_MS / CAPACITY;
const ROT_MIN_MS   = 30 * 60 * 1000;
const ROT_PROB     = 0.15;

const SPOOF_DOMAINS = [
  "twitch.tv",
  "jtvnw.net",
  "ttvnw.net",
  "twitchcdn.net",
  "live-video.net"
];

const LANG_POOL = [
  { code: "en-US", tag: "en-US,en;q=0.9",            list: ["en-US", "en"] },
  { code: "en-GB", tag: "en-GB,en;q=0.9",            list: ["en-GB", "en"] },
  { code: "de-DE", tag: "de-DE,de;q=0.9,en;q=0.8",   list: ["de-DE", "de", "en"] },
  { code: "fr-FR", tag: "fr-FR,fr;q=0.9,en;q=0.8",   list: ["fr-FR", "fr", "en"] },
  { code: "es-ES", tag: "es-ES,es;q=0.9,en;q=0.8",   list: ["es-ES", "es", "en"] }
];

let debugEnabled = false;
async function loadDebugSetting() {
  try {
    const d = await chrome.storage.local.get(SETTINGS_KEY);
    debugEnabled = (d[SETTINGS_KEY] || {}).debug !== false;
  } catch { debugEnabled = false; }
}
loadDebugSetting();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  debugEnabled = (changes[SETTINGS_KEY].newValue || {}).debug !== false;
});
function log(...args) { if (debugEnabled) console.log("[TS-Reporter/BG]", ...args); }

function isIncognitoContext() {
  try { return chrome.extension.inIncognitoContext === true; } catch { return false; }
}
function isIncognitoSender(sender) {
  return sender?.tab?.incognito === true || isIncognitoContext();
}

// ------------------------------------------------------------
// Пул профилей (актуально на октябрь 2026)
// ------------------------------------------------------------
const PROFILES = [
  // ===== Chrome 156 (stable, Oct 2026) =====
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "156.0.8078.48", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },

  // ===== Chrome 155 (stable, Oct 2026) =====
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "155.0.8059.85", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.85 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },

  // ===== Chrome 154 (stable, Sep 2026) =====
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "154.0.8037.93", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.93 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },

  // ===== Chrome 150 (stable, Jul 2026) =====
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },

  // ===== Brave 156 (Chromium 156, Oct 2026) =====
  {
    browser: "brave", platform: "Windows", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },
  {
    browser: "brave", platform: "macOS", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },
  {
    browser: "brave", platform: "Linux", mobile: false,
    version: "156.0.8078.47", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36"
  },

  // ===== Brave 155 (Chromium 155, Oct 2026) =====
  {
    browser: "brave", platform: "Windows", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },
  {
    browser: "brave", platform: "macOS", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },
  {
    browser: "brave", platform: "Linux", mobile: false,
    version: "155.0.8059.84", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.84 Safari/537.36"
  },

  // ===== Brave 154 (Chromium 154, Sep 2026) =====
  {
    browser: "brave", platform: "Windows", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },
  {
    browser: "brave", platform: "macOS", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },
  {
    browser: "brave", platform: "Linux", mobile: false,
    version: "154.0.8037.92", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.92 Safari/537.36"
  },

  // ===== Brave 150 (Chromium 150, Jul 2026) =====
  {
    browser: "brave", platform: "Windows", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },
  {
    browser: "brave", platform: "macOS", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },
  {
    browser: "brave", platform: "Linux", mobile: false,
    version: "150.0.7742.92", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7742.92 Safari/537.36"
  },

  // ===== Firefox 158 (stable, Oct 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "158.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "158.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:158.0) Gecko/20100101 Firefox/158.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "158.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0"
  },

  // ===== Firefox 157 (stable, Sep 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "157.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "157.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:157.0) Gecko/20100101 Firefox/157.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "157.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"
  },

  // ===== Firefox 156 (stable, Sep 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "156.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "156.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:156.0) Gecko/20100101 Firefox/156.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "156.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0"
  },

  // ===== Firefox 155 (stable, Sep 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "155.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "155.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:155.0) Gecko/20100101 Firefox/155.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "155.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0"
  },

  // ===== Firefox 154 (stable, Aug 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "154.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "154.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:154.0) Gecko/20100101 Firefox/154.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "154.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0"
  },

  // ===== Firefox 153 (stable, Aug 2026) =====
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "153.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0"
  },
  {
    browser: "firefox", platform: "macOS", mobile: false,
    version: "153.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:153.0) Gecko/20100101 Firefox/153.0"
  },
  {
    browser: "firefox", platform: "Linux", mobile: false,
    version: "153.0", ua:
    "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0"
  },

  // ===== Safari 27.0 (macOS, Sep 2026) =====
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "27.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"
  },

  // ===== Safari 26.6 (macOS, Jul 2026) =====
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "26.6", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15"
  },

  // ===== Safari 26.5 (macOS, May 2026) =====
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "26.5", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15"
  },

  // ===== Safari 26.4 (macOS, Mar 2026) =====
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "26.4", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15"
  },

  // ===== Safari 26.3 (macOS, Feb 2026) =====
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "26.3", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15"
  },

  // ===== Microsoft Edge 156 (stable, Oct 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "156.0.4314.42", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.42"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "156.0.4314.42", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.42"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "156.0.4314.42", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.42"
  },

  // ===== Microsoft Edge 155 (stable, Oct 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "155.0.4283.62", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.4283.62"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "155.0.4283.62", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.4283.62"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "155.0.4283.62", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.4283.62"
  },

  // ===== Microsoft Edge 154 (stable, Sep 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "154.0.4258.62", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.4258.62"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "154.0.4258.62", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.4258.62"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "154.0.4258.62", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.4258.62"
  },

  // ===== Microsoft Edge 153 (stable, Sep 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "153.0.4234.48", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.4234.48"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "153.0.4234.48", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.4234.48"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "153.0.4234.48", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.4234.48"
  },

  // ===== Microsoft Edge 152 (stable, Sep 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "152.0.4191.66", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.66"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "152.0.4191.66", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.66"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "152.0.4191.66", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4191.66"
  },

  // ===== Microsoft Edge 150 (stable, Jul 2026) =====
  {
    browser: "edge", platform: "Windows", mobile: false,
    version: "150.0.4078.105", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.4078.105"
  },
  {
    browser: "edge", platform: "macOS", mobile: false,
    version: "150.0.4078.105", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.4078.105"
  },
  {
    browser: "edge", platform: "Linux", mobile: false,
    version: "150.0.4078.105", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.4078.105"
  }
];

function enrichProfile(p) {
  const major = String(p.version).split(".")[0];
  const platformName =
    p.platform === "Windows" ? "Win32" :
    p.platform === "macOS"   ? "MacIntel" :
    p.platform === "Linux"   ? "Linux x86_64" : "Win32";
  const vendor =
    p.browser === "chrome" ? "Google Inc." :
    p.browser === "edge"   ? "Microsoft Corporation" :
    p.browser === "brave"  ? "Google Inc." : // Brave сохраняет Google Inc. как vendor
    p.browser === "safari" ? "Apple Computer, Inc." : "";
  const lang = LANG_POOL[(Math.random() * LANG_POOL.length) | 0];
  const hardwareConcurrency =
    p.platform === "Windows" ? 8 :
    p.platform === "macOS"   ? 10 :
    p.platform === "Linux"   ? 4 : 8;
  const deviceMemory =
    p.platform === "Windows" ? 8 :
    p.platform === "macOS"   ? 16 :
    p.platform === "Linux"   ? 4 : 8;

  const platformVersion =
    p.platform === "Windows" ? "10.0.0" :
    p.platform === "macOS"   ? "15.8.0" :
    p.platform === "Linux"   ? "6.5.0" : "10.0.0";

  const out = {
    browser: p.browser,
    platform: p.platform,
    mobile: !!p.mobile,
    version: p.version,
    major,
    ua: p.ua,
    appVersion: p.ua.replace(/^Mozilla\//, ""),
    platformName,
    vendor,
    languages: lang.list.slice(),
    acceptLanguage: lang.tag,
    hardwareConcurrency,
    deviceMemory,
    platformVersion
  };

  // ----- Chrome / Edge / Brave (Chromium-based) -----
  if (p.browser === "chrome" || p.browser === "edge" || p.browser === "brave") {
    let brandName;
    if (p.browser === "edge") brandName = "Microsoft Edge";
    else if (p.browser === "brave") brandName = "Brave";
    else brandName = "Google Chrome";

    out.uaBrands = [
      { brand: "Chromium",      version: major },
      { brand: "Not(A:Brand",   version: "24" },
      { brand: brandName,       version: major }
    ];
    out.fullVersionList = [
      { brand: "Chromium",      version: p.version },
      { brand: "Not(A:Brand",   version: "24.0.0.0" },
      { brand: brandName,       version: p.version }
    ];
  }
  if (p.browser === "firefox") {
    out.oscpu =
      p.platform === "Windows" ? "Windows NT 10.0; Win64; x64" :
      p.platform === "macOS"   ? "Intel Mac OS X 15.8" : "Linux x86_64";
  }
  if (p.browser === "safari") {
    out.uaBrands = [];
    out.fullVersionList = [];
  }
  return out;
}

let lastUa = null;
async function pickProfile() {
  if (!lastUa) {
    try {
      const d = await chrome.storage.session.get(PROFILE_KEY);
      lastUa = d[PROFILE_KEY]?.ua || null;
    } catch { /* ignore */ }
  }
  const pool = lastUa ? PROFILES.filter(p => p.ua !== lastUa) : PROFILES;
  const raw = pool[(Math.random() * pool.length) | 0];
  lastUa = raw.ua;
  return enrichProfile(raw);
}

function buildSecChUa(browser, major, grease) {
  if (browser === "edge") {
    return `"Microsoft Edge";v="${major}", "Chromium";v="${major}", "Not(A:Brand";v="${grease}"`;
  }
  if (browser === "brave") {
    return `"Chromium";v="${major}", "Brave";v="${major}", "Not(A:Brand";v="${grease}"`;
  }
  // chrome (default)
  return `"Chromium";v="${major}", "Not(A:Brand";v="${grease}", "Google Chrome";v="${major}"`;
}

function buildFullVersionList(browser, fullVersion, grease) {
  if (browser === "edge") {
    return `"Microsoft Edge";v="${fullVersion}", "Chromium";v="${fullVersion}", "Not(A:Brand";v="${grease}.0.0.0"`;
  }
  if (browser === "brave") {
    return `"Chromium";v="${fullVersion}", "Brave";v="${fullVersion}", "Not(A:Brand";v="${grease}.0.0.0"`;
  }
  // chrome (default)
  return `"Chromium";v="${fullVersion}", "Not(A:Brand";v="${grease}.0.0.0", "Google Chrome";v="${fullVersion}"`;
}

function buildRequestHeaders(profile) {
  const headers = [
    { header: "user-agent", operation: "set", value: profile.ua },
    { header: "accept-language", operation: "set", value: profile.acceptLanguage }
  ];

  // Chromium-based браузеры (Chrome, Edge, Brave) отправляют Client Hints
  if (profile.browser === "chrome" || profile.browser === "edge" || profile.browser === "brave") {
    const v = profile.version, m = profile.major, g = 24;
    headers.push(
      { header: "sec-ch-ua",                   operation: "set", value: buildSecChUa(profile.browser, m, g) },
      { header: "sec-ch-ua-mobile",            operation: "set", value: profile.mobile ? "?1" : "?0" },
      { header: "sec-ch-ua-platform",          operation: "set", value: `"${profile.platform}"` },
      { header: "sec-ch-ua-full-version-list", operation: "set", value: buildFullVersionList(profile.browser, v, g) }
    );
  } else {
    headers.push(
      { header: "sec-ch-ua",                   operation: "remove" },
      { header: "sec-ch-ua-mobile",            operation: "remove" },
      { header: "sec-ch-ua-platform",          operation: "remove" },
      { header: "sec-ch-ua-full-version-list", operation: "remove" }
    );
  }

  if (profile.browser === "safari") {
    headers.push(
      { header: "sec-fetch-site", operation: "remove" },
      { header: "sec-fetch-mode", operation: "remove" },
      { header: "sec-fetch-user", operation: "remove" },
      { header: "sec-fetch-dest", operation: "remove" }
    );
  }

  return headers;
}

// Записывает профиль в localStorage страницы и рассылает postMessage
// во все фреймы вкладки. Это нужно, потому что injected.js работает
// в MAIN world и не имеет доступа к chrome.storage.
async function syncProfileToTab(tabId, profile) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [profile],
      func: (p) => {
        try {
          if (p) {
            localStorage.setItem("__tsr_profile_v1", JSON.stringify(p));
            window.postMessage({ __tsr: 1, type: "CONFIG", profile: p }, "*");
          } else {
            localStorage.removeItem("__tsr_profile_v1");
            window.postMessage({ __tsr: 1, type: "CONFIG", profile: null }, "*");
          }
        } catch { /* sandboxed frame */ }
      }
    });
  } catch (e) {
    // executeScript падает на sandboxed iframe без host-прав — это нормально
    log("syncProfileToTab scripting failed", tabId, e?.message || String(e));
  }
  // Параллельно уведомляем isolated-world content script (isolated.js),
  // который может иметь свою логику и переслать сообщение в injected.js.
  try {
    chrome.tabs.sendMessage(tabId, { type: "PROFILE_UPDATED", profile }).catch(() => {});
  } catch { /* ignore */ }
}

async function applyProfile(profile) {
  const headers = buildRequestHeaders(profile);

  const rules = [
    {
      id: RULE_ID_MAIN,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: headers },
      condition: {
        requestDomains: SPOOF_DOMAINS.slice()
      }
    }
  ];

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID_MAIN, RULE_ID_DEFAULT].concat(LEGACY_IDS),
    addRules: rules
  });

  try { await chrome.storage.session.set({ [PROFILE_KEY]: profile }); } catch { /* ignore */ }

  // Синхронизация со всеми фреймами во всех incognito-вкладках Twitch.
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter(t =>
          t.incognito &&
          typeof t.id === "number" &&
          /^https?:\/\/([^/]+\.)?twitch\.tv\//.test(t.url || "")
        )
        .map(t => syncProfileToTab(t.id, profile))
    );
  } catch (e) { log("profile broadcast failed", e); }

  log("profile applied:", profile.browser, profile.major, profile.platform, "→", profile.version, profile.acceptLanguage,
      "| hc:", profile.hardwareConcurrency, "dm:", profile.deviceMemory);
}

async function clearRules() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID_MAIN, RULE_ID_DEFAULT].concat(LEGACY_IDS)
    });
  } catch (e) { log("clearSessionRules failed", e); }
  try { await chrome.storage.session.remove(PROFILE_KEY); } catch { /* ignore */ }

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter(t =>
          t.incognito &&
          typeof t.id === "number" &&
          /^https?:\/\/([^/]+\.)?twitch\.tv\//.test(t.url || "")
        )
        .map(t => syncProfileToTab(t.id, null))
    );
  } catch { /* ignore */ }
}

// Нейтральный DNR-профиль (en-US) после завершения циклов.
// Предотвращает «протекание» accept-language последнего спуф-профиля
// на обычные страницы браузера.
async function resetLanguageToEnglish() {
  try {
    const rule = {
      id: RULE_ID_DEFAULT,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "accept-language", operation: "set", value: "en-US,en;q=0.9" }
        ]
      },
      condition: { requestDomains: SPOOF_DOMAINS.slice() }
    };
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID_MAIN].concat(LEGACY_IDS),
      addRules: [rule]
    });
  } catch (e) {
    log("resetLanguageToEnglish: DNR update failed", e);
    return;
  }

  try { await chrome.storage.session.remove(PROFILE_KEY); } catch { /* ignore */ }

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter(t =>
          t.incognito &&
          typeof t.id === "number" &&
          /^https?:\/\/([^/]+\.)?twitch\.tv\//.test(t.url || "")
        )
        .map(t => syncProfileToTab(t.id, null))
    );
  } catch (e) { log("resetLanguageToEnglish: tab sync failed", e); }

  log("resetLanguageToEnglish: DNR forced en-US; JS spoofing cleared");
}

async function migrateLegacyDynamicRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: LEGACY_IDS });
    log("legacy dynamic rules cleared");
  } catch (e) { log("legacy migration skipped", e); }
}

async function acquireReportToken() {
  const now = Date.now();
  const stored = await chrome.storage.local.get(RATE_KEY);
  const bucket = stored[RATE_KEY] || { tokens: CAPACITY, last: now };
  const elapsed = now - bucket.last;
  const intervals = Math.floor(elapsed / REFILL_MS);
  if (intervals > 0) {
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + intervals);
    bucket.last += intervals * REFILL_MS;
  }
  if (bucket.tokens < 1) {
    const waitMs = REFILL_MS - (now - bucket.last);
    return { ok: false, waitMs: Math.max(0, Math.ceil(waitMs)) };
  }
  bucket.tokens -= 1;
  await chrome.storage.local.set({ [RATE_KEY]: bucket });
  return { ok: true, remaining: bucket.tokens };
}

async function writeProgress(payload) { await chrome.storage.local.set({ [PROGRESS_KEY]: payload }); }
async function appendDebug(line) {
  const s = await chrome.storage.local.get(DEBUG_KEY);
  const prev = s[DEBUG_KEY] || [];
  await chrome.storage.local.set({ [DEBUG_KEY]: prev.concat(line).slice(-500) });
}
async function appendEmail(record) {
  const s = await chrome.storage.local.get(EMAILS_KEY);
  const prev = s[EMAILS_KEY] || [];
  await chrome.storage.local.set({ [EMAILS_KEY]: prev.concat(record).slice(-1000) });
}
async function readState() {
  const data = await chrome.storage.local.get([
    PROGRESS_KEY, DEBUG_KEY, EMAILS_KEY, RESUME_KEY, SETTINGS_KEY, RATE_KEY
  ]);
  let profile = null;
  try {
    const sess = await chrome.storage.session.get(PROFILE_KEY);
    profile = sess[PROFILE_KEY] || null;
  } catch { /* ignore */ }
  return { ...data, currentProfile: profile, rate: data[RATE_KEY] || null };
}

const FALLBACK_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: FALLBACK_ICON,
      title: title || "TS-Reporter",
      message: message || ""
    });
  } catch (e) { log("notifications.create failed", e); }
}

async function ensureSessionStorageAccess() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"
    });
  } catch (e) {
    log("setAccessLevel failed (content-script will fallback to message)", e);
  }
}

async function bootstrap() {
  await migrateLegacyDynamicRules();

  if (!isIncognitoContext()) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID_MAIN].concat(LEGACY_IDS)
      });
      log("normal-context: DNR session rules cleaned defensively");
    } catch (e) { log("normal-context DNR cleanup failed", e); }
    log("normal context — inactive");
    return;
  }

  await ensureSessionStorageAccess();
  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const has = existing.some(r => r.id === RULE_ID_MAIN);
    if (has) { log("rules already installed, skip"); return; }
    const profile = await pickProfile();
    await applyProfile(profile);
    log("bootstrapped:", profile.browser, profile.major);
  } catch (e) { log("bootstrap failed", e); }
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!tab?.incognito) return;
  if (info.status !== "complete") return;
  const url = tab.url || "";
  if (!/^https?:\/\/([^/]+\.)?twitch\.tv\//.test(url)) return;

  // 1) Всегда синхронизируем текущий профиль в новую/перезагруженную вкладку.
  try {
    const sess = await chrome.storage.session.get(PROFILE_KEY);
    if (sess[PROFILE_KEY]) {
      await syncProfileToTab(tabId, sess[PROFILE_KEY]);
    }
  } catch (e) { log("sync on tab update failed", e); }

  // 2) Опциональная ротация.
  try {
    const s = await chrome.storage.local.get(ROT_KEY);
    const last = s[ROT_KEY] || 0;
    if (Date.now() - last < ROT_MIN_MS) return;
    if (Math.random() > ROT_PROB) return;
    const profile = await pickProfile();
    await applyProfile(profile);
    await chrome.storage.local.set({ [ROT_KEY]: Date.now() });
    log("auto-rotated on nav:", profile.browser, profile.major);
  } catch (e) { log("auto-rotate failed", e); }
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) return;
  if (!isIncognitoContext()) return;

  const isTwitch = /^https?:\/\/([^/]+\.)?twitch\.tv\//.test(details.url);
  const isBlank =
    details.url.startsWith("about:blank") ||
    details.url.startsWith("about:srcdoc");
  if (!isTwitch && !isBlank) return;

  try {
    const sess = await chrome.storage.session.get(PROFILE_KEY);
    const profile = sess[PROFILE_KEY];
    if (!profile) return;

    await chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      world: "MAIN",
      args: [profile],
      func: (p) => {
        try {
          localStorage.setItem("__tsr_profile_v1", JSON.stringify(p));
          window.postMessage({ __tsr: 1, type: "CONFIG", profile: p }, "*");
        } catch { /* sandboxed */ }
      }
    });
    log("iframe profile synced", details.tabId, details.frameId);
  } catch (e) {
    log("iframe profile sync failed", details.tabId, details.frameId, e?.message || String(e));
  }
}, {
  url: [
    { hostSuffix: "twitch.tv" },
    { urlPrefix: "about:blank" },
    { urlPrefix: "about:srcdoc" }
  ]
});

async function openDashboard(sender) {
  let url;
  try {
    url = chrome.runtime.getURL("options.html");
  } catch (e) {
    return { ok: false, error: "getURL failed: " + (e?.message || String(e)) };
  }

  const attempts = [];
  if (typeof sender?.tab?.windowId === "number") {
    attempts.push({ url, active: true, windowId: sender.tab.windowId });
  }
  attempts.push({ url, active: true });

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const t = await chrome.tabs.create(attempts[i]);
      log("dashboard opened via tabs.create (attempt " + (i + 1) + ")", { tabId: t?.id, url });
      return { ok: true, tabId: t?.id, url };
    } catch (e) {
      lastErr = e;
      log("tabs.create attempt " + (i + 1) + " failed:", e?.message || String(e));
    }
  }

  try {
    const winOpts = { url, focused: true };
    if (isIncognitoContext()) winOpts.incognito = true;
    const w = await chrome.windows.create(winOpts);
    log("dashboard opened via windows.create", { windowId: w?.id, url });
    return { ok: true, windowId: w?.id, url };
  } catch (e) {
    log("windows.create failed:", e?.message || String(e));
    if (!lastErr) lastErr = e;
  }

  return {
    ok: false,
    error: lastErr ? (lastErr.message || String(lastErr)) : "unknown",
    url
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "GET_INCOGNITO") {
    sendResponse({ incognito: isIncognitoSender(sender) });
    return false;
  }
  if (msg.type === "GET_PROFILE") {
    chrome.storage.session.get(PROFILE_KEY)
      .then(d => sendResponse({ ok: true, profile: d[PROFILE_KEY] || null }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === "BG_LOG") {
    log("from tab", sender?.tab?.id, msg.payload);
    sendResponse({ ok: true });
    return false;
  }
  if (INCOGNITO_ONLY && !isIncognitoSender(sender)) {
    sendResponse({ ok: false, error: "incognito_required" });
    return false;
  }

  switch (msg.type) {
    case "NOTIFY": {
      notify(msg.title, msg.message);
      sendResponse({ ok: true });
      return false;
    }
    case "ROTATE_UA": {
      (async () => {
        try {
          const profile = await pickProfile();
          await applyProfile(profile);
          sendResponse({ ok: true, ua: profile.ua, browser: profile.browser, platform: profile.platform });
        } catch (e) { sendResponse({ ok: false, error: String(e) }); }
      })();
      return true;
    }
    case "CLEAR_UA": {
      clearRules().then(
        () => sendResponse({ ok: true }),
        e => sendResponse({ ok: false, error: String(e) })
      );
      return true;
    }
    case "RESET_LANGUAGE_EN": {
      resetLanguageToEnglish().then(
        () => sendResponse({ ok: true }),
        e => sendResponse({ ok: false, error: String(e) })
      );
      return true;
    }
    case "OPEN_DASHBOARD": {
      (async () => {
        try {
          const result = await openDashboard(sender);
          sendResponse(result);
        } catch (e) {
          log("openDashboard fatal:", e?.message || String(e));
          sendResponse({ ok: false, error: String(e?.message || e) });
        }
      })();
      return true;
    }
    case "ACQUIRE_TOKEN": {
      acquireReportToken().then(sendResponse, e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case "WRITE_PROGRESS": {
      writeProgress(msg.payload).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case "APPEND_DEBUG": {
      appendDebug(msg.line).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case "APPEND_EMAIL": {
      appendEmail(msg.record).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    case "READ_STATE": {
      readState().then(data => sendResponse({ ok: true, data }), e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(() => { log("installed"); bootstrap(); });
chrome.runtime.onStartup.addListener(() => { log("startup"); bootstrap(); });
chrome.windows.onCreated.addListener((win) => {
  log("window created", { id: win.id, incognito: win.incognito });
  if (win.incognito) bootstrap();
  else bootstrap(); // defensive: run normal-context cleanup on new window too
});

(async () => {
  await loadDebugSetting();
  await ensureSessionStorageAccess();
  await bootstrap();
})();