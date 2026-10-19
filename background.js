// Manifest V3 service worker. No request-header spoofing or UA rotation.
let debugEnabled = false;

async function loadDebugSetting() {
  try {
    const data = await chrome.storage.local.get("tsr_settings_v1");
    debugEnabled = data.tsr_settings_v1?.debug !== false;
  } catch {
    debugEnabled = false;
  }
}

void loadDebugSetting();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.tsr_settings_v1) return;
  debugEnabled = changes.tsr_settings_v1.newValue?.debug !== false;
});

function log(...args) {
  if (debugEnabled) console.log("[TS-Reporter/BG]", ...args);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "GET_INCOGNITO") {
    sendResponse({ incognito: chrome.extension?.inIncognitoContext === true });
    return false;
  }

  if (msg.type === "BG_LOG") {
    log("from tab", sender?.tab?.id, msg.payload);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "NOTIFY") {
    chrome.notifications.create({
      type: "basic",
      title: typeof msg.title === "string" ? msg.title.slice(0, 128) : "TS Reporter",
      message: typeof msg.message === "string" ? msg.message.slice(0, 500) : ""
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "OPEN_DASHBOARD") {
    const url = chrome.runtime.getURL("options.html");
    const windowId = sender?.tab?.windowId;
    const options = { url, active: true };
    if (typeof windowId === "number") options.windowId = windowId;

    chrome.tabs.create(options).then(
      tab => sendResponse({ ok: true, tabId: tab?.id }),
      error => {
        log("tabs.create failed", String(error));
        chrome.runtime.openOptionsPage(() => {
          const lastError = chrome.runtime.lastError;
          sendResponse(lastError
            ? { ok: false, error: lastError.message }
            : { ok: true, fallback: true });
        });
      }
    );
    return true;
  }

  return false;
});
