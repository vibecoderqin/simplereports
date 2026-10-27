"use strict";

const PROFILE_KEY = "tsr_profile_v1";
const RATE_KEY = "tsr_rate_v2";
const UA_RULE_ID = 1001;
const LANG_RULE_ID = 1002;

const RATE_MAX = 3;
const RATE_REFILL_MS = 30000;

const BROWSER_WEIGHTS = ["chrome", "chrome", "chrome", "edge", "brave"];
const PLATFORM_WEIGHTS = ["Windows", "Windows", "Windows", "macOS", "Linux"];

const PLATFORM_DATA = {
  Windows: {
    platformName: "Win32",
    secChPlatform: "Windows",
    timezones: ["America/New_York", "America/Chicago", "Europe/Berlin", "Europe/London"],
    uaPlatform: "Windows NT 10.0; Win64; x64",
    platformVersion: "15.0.0"
  },
  macOS: {
    platformName: "MacIntel",
    secChPlatform: "macOS",
    timezones: ["America/Los_Angeles", "America/New_York", "Europe/Berlin"],
    uaPlatform: "Macintosh; Intel Mac OS X 10_15_7",
    platformVersion: "14.0.0"
  },
  Linux: {
    platformName: "Linux x86_64",
    secChPlatform: "Linux",
    timezones: ["Europe/Berlin", "Europe/Warsaw", "Europe/London"],
    uaPlatform: "X11; Linux x86_64",
    platformVersion: "6.5.0"
  }
};

const SCREENS = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelRatio: 1 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24, pixelRatio: 1 },
  { width: 1366, height: 768, availWidth: 1366, availHeight: 728, colorDepth: 24, pixelRatio: 1 },
  { width: 1536, height: 864, availWidth: 1536, availHeight: 824, colorDepth: 24, pixelRatio: 1.25 },
  { width: 1440, height: 900, availWidth: 1440, availHeight: 860, colorDepth: 24, pixelRatio: 2 }
];

const LANGS = [
  ["en-US", "en"],
  ["en-GB", "en"],
  ["en-US", "en", "es"],
  ["en-US", "en", "fr"],
  ["de-DE", "de", "en"],
  ["ru-RU", "ru", "en"]
];

