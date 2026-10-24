// content/isolated.js — ISOLATED world, document_start
// Мост: читает профиль из chrome.storage.session (fallback — message),
// пишет в localStorage (sync-init для injected.js) и постит в MAIN world.
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
    } catch { /* ignore */ }
  }

  // ВАЖНО: post() должен отправлять и profile=null — иначе при CLEAR_UA
  // injected.js в текущей вкладке не узнает об очистке (когда сигнал приходит
  // через storage.onChanged или PROFILE_UPDATED, а не через executeScript).
  function post(profile) {
    try {
      window.postMessage({ __tsr: 1, type: "CONFIG", profile: profile || null }, TARGET_ORIGIN);
    } catch { /* ignore */ }
  }

  function apply(profile) {
    writeLS(profile);
    post(profile);
  }

  // ---- Первичный fetch: session storage, fallback — background.
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

  // ---- Live-update №1: session storage change.
  try {
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes[PROFILE_KEY]) {
        const p = changes[PROFILE_KEY].newValue || null;
        apply(p);
      }
    });
  } catch { /* session access недоступен */ }

  // ---- Live-update №2: push от background (на случай, если (1) не сработал).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "PROFILE_UPDATED") return;
      apply(msg.profile || null);
    });
  } catch { /* ignore */ }
})();