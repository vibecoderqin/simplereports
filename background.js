// ============================================================
// TS-Reporter — Background Service Worker (unified, incognito-only)
// ============================================================
// Требует: "incognito": "split", permissions: storage/tabs/
// notifications/declarativeNetRequest, host_permissions twitch.tv
// ============================================================

const INCOGNITO_ONLY = true;
const RULE_ID_MAIN = 9001;
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

const PROFILES = [
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "154.0.7988.92", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.7988.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "153.0.7932.76", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7932.76 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Windows", mobile: false,
    version: "152.0.7891.115", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7891.115 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "154.0.7988.92", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.7988.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "macOS", mobile: false,
    version: "153.0.7932.76", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7932.76 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "154.0.7988.92", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.7988.92 Safari/537.36"
  },
  {
    browser: "chrome", platform: "Linux", mobile: false,
    version: "153.0.7932.76", ua:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.7932.76 Safari/537.36"
  },
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "156.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0"
  },
  {
    browser: "firefox", platform: "Windows", mobile: false,
    version: "155.0", ua:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0"
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
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "27.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"
  },
  {
    browser: "safari", platform: "macOS", mobile: false,
    version: "26.0", ua:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
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
    p.browser === "safari" ? "Apple Computer, Inc." : "";
  const lang = LANG_POOL[(Math.random() * LANG_POOL.length) | 0];
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
    acceptLanguage: lang.tag
  };
  if (p.browser === "chrome") {
    out.uaBrands = [
      { brand: "Chromium",      version: major },
      { brand: "Not(A:Brand",   version: "24" },
      { brand: "Google Chrome", version: major }
    ];
    out.fullVersionList = [
      { brand: "Chromium",      version: p.version },
      { brand: "Not(A:Brand",   version: "24.0.0.0" },
      { brand: "Google Chrome", version: p.version }
    ];
    out.platformVersion =
      p.platform === "Windows" ? "10.0.0" :
      p.platform === "macOS"   ? "15.8.0" : "6.5.0";
  }
  if (p.browser === "firefox") {
    out.oscpu =
      p.platform === "Windows" ? "Windows NT 10.0; Win64; x64" :
      p.platform === "macOS"   ? "Intel Mac OS X 15.8" : "Linux x86_64";
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

function buildSecChUa(major, grease) {
  return `"Chromium";v="${major}", "Not(A:Brand";v="${grease}", "Google Chrome";v="${major}"`;
}
function buildFullVersionList(fullVersion, grease) {
  return `"Chromium";v="${fullVersion}", "Not(A:Brand";v="${grease}.0.0.0", "Google Chrome";v="${fullVersion}"`;
}

function buildRequestHeaders(profile) {
  const headers = [
    { header: "user-agent", operation: "set", value: profile.ua },
    { header: "accept-language", operation: "set", value: profile.acceptLanguage }
  ];

  if (profile.browser === "chrome") {
    const v = profile.version, m = profile.major, g = 24;
    headers.push(
      { header: "sec-ch-ua",                   operation: "set", value: buildSecChUa(m, g) },
      { header: "sec-ch-ua-mobile",            operation: "set", value: profile.mobile ? "?1" : "?0" },
      { header: "sec-ch-ua-platform",          operation: "set", value: `"${profile.platform}"` },
      { header: "sec-ch-ua-full-version-list", operation: "set", value: buildFullVersionList(v, g) }
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
    removeRuleIds: [RULE_ID_MAIN].concat(LEGACY_IDS),
    addRules: rules
  });

  try { await chrome.storage.session.set({ [PROFILE_KEY]: profile }); } catch { /* ignore */ }

  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.incognito || typeof t.id !== "number") continue;
      chrome.tabs.sendMessage(t.id, { type: "PROFILE_UPDATED", profile }).catch(() => {});
    }
  } catch (e) { log("profile broadcast failed", e); }

  log("profile applied:", profile.browser, profile.major, profile.platform, "→", profile.version, profile.acceptLanguage);
}

async function clearRules() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID_MAIN].concat(LEGACY_IDS)
    });
  } catch (e) { log("clearSessionRules failed", e); }
  try { await chrome.storage.session.remove(PROFILE_KEY); } catch { /* ignore */ }
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.incognito || typeof t.id !== "number") continue;
      chrome.tabs.sendMessage(t.id, { type: "PROFILE_UPDATED", profile: null }).catch(() => {});
    }
  } catch { /* ignore */ }
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
  if (!isIncognitoContext()) { log("normal context — inactive"); return; }
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
    case "OPEN_DASHBOARD": {
      const url = chrome.runtime.getURL("options.html");
      const opts = { url, active: true };
      if (typeof sender?.tab?.windowId === "number") opts.windowId = sender.tab.windowId;
      chrome.tabs.create(opts)
        .then(t => sendResponse({ ok: true, tabId: t?.id }))
        .catch(e => { log("tabs.create failed", e); sendResponse({ ok: false, error: String(e) }); });
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
});

(async () => {
  await loadDebugSetting();
  await ensureSessionStorageAccess();
  await bootstrap();
})();