const TWITCH_URL_PATTERNS = ["https://twitch.tv/*", "https://*.twitch.tv/*"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function makeVersion() {
  return `${randInt(126, 130)}.0.${randInt(6000, 7200)}.${randInt(60, 220)}`;
}

function buildProfile(origin) {
  const browser = pick(BROWSER_WEIGHTS);
  const platformKey = pick(PLATFORM_WEIGHTS);
  const plat = PLATFORM_DATA[platformKey];
  const version = makeVersion();
  const major = version.split(".")[0];
  const screen = { ...pick(SCREENS) };
  const languages = pick(LANGS).slice();
  const timezone = pick(plat.timezones);
  const salt = randInt(1, 0x7fffffff);
  const hc = pick([4, 8, 8, 12, 16]);
  const dm = pick([4, 8, 8, 16]);

  const chromiumBrand = { brand: "Chromium", version: major };
  const notABrand = { brand: "Not-A.Brand", version: "99" };
  const chromiumFull = { brand: "Chromium", version };
  const notAFull = { brand: "Not-A.Brand", version: "99.0.0.0" };

  let ua, uaBrands, fullVersionList, appVersion;

  if (browser === "chrome") {
    ua = `Mozilla/5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    appVersion = `5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    uaBrands = [chromiumBrand, { brand: "Google Chrome", version: major }, notABrand];
    fullVersionList = [chromiumFull, { brand: "Google Chrome", version }, notAFull];
  } else if (browser === "edge") {
    ua = `Mozilla/5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
    appVersion = `5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`;
    uaBrands = [chromiumBrand, { brand: "Microsoft Edge", version: major }, notABrand];
    fullVersionList = [chromiumFull, { brand: "Microsoft Edge", version }, notAFull];
  } else {
    ua = `Mozilla/5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    appVersion = `5.0 (${plat.uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
    uaBrands = [chromiumBrand, { brand: "Brave", version: major }, notABrand];
    fullVersionList = [chromiumFull, { brand: "Brave", version }, notAFull];
  }

  return {
    browser,
    platform: platformKey,
    version,
    ua,
    appVersion,
    platformName: plat.platformName,
    vendor: "Google Inc.",
    languages,
    hardwareConcurrency: hc,
    deviceMemory: dm,
    mobile: false,
    screen,
    timezone,
    salt,
    _masterSeed: salt,
    _origin: origin || "",
    uaBrands,
    fullVersionList,
    platformVersion: plat.platformVersion,
    webglParams: {
      MAX_TEXTURE_SIZE: 16384,
      MAX_RENDERBUFFER_SIZE: 16384,
      MAX_VIEWPORT_DIMS: [16384, 16384],
      MAX_VERTEX_ATTRIBS: 16,
      MAX_VERTEX_UNIFORM_VECTORS: 4096,
      MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
      MAX_VARYING_VECTORS: 31,
      MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
      MAX_CUBE_MAP_TEXTURE_SIZE: 16384,
      MAX_TEXTURE_IMAGE_UNITS: 16,
      MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16
    }
  };
}

async function getProfile() {
  try {
    const s = await chrome.storage.session.get(PROFILE_KEY);
    return s[PROFILE_KEY] || null;
  } catch { return null; }
}

async function setProfile(profile) {
  try {
    if (profile) await chrome.storage.session.set({ [PROFILE_KEY]: profile });
    else await chrome.storage.session.remove(PROFILE_KEY);
  } catch {}
}

async function applyDnr(profile) {
  const removeRuleIds = [UA_RULE_ID, LANG_RULE_ID];
  if (!profile) {
    try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds }); }
    catch {}
    return;
  }

  const secChUa = profile.uaBrands.map(b => `"${b.brand}";v="${b.version}"`).join(", ");
  const secChUaFull = profile.fullVersionList.map(b => `"${b.brand}";v="${b.version}"`).join(", ");
  const secChPlatform = `"${PLATFORM_DATA[profile.platform]?.secChPlatform || "Unknown"}"`;

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: [{
        id: UA_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "user-agent", operation: "set", value: profile.ua },
            { header: "sec-ch-ua", operation: "set", value: secChUa },
            { header: "sec-ch-ua-full-version-list", operation: "set", value: secChUaFull },
            { header: "sec-ch-ua-platform", operation: "set", value: secChPlatform }
          ]
        },
        condition: {
          urlFilter: "||twitch.tv/",
          resourceTypes: [
            "main_frame", "sub_frame", "stylesheet", "script", "image",
            "font", "object", "xmlhttprequest", "media", "websocket", "other"
          ]
        }
      }]
    });
  } catch (e) {
    console.warn("applyDnr failed:", e && e.message);
  }
}

async function getRate() {
  const now = Date.now();
  let rate = { tokens: RATE_MAX, last: now };
  try {
    const data = await chrome.storage.local.get(RATE_KEY);
    const stored = data[RATE_KEY];
    if (stored && typeof stored.tokens === "number") {
      rate = { tokens: stored.tokens, last: typeof stored.last === "number" ? stored.last : now };
    }
  } catch {}
  const elapsed = Math.max(0, now - rate.last);
  const gained = Math.floor(elapsed / RATE_REFILL_MS);
  if (gained > 0) {
    rate.tokens = Math.min(RATE_MAX, rate.tokens + gained);
    rate.last += gained * RATE_REFILL_MS;
  }
  return rate;
}

async function persistRate(rate) {
  try { await chrome.storage.local.set({ [RATE_KEY]: rate }); } catch {}
}

async function consumeToken() {
  const rate = await getRate();
  if (rate.tokens <= 0) {
    await persistRate(rate);
    return null;
  }
  rate.tokens -= 1;
  await persistRate(rate);
  return rate;
}

function broadcast(msg) {
  chrome.tabs.query({ url: TWITCH_URL_PATTERNS }).then((tabs) => {
    for (const t of tabs) {
      if (!t || t.id == null) continue;
      chrome.tabs.sendMessage(t.id, msg).catch(() => {});
    }
  }).catch(() => {});
}

async function rotateUA(origin) {
  const rate = await consumeToken();
  if (!rate) {
    return { ok: false, error: "rate limit reached (0/3). wait a moment." };
  }
  const profile = buildProfile(origin);
  await setProfile(profile);
  await applyDnr(profile);
  broadcast({ type: "PROFILE_UPDATED", profile });
  return {
    ok: true,
    ua: profile.ua,
    browser: profile.browser,
    platform: profile.platform,
    rate
  };
}

async function clearUA() {
  await setProfile(null);
  await applyDnr(null);
  broadcast({ type: "PROFILE_UPDATED", profile: null });
  return { ok: true };
}

async function openDashboard() {
  const url = chrome.runtime.getURL("options.html");
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    return { ok: true, tabId: tab.id, windowId: tab.windowId, url };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), url };
  }
}

async function resetLanguageEn() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LANG_RULE_ID] });
  } catch {}
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  (async () => {
    try {
      switch (msg.type) {
        case "READ_STATE": {
          const [profile, rate] = await Promise.all([getProfile(), getRate()]);
          await persistRate(rate);
          sendResponse({ ok: true, data: { currentProfile: profile, rate } });
          break;
        }
        case "ROTATE_UA": {
          const origin = msg.origin || (sender && sender.origin) || "";
          sendResponse(await rotateUA(origin));
          break;
        }
        case "CLEAR_UA": {
          sendResponse(await clearUA());
          break;
        }
        case "GET_PROFILE": {
          const profile = await getProfile();
          sendResponse({ ok: true, profile });
          break;
        }
        case "OPEN_DASHBOARD": {
          sendResponse(await openDashboard());
          break;
        }
        case "RESET_LANGUAGE_EN": {
          sendResponse(await resetLanguageEn());
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;
});

chrome.action.onClicked.addListener(() => {
  openDashboard();
});

(async () => {
  try {
    if (chrome.storage.session.setAccessLevel) {
      await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });
    }
  } catch {}
  try {
    const profile = await getProfile();
    await applyDnr(profile);
  } catch {}
})();