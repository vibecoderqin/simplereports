const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log("[TS-Reporter/BG]", ...args);
}

chrome.runtime.onInstalled.addListener(() => {
  log("installed");
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
      iconUrl: "icons/icon128.png",
      title: msg.title || "TS Reporter",
      message: msg.message || ""
    });
    sendResponse({ ok: true });
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