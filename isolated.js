(() => {
  "use strict";

  const IS_INCOGNITO = chrome.extension?.inIncognitoContext === true;
  if (!IS_INCOGNITO) return;

  const PROFILE_KEY = "tsr_profile_v1";
  const LS_KEY      = "__tsr_profile_v1";
  const TARGET_ORIGIN = location.origin;

  function writeLS(profile) {
    try {
      if (profile) localStorage.setItem(LS_KEY, JSON.stringify(profile));
      else         localStorage.removeItem(LS_KEY);
    } catch {}
  }

  function post(profile) {
    try {
      window.postMessage({ __tsr: 1, type: "CONFIG", profile: profile || null }, TARGET_ORIGIN);
    } catch {}
  }

  function apply(profile) {
    writeLS(profile);
    post(profile);
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 20;
  const RETRY_MS = 100;

  async function tryFetch() {
    let profile = null;
    try {
      const s = await chrome.storage.session.get(PROFILE_KEY);
      profile = s?.[PROFILE_KEY] || null;
    } catch {
      profile = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (resp) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve((resp && resp.profile) || null);
          });
        } catch { resolve(null); }
      });
    }
    if (profile) {
      apply(profile);
      return;
    }
    if (++attempts < MAX_ATTEMPTS) setTimeout(tryFetch, RETRY_MS);
  }
  tryFetch();

  try {
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes[PROFILE_KEY]) {
        const p = changes[PROFILE_KEY].newValue || null;
        apply(p);
      }
    });
  } catch {}

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "PROFILE_UPDATED") return;
      apply(msg.profile || null);
    });
  } catch {}
})();