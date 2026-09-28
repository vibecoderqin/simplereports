let debugEnabled = false;

async function loadDebugSetting() {
  try {
    const data = await chrome.storage.local.get("tsr_settings_v1");
    const s = data.tsr_settings_v1 || {};
    debugEnabled = s.debug !== false;
  } catch (e) {
    debugEnabled = false;
  }
}

loadDebugSetting();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.tsr_settings_v1) {
    const s = changes.tsr_settings_v1.newValue || {};
    debugEnabled = s.debug !== false;
  }
});

function log(...args) {
  if (!debugEnabled) return;
  console.log("[TS-Reporter/BG]", ...args);
}

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.8; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (X11; Linux i686; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (X11; Linux i686; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (X11; Linux i686; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux i686; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux i686; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux i686; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0",
  "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0",
  "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.4234.48",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4234.48",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.4234.48",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.4234.48",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.4234.48",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.4234.48",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 OPR/136.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; WOW64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; WOW64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 OPR/136.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; WOW64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 OPR/136.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 OPR/136.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 OPR/135.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_8_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/25.0 Safari/605.1.15"
];

const UA_RULE_ID = 9001;

function pickRandomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

async function installUARule(ua) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: [
        {
          id: UA_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "user-agent", operation: "set", value: ua }
            ]
          },
          condition: {
            urlFilter: "||twitch.tv",
            resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame"]
          }
        }
      ]
    });
    log("UA rule installed:", ua.slice(-40));
    return true;
  } catch (e) {
    log("installUARule failed", e);
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log("installed");
  installUARule(pickRandomUA());
});

chrome.runtime.onStartup.addListener(() => {
  installUARule(pickRandomUA());
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "GET_INCOGNITO") {
    sendResponse({ incognito: chrome.extension.inIncognitoContext === true });
    return true;
  }

  if (msg.type === "BG_LOG") {
    log("from tab", sender?.tab?.id, msg.payload);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "NOTIFY") {
    chrome.notifications?.create({
      type: "basic",
      title: msg.title || "TS Reporter",
      message: msg.message || ""
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "ROTATE_UA") {
    const ua = pickRandomUA();
    installUARule(ua).then((ok) => {
      sendResponse({ ok, ua });
    });
    return true;
  }

  if (msg.type === "OPEN_DASHBOARD") {
    const url = chrome.runtime.getURL("options.html");
    const incognito = !!sender?.tab?.incognito;
    const windowId = sender?.tab?.windowId;

    log("open dashboard requested", { incognito, windowId, url });

    const createOpts = { url, active: true };
    if (typeof windowId === "number") createOpts.windowId = windowId;

    chrome.tabs.create(createOpts)
      .then((tab) => {
        log("dashboard tab created", tab?.id);
        sendResponse({ ok: true, tabId: tab?.id });
      })
      .catch((e) => {
        log("tabs.create failed, falling back to openOptionsPage", e);
        try {
          chrome.runtime.openOptionsPage(() => {
            sendResponse({ ok: true, fallback: true });
          });
        } catch (e2) {
          log("openOptionsPage also failed", e2);
          sendResponse({ ok: false, error: String(e2) });
        }
      });

    return true;
  }

  return false;
});

chrome.windows.onCreated.addListener(async (win) => {
  log("window created", { id: win.id, incognito: win.incognito });
});