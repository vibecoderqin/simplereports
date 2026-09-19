(() => {
  "use strict";

  const DEBUG = true;
  const LOG_PREFIX = "[TS-Reporter]";
  const IS_INCOGNITO = chrome.extension?.inIncognitoContext === true;
  if (!IS_INCOGNITO) return;

  const PANEL_ID = "tsr-panel";
  const K_POS      = "tsr_panel_pos_v1";
  const K_SETTINGS = "tsr_settings_v1";
  const K_PROGRESS = "tsr_progress_v1";
  const K_RESUME   = "tsr_resume_v1";
  const K_TARGET   = "tsr_target_channel_v1";
  const K_DEBUG    = "tsr_debug_v1";
  const K_EMAILS   = "tsr_emails_v1";

  const DEBUG_LIMIT = 500;
  const EMAIL_LIMIT = 2000;
  const RESUME_SETTLE_MS = 3000;
  const POST_CLOSE_SETTLE_MS = 800;

  const DEFAULT_SETTINGS = {
    content: "Chat Messages",
    reason: "Hateful Conduct",
    subreason: "Slurs or Symbols",
    descriptionText: "",
    delayMin: 800,
    delayMax: 1800,
    timeoutMs: 8000,
    maxRetries: 3,
    cycleLimit: 10,
    reloadOnFail: true
  };

  const DEFAULT_PROGRESS = { usedLines: [], cycleCount: 0 };

  const state = {
    running: false,
    settings: { ...DEFAULT_SETTINGS },
    progress: { ...DEFAULT_PROGRESS },
    currentStep: null,
    currentLine: null,
    usedSearchReason: false,
    targetChannel: null
  };

  const log   = (...a) => { if (DEBUG) console.log(LOG_PREFIX, ...a); };
  const warn  = (...a) => { if (DEBUG) console.warn(LOG_PREFIX, ...a); };
  const err   = (...a) => { if (DEBUG) console.error(LOG_PREFIX, ...a); };

  // =========================================================
  // debug buffer → chrome.storage.local (ring, batched)
  // =========================================================
  let debugQueue = [];
  let debugFlushTimer = null;

  function flushDebugQueue() {
    debugFlushTimer = null;
    if (!debugQueue.length) return;
    const batch = debugQueue;
    debugQueue = [];
    chrome.storage.local.get(K_DEBUG).then((data) => {
      const arr = Array.isArray(data[K_DEBUG]) ? data[K_DEBUG] : [];
      arr.push(...batch);
      if (arr.length > DEBUG_LIMIT) arr.splice(0, arr.length - DEBUG_LIMIT);
      chrome.storage.local.set({ [K_DEBUG]: arr });
    }).catch(() => {});
  }

  const debugLog = (line) => {
    const stamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    if (DEBUG) log(line);
    debugQueue.push(stamped);
    if (debugQueue.length > 40) flushDebugQueue();
    else if (!debugFlushTimer) debugFlushTimer = setTimeout(flushDebugQueue, 250);
  };

  // =========================================================
  // email log
  // =========================================================
  async function recordEmail(email, channel, reason, subreason) {
    try {
      const data = await chrome.storage.local.get(K_EMAILS);
      const arr = Array.isArray(data[K_EMAILS]) ? data[K_EMAILS] : [];
      arr.push({
        email,
        channel: channel || null,
        reason: reason || null,
        subreason: subreason || null,
        ts: Date.now()
      });
      if (arr.length > EMAIL_LIMIT) arr.splice(0, arr.length - EMAIL_LIMIT);
      await chrome.storage.local.set({ [K_EMAILS]: arr });
    } catch (e) { warn("recordEmail failed", e); }
  }

  // =========================================================
  // utils
  // =========================================================
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function sleepInterruptible(ms) {
    return new Promise((resolve) => {
      const end = Date.now() + Math.max(0, ms);
      const tick = () => {
        if (!state.running) return resolve(false);
        if (Date.now() >= end) return resolve(true);
        setTimeout(tick, Math.min(100, Math.max(20, end - Date.now())));
      };
      tick();
    });
  }

  function waitForInterruptible(fn, timeout, interval = 150) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (!state.running) return resolve(null);
        try { const v = fn(); if (v) return resolve(v); } catch (e) {}
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function randomEmail() {
    const domains = [
      "gmail.com", "hotmail.com", "yahoo.com", "outlook.com", "icloud.com",
      "aol.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "yandex.ru",
      "ya.ru", "qq.com", "web.de", "gmx.net", "rambler.ru", "me.com",
      "mac.com", "atomicmail.io", "proton.me"
    ];
    const d = domains[Math.floor(Math.random() * domains.length)];
    return `user_${Math.random().toString(36).slice(2, 8)}@${d}`;
  }

  const inPanel = (el) => !!(el && el.closest && el.closest("#" + PANEL_ID));

  function qs(arr, root = document) {
    const list = Array.isArray(arr) ? arr : [arr];
    for (const sel of list) {
      try {
        const el = root.querySelector(sel);
        if (el && !inPanel(el)) return el;
      } catch (e) {}
    }
    return null;
  }

  function getCurrentChannel() {
    const m = location.pathname.match(/^\/([^/?#]+)/);
    if (!m) return null;
    const slug = m[1];
    if (["directory", "search", "settings", "subscriptions", "inventory",
         "wallet", "drops", "following", "videos", "p"].includes(slug)) return null;
    return slug;
  }

  // =========================================================
  // storage
  // =========================================================
  async function loadAll() {
    try {
      const data = await chrome.storage.local.get([K_SETTINGS, K_PROGRESS, K_POS, K_TARGET]);
      if (data[K_SETTINGS]) state.settings = { ...DEFAULT_SETTINGS, ...data[K_SETTINGS] };
      if (data[K_PROGRESS]) state.progress = { ...DEFAULT_PROGRESS, ...data[K_PROGRESS] };
      if (data[K_TARGET])   state.targetChannel = data[K_TARGET];
    } catch (e) { warn("loadAll failed", e); }
  }

  let saveTimer = null;
  function persistSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({
        [K_SETTINGS]: state.settings,
        [K_PROGRESS]: state.progress
      });
    }, 200);
  }
  async function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await chrome.storage.local.set({
      [K_SETTINGS]: state.settings,
      [K_PROGRESS]: state.progress
    });
  }

  // =========================================================
  // selectors & data
  // =========================================================
  const SEL = {
    moreOptions: [
      'button[data-a-target="report-button-more-button"]',
      'button[aria-label="More options"]',
      'button[title="More options"]'
    ],
    reportChannel: [
      'button[data-a-target="report-button-report-button"]',
      'button[aria-label="Report Channel"]'
    ],
    contentRadio: 'input[name="content-select-radio-group"]',
    reasonRadio:  'input[name="reason-select-radio-group"]',
    reasonSearchRadio: 'input[name="reason-search-radio-group"]',
    detailRadio:  'input[name="detailed-reason-select-radio"]',
    next: [
      'button[data-a-target="form-navigation-next"]',
      '[data-a-target="form-navigation-next"]'
    ],
    submit: [
      'button[data-a-target="form-navigation-submit"]',
      '[data-a-target="form-navigation-submit"]'
    ],
    closeConfirm: [
      'button[data-a-target="confirmation-screen-close"]',
      '[data-a-target="confirmation-screen-close"]'
    ],
    description: [
      'textarea[aria-label^="Tell us more"]',
      'textarea#report-wizard-description-form'
    ],
    checkbox: ['input[data-a-target="tw-checkbox"]'],
    email: ['input#email', 'input[type="email"]', 'input[data-a-target="tw-input"]'],
    captcha: ['iframe[src*="captcha"]', '[data-a-target="captcha"]', 'div.g-recaptcha']
  };

  const CONTENT_TYPES = [
    { label: "Chat Messages", slug: "CHAT_REPORT" },
    { label: "Whispers",      slug: "WHISPER_REPORT" },
    { label: "Username",      slug: "USERNAME_REPORT" },
    { label: "User (Avatar, Channel Points, Panels, Tags, etc.)", slug: "USER_REPORT" }
  ];

  const REASONS = {
    "Ban Evasion": { slug: "ban_evasion", subs: ["Account Ban Evasion", "Aiding Ban Evasion"] },
    "Bullying or Harassment": {
      slug: "harassment",
      subs: ["Advocating Harassment", "Coordinating Harassment", "Malicious Pranks",
             "Revealing Personal Information", "Targeted Abuse", "Unwanted Sexual Advances"]
    },
    "Cheating in Game": { slug: "cheating", subs: [] },
    "Explicit Harm": { slug: "explicit_harm",
      subs: ["Animal Endangerment", "Child Endangerment", "Swatting"] },
    "Hateful Conduct": {
      slug: "hateful_conduct",
      subs: ["Slurs or Symbols", "Encouraging Hateful Behavior",
             "Threatening Violence", "Mocking Trauma"]
    },
    "IP Violation": { slug: "ip_violation", subs: [] },
    "Impersonation": { slug: "impersonation", subs: [] },
    "Misinformation": { slug: "misinformation", subs: [] },
    "Nudity or Sexually Explicit": {
      slug: "nudity_sexual",
      subs: ["Sexually Explicit", "Sexual Violence", "Full or Partial Nudity",
             "Sexual Conduct Involving Minors", "Sharing Private Images"]
    },
    "Self-Harm": { slug: "self_harm",
      subs: ["Intentional Self-Harm", "Threatening Self-Harm", "Encouraging Others to Self-Harm"] },
    "Spam, Scams, Bots, or Tampering": {
      slug: "spam",
      subs: ["Spam", "Scam", "Bots", "Cyber Attack", "Viewership Tampering"]
    },
    "Terrorism": { slug: "terrorism", subs: [] },
    "Underage User": { slug: "underage", subs: [] },
    "Violence or Gore": { slug: "violence_gore", subs: [] },
    "Other Illegality": { slug: "other_illegality", subs: [] }
  };

  const SUB_SLUG = {
    "Account Ban Evasion": "account_ban_evasion",
    "Aiding Ban Evasion": "aiding_ban_evasion",
    "Advocating Harassment": "advocating_harassment",
    "Coordinating Harassment": "coordinating_harassment",
    "Malicious Pranks": "malicious_pranks",
    "Revealing Personal Information": "doxxing",
    "Targeted Abuse": "targeted_abuse",
    "Unwanted Sexual Advances": "unwanted_sexual_advances",
    "Animal Endangerment": "animal_endangerment",
    "Child Endangerment": "child_endangerment",
    "Swatting": "swatting",
    "Slurs or Symbols": "slurs_symbols",
    "Encouraging Hateful Behavior": "encouraging_hate",
    "Threatening Violence": "threatening_violence",
    "Mocking Trauma": "mocking_trauma",
    "Sexually Explicit": "sexually_explicit",
    "Sexual Violence": "sexual_violence",
    "Full or Partial Nudity": "nudity",
    "Sexual Conduct Involving Minors": "csae",
    "Sharing Private Images": "sharing_private_images",
    "Intentional Self-Harm": "intentional_self_harm",
    "Threatening Self-Harm": "threatening_self_harm",
    "Encouraging Others to Self-Harm": "encouraging_self_harm",
    "Spam": "spam",
    "Scam": "scam",
    "Bots": "bots",
    "Cyber Attack": "cyber_attack",
    "Viewership Tampering": "viewership_tampering"
  };

  // =========================================================
  // dom helpers
  // =========================================================
  function getWizard() {
    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const d of dialogs) {
      if (inPanel(d)) continue;
      const r = d.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return d;
    }
    const anchor = document.getElementById("report-wizard-description-form");
    if (anchor) {
      const up = anchor.closest('[role="dialog"], form');
      if (up) return up;
    }
    const nextBtn = document.querySelector('[data-a-target="form-navigation-next"]');
    if (nextBtn) {
      const up = nextBtn.closest('[role="dialog"], form');
      if (up) return up;
    }
    return null;
  }

  function findClickable(text, scope = document) {
    const target = text.trim().toLowerCase();
    for (const b of scope.querySelectorAll("button")) {
      if (inPanel(b)) continue;
      if ((b.textContent || "").trim().toLowerCase() === target) return b;
    }
    for (const b of scope.querySelectorAll('[role="button"]')) {
      if (inPanel(b)) continue;
      if ((b.textContent || "").trim().toLowerCase() === target) return b;
    }
    for (const b of scope.querySelectorAll("button")) {
      if (inPanel(b)) continue;
      if ((b.textContent || "").trim().toLowerCase().includes(target)) return b;
    }
    for (const b of scope.querySelectorAll('[role="button"]')) {
      if (inPanel(b)) continue;
      if ((b.textContent || "").trim().toLowerCase().includes(target)) return b;
    }
    for (const el of scope.querySelectorAll("span, div, a")) {
      if (inPanel(el)) continue;
      if ((el.textContent || "").trim().toLowerCase() === target) {
        const btn = el.closest("button, [role='button'], a");
        if (btn) return btn;
      }
    }
    return null;
  }

  function clickRadioBySlug(name, slug, scope) {
    const id = `${name}-${slug}`;
    const direct =
      scope.querySelector(`#${CSS.escape(id)}`) ||
      document.querySelector(`#${CSS.escape(id)}`);
    if (direct) {
      const label = direct.closest("label") ||
        scope.querySelector(`label[for="${CSS.escape(id)}"]`);
      (label || direct).click();
      return true;
    }
    return false;
  }
  function clickRadioByLabelPrefix(name, prefix, scope) {
    const inputs = scope.querySelectorAll(`input[name="${name}"]`);
    const lower = prefix.toLowerCase();
    for (const inp of inputs) {
      const lbl = inp.closest("label") ||
        scope.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
      const txt = ((lbl?.textContent || "") + " " + (inp.getAttribute("aria-label") || ""))
        .trim().toLowerCase();
      if (txt.startsWith(lower) || txt.includes(lower)) {
        (lbl || inp).click();
        return true;
      }
    }
    return false;
  }
  function clickRadioByLabelExact(name, text, scope) {
    const lower = text.trim().toLowerCase();
    for (const inp of scope.querySelectorAll(`input[name="${name}"]`)) {
      const lbl = inp.closest("label") ||
        scope.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
      const txt = (lbl?.textContent || "").trim().toLowerCase();
      if (txt === lower || txt.startsWith(lower)) {
        (lbl || inp).click();
        return true;
      }
    }
    return false;
  }

  // =========================================================
  // atomic actions
  // =========================================================
  async function pickRadio(name, slug, labelText) {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const el = await waitForInterruptible(
      () => wizard.querySelector(`input[name="${name}"]`), 5000);
    if (!el) throw new Error(`radio ${name} never appeared`);
    if (slug && clickRadioBySlug(name, slug, wizard)) {
      debugLog(`radio ${name} clicked by slug "${slug}"`); return;
    }
    if (labelText && clickRadioByLabelPrefix(name, labelText, wizard)) {
      debugLog(`radio ${name} clicked by label "${labelText}"`); return;
    }
    throw new Error(`radio ${name} not matched (slug="${slug}", label="${labelText}")`);
  }

  async function clickNext() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const btn = await waitForInterruptible(
      () => wizard.querySelector('[data-a-target="form-navigation-next"]'), 3000);
    if (!btn) throw new Error("next button not found");
    btn.click();
    debugLog("next clicked");
  }

  async function fillDescription(text) {
    if (!text) { debugLog("no description configured"); return; }
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const ta =
      wizard.querySelector('textarea[aria-label^="Tell us more"]') ||
      wizard.querySelector("textarea#report-wizard-description-form") ||
      wizard.querySelector("textarea");
    if (!ta) { debugLog("description textarea not found"); return; }
    ta.focus();
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    debugLog("description filled");
  }

  async function checkVerify() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const cb = wizard.querySelector('input[data-a-target="tw-checkbox"]');
    if (!cb) { debugLog("verify checkbox not found"); return; }
    if (!cb.checked) {
      const label = cb.closest("label") ||
        wizard.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
      (label || cb).click();
      debugLog("verify checkbox checked");
    }
  }

  async function fillEmail() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const input =
      wizard.querySelector('input#email') ||
      wizard.querySelector('input[type="email"]') ||
      wizard.querySelector('input[data-a-target="tw-input"]');
    if (!input) throw new Error("email input not found");
    const value = randomEmail();
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    debugLog(`email filled into #${input.id || "input"}: ${value}`);
    await recordEmail(value, state.targetChannel, state.settings.reason, state.settings.subreason);
  }

  async function submitReport() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const btn = await waitForInterruptible(
      () => wizard.querySelector('[data-a-target="form-navigation-submit"]'), 3000);
    if (!btn) throw new Error("submit button not found");
    btn.click();
    debugLog("submit clicked");
  }

  async function closeConfirmation() {
    const btn = await waitForInterruptible(() => qs(SEL.closeConfirm), 8000);
    if (!btn) { debugLog("no confirmation close button — may not have submitted"); return; }
    btn.click();
    debugLog("confirmation closed");
  }

  function detectCaptcha() { return !!qs(SEL.captcha); }

  // =========================================================
  // description variant picker ($-prefixed)
  // =========================================================
  function parseDescriptionLines(raw) {
    if (!raw || typeof raw !== "string") return [];
    const normalized = raw.replace(/\r\n?/g, "\n");
    if (!normalized.includes("$")) {
      const single = normalized.trim();
      return single ? [single] : [];
    }
    const out = [];
    let cur = null;
    for (const line of normalized.split("\n")) {
      const lead = line.replace(/^\s+/, "");
      if (lead.startsWith("$")) {
        if (cur !== null) {
          const v = cur.trim();
          if (v) out.push(v);
        }
        cur = lead.slice(1);
      } else if (cur !== null) {
        cur += "\n" + line;
      }
    }
    if (cur !== null) {
      const v = cur.trim();
      if (v) out.push(v);
    }
    return out;
  }

  function shortLabel(s) {
    const firstLine = (s.split("\n")[0] || "").trim();
    const total = s.split("\n").length;
    const head = firstLine.slice(0, 40) + (firstLine.length > 40 ? "…" : "");
    return total > 1 ? `${head} [+${total - 1} lines]` : head;
  }

  function pickDescriptionLine() {
    const variants = parseDescriptionLines(state.settings.descriptionText);
    if (variants.length === 0) return "";
    if (variants.length === 1) { debugLog(`description: only 1 variant, using it`); return variants[0]; }
    const used = new Set(state.progress.usedLines);
    let available = variants.filter((l) => !used.has(l));
    if (available.length === 0) {
      debugLog(`description: all ${variants.length} variants used, resetting cycle`);
      state.progress.usedLines = [];
      available = variants.slice();
    }
    const pick = available[Math.floor(Math.random() * available.length)];
    state.progress.usedLines.push(pick);
    persistSoon();
    debugLog(`description: picked "${shortLabel(pick)}" ` +
             `(${state.progress.usedLines.length}/${variants.length})`);
    return pick;
  }

  // =========================================================
  // channel anchor
  // =========================================================
  async function ensureBackOnChannel() {
    if (!state.targetChannel) return true;
    const cur = getCurrentChannel();
    if (cur === state.targetChannel) return true;
    debugLog(`⚠ redirected away (now: ${cur || "(no channel)"}, target: ${state.targetChannel}) — navigating back`);
    await chrome.storage.local.set({ [K_RESUME]: true, [K_TARGET]: state.targetChannel });
    await persistNow();
    await sleepInterruptible(200);
    location.href = `https://www.twitch.tv/${state.targetChannel}`;
    return false;
  }

  // =========================================================
  // state machine
  // =========================================================
  class StepTimeoutError extends Error {
    constructor(step, timeout) {
      super(`step "${step.name}" timeout after ${timeout}ms`);
      this.step = step;
    }
  }

  const STEPS = [
    {
      name: "open-menu",
      screen: "channel page (menu closed)",
      detect: () => qs(SEL.moreOptions),
      action: async () => { qs(SEL.moreOptions).click(); }
    },
    {
      name: "click-report",
      screen: "channel menu (Report item)",
      detect: () => qs(SEL.reportChannel) || findClickable("Report Channel"),
      action: async () => { (qs(SEL.reportChannel) || findClickable("Report Channel")).click(); }
    },
    {
      name: "click-file-report",
      screen: "'File a Report' prompt",
      detect: () => findClickable("File a Report"),
      action: async () => { findClickable("File a Report").click(); }
    },
    {
      name: "wizard-content",
      screen: "wizard · step 1 (content type)",
      detect: () => {
        const w = getWizard();
        return w && w.querySelector('input[name="content-select-radio-group"]');
      },
      action: async () => {
        const ct = CONTENT_TYPES.find((c) => c.label === state.settings.content) || CONTENT_TYPES[0];
        await pickRadio("content-select-radio-group", ct.slug, ct.label);
        await clickNext();
      }
    },
    {
      name: "wizard-reason",
      screen: "wizard · step 2 (reason)",
      detect: () => {
        const w = getWizard();
        return w && w.querySelector('input[name="reason-select-radio-group"]');
      },
      action: async () => {
        const parentName = state.settings.reason;
        const r = REASONS[parentName];
        const wizard = getWizard();
        if (!r || !wizard) throw new Error("reason state invalid");

        if (r.slug && clickRadioBySlug("reason-select-radio-group", r.slug, wizard)) {
          debugLog(`reason clicked directly: ${parentName}`);
          state.usedSearchReason = false;
          await clickNext(); return;
        }
        if (clickRadioByLabelPrefix("reason-select-radio-group", parentName, wizard)) {
          debugLog(`reason clicked by label: ${parentName}`);
          state.usedSearchReason = false;
          await clickNext(); return;
        }
        debugLog(`reason "${parentName}" has no direct radio — using Search`);
        if (!clickRadioBySlug("reason-select-radio-group", "searching-other", wizard)) {
          throw new Error(`Search radio not found (reason="${parentName}")`);
        }
        debugLog("Search radio clicked");
        state.usedSearchReason = true;
        await clickNext();
      }
    },
    {
      name: "wizard-search-pick",
      screen: "wizard · search results",
      detect: () => {
        if (!state.usedSearchReason) return "skipped";
        const w = getWizard();
        return w && w.querySelector('input[name="reason-search-radio-group"]');
      },
      action: async () => {
        const wizard = getWizard();
        if (!wizard) throw new Error("wizard not mounted");
        const target = state.settings.subreason || state.settings.reason;
        if (!target) throw new Error("no search target");
        if (clickRadioByLabelExact("reason-search-radio-group", target, wizard)) {
          debugLog(`search result clicked: "${target}"`); await clickNext(); return;
        }
        if (clickRadioByLabelPrefix("reason-search-radio-group", target, wizard)) {
          debugLog(`search result clicked by prefix: "${target}"`); await clickNext(); return;
        }
        throw new Error(`search result not found: "${target}"`);
      }
    },
    {
      name: "wizard-detail",
      screen: "wizard · step 3 (detailed reason)",
      detect: () => {
        if (state.usedSearchReason) return "skipped";
        const r = REASONS[state.settings.reason];
        if (!r || r.subs.length === 0) return "skipped";
        const w = getWizard();
        return w && w.querySelector('input[name="detailed-reason-select-radio"]');
      },
      action: async () => {
        const r = REASONS[state.settings.reason];
        if (!r || r.subs.length === 0) return;
        if (!state.settings.subreason) throw new Error("reason requires a detailed reason");
        const slug = SUB_SLUG[state.settings.subreason] ||
          state.settings.subreason.toLowerCase().replace(/\s+/g, "_");
        await pickRadio("detailed-reason-select-radio", slug, state.settings.subreason);
        await clickNext();
      }
    },
    {
      name: "wizard-description",
      screen: "wizard · step 4 (description)",
      detect: () => {
        const w = getWizard();
        if (!w) return null;
        return w.querySelector('textarea[aria-label^="Tell us more"]') ||
               w.querySelector("textarea#report-wizard-description-form") ||
               w.querySelector("textarea");
      },
      action: async () => {
        await fillDescription(state.currentLine || "");
        await clickNext();
      }
    },
    {
      name: "wizard-confirm",
      screen: "wizard · step 5 (verify + email)",
      detect: () => {
        const w = getWizard();
        return w && w.querySelector('input[data-a-target="tw-checkbox"]');
      },
      action: async () => {
        if (detectCaptcha()) throw new Error("captcha before submit");
        await checkVerify();
        await fillEmail();
        await submitReport();
      }
    },
    {
      name: "wizard-done",
      screen: "confirmation screen",
      detect: () => qs(SEL.closeConfirm),
      action: async () => { await closeConfirmation(); }
    }
  ];

  async function runStep(step, ctx) {
    state.currentStep = step.name;
    updateProgressUI();
    debugLog(`→ step "${step.name}" — waiting for screen "${step.screen}"`);

    const detected = await waitForInterruptible(() => step.detect(), ctx.timeoutMs, 150);
    if (!state.running) return;
    if (detected === null) throw new StepTimeoutError(step, ctx.timeoutMs);
    if (detected === "skipped") { debugLog(`  step "${step.name}" — skipped`); return; }
    debugLog(`  step "${step.name}" — detected, delay ${ctx.delayMs}ms`);
    const ok = await sleepInterruptible(ctx.delayMs);
    if (!ok) return;
    debugLog(`  step "${step.name}" — acting`);
    await step.action();
    debugLog(`  step "${step.name}" — done`);
  }

  async function runStepWithRetries(step, ctx) {
    let attempt = 0;
    while (state.running) {
      try { await runStep(step, ctx); return; }
      catch (e) {
        if (!(e instanceof StepTimeoutError)) throw e;
        attempt++;
        debugLog(`  ✖ step "${step.name}" timeout (attempt ${attempt}/${ctx.maxRetries})`);
        if (attempt >= ctx.maxRetries) throw e;
        debugLog(`  ↻ retrying step "${step.name}"`);
        await sleepInterruptible(500);
      }
    }
  }

  async function scheduleResumeAndReload(failedStep) {
    debugLog(`⚠ failsafe: reloading page and restarting wizard (failed step: ${failedStep})`);
    await chrome.storage.local.set({
      [K_RESUME]: true,
      [K_TARGET]: state.targetChannel || getCurrentChannel()
    });
    await persistNow();
    setTimeout(() => location.reload(), 800);
  }

  // =========================================================
  // automation loop
  // =========================================================
  async function runAll() {
    const ctx = {
      delayMs: rand(state.settings.delayMin, state.settings.delayMax),
      timeoutMs: state.settings.timeoutMs,
      maxRetries: state.settings.maxRetries
    };

    while (state.running) {
      if (state.settings.cycleLimit > 0 &&
          state.progress.cycleCount >= state.settings.cycleLimit) {
        debugLog(`✔ cycle limit reached (${state.progress.cycleCount}/${state.settings.cycleLimit})`);
        break;
      }

      const ch = getCurrentChannel();
      if (ch) state.targetChannel = ch;
      await chrome.storage.local.set({ [K_TARGET]: state.targetChannel });

      state.progress.cycleCount++;
      persistSoon();
      updateProgressUI();
      const limitLabel = state.settings.cycleLimit === 0 ? "∞" : String(state.settings.cycleLimit);
      debugLog(`▶ starting cycle ${state.progress.cycleCount}/${limitLabel} on /${state.targetChannel || "?"}`);

      state.currentLine = pickDescriptionLine();
      state.usedSearchReason = false;

      for (const step of STEPS) {
        if (!state.running) return;
        ctx.delayMs = rand(state.settings.delayMin, state.settings.delayMax);
        try { await runStepWithRetries(step, ctx); }
        catch (e) {
          if (e instanceof StepTimeoutError && state.settings.reloadOnFail) {
            debugLog(`✖ step "${step.name}" failed all retries — failsafe`);
            await scheduleResumeAndReload(step.name);
            return;
          }
          debugLog(`✖ step "${step.name}" fatal: ${e.message}`);
          throw e;
        }
      }

      await sleepInterruptible(POST_CLOSE_SETTLE_MS);
      if (!state.running) return;
      const stillHere = await ensureBackOnChannel();
      if (!stillHere) return;

      debugLog(`✔ cycle ${state.progress.cycleCount} complete`);
    }
  }

  async function startRun(autoResumed = false) {
    if (state.running) return;
    const cl = Number(state.settings.cycleLimit);
    if (!Number.isInteger(cl) || cl < 0 || cl > 999) { setStatus("error: cycles 0–999", "err"); return; }
    if (state.settings.timeoutMs < 500) { setStatus("error: timeout ≥ 500 ms", "err"); return; }
    if (state.settings.maxRetries < 1) { setStatus("error: retries ≥ 1", "err"); return; }

    state.running = true;
    updateUI();
    setStatus(autoResumed ? "resumed after reload…" : "running…");
    try {
      await runAll();
      setStatus("done.", "ok");
    } catch (e) {
      setStatus("error: " + e.message, "err");
      err(e);
    } finally {
      state.running = false;
      updateUI();
      persistSoon();
    }
  }

  function stopRun(reason = "user") {
    if (!state.running) return;
    state.running = false;
    debugLog(`■ stop requested (${reason})`);
    setStatus("stopped by " + reason);
    updateUI();
  }

  // =========================================================
  // panel
  // =========================================================
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="tsr-header">
        <span class="tsr-title">🪱 TS Reporter</span>
        <button class="tsr-toggle" id="tsr-collapse" title="collapse">▾</button>
      </div>
      <div class="tsr-body">
        <div class="tsr-row">
          <label for="tsr-content">content type</label>
          <select id="tsr-content"></select>
        </div>
        <div class="tsr-row">
          <label for="tsr-reason">reason (parent)</label>
          <select id="tsr-reason"></select>
        </div>
        <div class="tsr-row">
          <label for="tsr-subreason">detailed reason</label>
          <select id="tsr-subreason"><option value="">— none —</option></select>
        </div>
        <div class="tsr-grid2">
          <div class="tsr-row">
            <label for="tsr-delay-min">delay min (ms)</label>
            <input type="number" id="tsr-delay-min" min="0" step="50" />
          </div>
          <div class="tsr-row">
            <label for="tsr-delay-max">delay max (ms)</label>
            <input type="number" id="tsr-delay-max" min="0" step="50" />
          </div>
        </div>
        <div class="tsr-grid2">
          <div class="tsr-row">
            <label for="tsr-timeout">timeout (ms)</label>
            <input type="number" id="tsr-timeout" min="500" step="100" />
          </div>
          <div class="tsr-row">
            <label for="tsr-retries">retries</label>
            <input type="number" id="tsr-retries" min="1" max="20" step="1" />
          </div>
        </div>
        <div class="tsr-row">
          <label for="tsr-cycles">cycles (1–999, 0 = ∞)</label>
          <input type="number" id="tsr-cycles" min="0" max="999" step="1" />
        </div>
        <div class="tsr-row">
          <label for="tsr-details">complaint variants (each starts with $)</label>
          <textarea id="tsr-details" rows="5" placeholder="$variant 1 …&#10;$variant 2 …&#10;$variant 3 (can span multiple lines)"></textarea>
        </div>
        <div class="tsr-buttons">
          <button class="tsr-btn tsr-btn-primary" id="tsr-run">run</button>
          <button class="tsr-btn tsr-btn-secondary" id="tsr-stop" disabled>stop</button>
        </div>
        <div class="tsr-buttons">
          <button class="tsr-btn tsr-btn-ghost" id="tsr-dashboard">open dashboard</button>
        </div>
        <div class="tsr-progress" id="tsr-progress">cycle 0/10 — idle</div>
        <div class="tsr-status" id="tsr-status">idle</div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    const $ = (id) => panel.querySelector("#" + id);
    const contentSel  = $("tsr-content");
    const reasonSel   = $("tsr-reason");
    const subSel      = $("tsr-subreason");
    const delayMinEl  = $("tsr-delay-min");
    const delayMaxEl  = $("tsr-delay-max");
    const timeoutEl   = $("tsr-timeout");
    const retriesEl   = $("tsr-retries");
    const cyclesEl    = $("tsr-cycles");
    const detailsTA   = $("tsr-details");
    const runBtn      = $("tsr-run");
    const stopBtn     = $("tsr-stop");
    const dashBtn     = $("tsr-dashboard");
    const collapseBtn = $("tsr-collapse");

    for (const c of CONTENT_TYPES) {
      const o = document.createElement("option");
      o.value = c.label; o.textContent = c.label;
      contentSel.appendChild(o);
    }
    for (const r of Object.keys(REASONS)) {
      const o = document.createElement("option");
      o.value = r; o.textContent = r;
      reasonSel.appendChild(o);
    }
    function refreshSubs() {
      subSel.innerHTML = "";
      const none = document.createElement("option");
      none.value = ""; none.textContent = "— none —";
      subSel.appendChild(none);
      const r = REASONS[reasonSel.value];
      if (!r) return;
      for (const s of r.subs) {
        const o = document.createElement("option");
        o.value = s; o.textContent = s;
        subSel.appendChild(o);
      }
    }
    reasonSel.addEventListener("change", refreshSubs);

    contentSel.value = state.settings.content;
    reasonSel.value  = state.settings.reason;
    refreshSubs();
    if (state.settings.subreason) subSel.value = state.settings.subreason;
    delayMinEl.value = state.settings.delayMin;
    delayMaxEl.value = state.settings.delayMax;
    timeoutEl.value  = state.settings.timeoutMs;
    retriesEl.value  = state.settings.maxRetries;
    cyclesEl.value   = state.settings.cycleLimit;
    detailsTA.value  = state.settings.descriptionText || "";

    const bindSetting = (el, key, parser = (v) => v) => {
      const handler = () => {
        const v = parser(el.value);
        if (v === null) return;
        state.settings[key] = v;
        persistSoon();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    };
    bindSetting(contentSel, "content");
    reasonSel.addEventListener("change", () => {
      state.settings.reason = reasonSel.value;
      state.settings.subreason = subSel.value || "";
      persistSoon();
    });
    subSel.addEventListener("change", () => {
      state.settings.subreason = subSel.value || "";
      persistSoon();
    });
    bindSetting(delayMinEl, "delayMin", (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; });
    bindSetting(delayMaxEl, "delayMax", (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : null; });
    bindSetting(timeoutEl,  "timeoutMs", (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 500 ? n : null; });
    bindSetting(retriesEl,  "maxRetries", (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null; });
    bindSetting(cyclesEl,   "cycleLimit", (v) => {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n > 999) { setStatus("error: cycles 0–999", "err"); return null; }
      return n;
    });
    bindSetting(detailsTA, "descriptionText", (v) => v);

    collapseBtn.addEventListener("click", () => {
      panel.classList.toggle("tsr-collapsed");
      collapseBtn.textContent = panel.classList.contains("tsr-collapsed") ? "▸" : "▾";
    });

    runBtn.addEventListener("click", () => startRun(false));
    stopBtn.addEventListener("click", () => stopRun("user"));
    dashBtn.addEventListener("click", () => {
      debugLog("open dashboard requested");
      try {
        chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }, (resp) => {
          if (chrome.runtime.lastError) {
            warn("open dashboard failed:", chrome.runtime.lastError.message);
            debugLog("open dashboard failed: " + chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.ok) {
            debugLog("dashboard opened" + (resp.fallback ? " (fallback)" : ""));
          } else {
            debugLog("dashboard open error: " + (resp && resp.error ? resp.error : "unknown"));
          }
        });
      } catch (e) {
        warn("sendMessage failed", e);
        debugLog("sendMessage failed: " + e.message);
      }
    });

    makeDraggable(panel, panel.querySelector("#tsr-header"));
    restorePosition(panel);

    panel._refs = { runBtn, stopBtn };
    updateUI();
    updateProgressUI();
    debugLog("panel built");
  }

  function setStatus(msg, kind = "") {
    const el = document.getElementById("tsr-status");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("tsr-ok", "tsr-err");
    if (kind) el.classList.add(kind);
    debugLog("status: " + msg);
  }

  function updateProgressUI() {
    const el = document.getElementById("tsr-progress");
    if (!el) return;
    const limit = state.settings.cycleLimit;
    const cur = state.progress.cycleCount;
    const limitLabel = limit === 0 ? "∞" : String(limit);
    const stepLabel = state.currentStep ? ` · step: ${state.currentStep}` : "";
    const lineCount = parseDescriptionLines(state.settings.descriptionText).length;
    const usedCount = state.progress.usedLines.length;
    const linesLabel = lineCount > 0 ? ` · variants: ${usedCount}/${lineCount}` : "";
    const targetLabel = state.targetChannel ? ` · /${state.targetChannel}` : "";
    el.textContent = `cycle ${cur}/${limitLabel}${targetLabel}${stepLabel}${linesLabel}`;
  }

  function updateUI() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panel._refs) return;
    const { runBtn, stopBtn } = panel._refs;
    runBtn.disabled = state.running;
    stopBtn.disabled = !state.running;
  }

  function makeDraggable(panel, handle) {
    let dragging = false, offX = 0, offY = 0;
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      offX = e.clientX - r.left;
      offY = e.clientY - r.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - offY));
      panel.style.left = x + "px";
      panel.style.top  = y + "px";
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      const r = panel.getBoundingClientRect();
      chrome.storage.local.set({ [K_POS]: { left: r.left, top: r.top } });
    });
  }

  async function restorePosition(panel) {
    try {
      const data = await chrome.storage.local.get(K_POS);
      const p = data[K_POS];
      if (p && typeof p.left === "number") {
        panel.style.left = p.left + "px";
        panel.style.top  = p.top + "px";
        debugLog("position restored");
      }
    } catch (e) { warn(e); }
  }

  // =========================================================
  // init
  // =========================================================
  const observer = new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID)) buildPanel();
  });

  async function init() {
    debugLog("init (incognito=" + IS_INCOGNITO + ")");
    await loadAll();
    buildPanel();
    observer.observe(document.documentElement, { childList: true, subtree: true });

    let autoResume = false;
    let savedTarget = null;
    try {
      const r = await chrome.storage.local.get([K_RESUME, K_TARGET]);
      autoResume = r[K_RESUME] === true;
      savedTarget = r[K_TARGET] || null;
      if (autoResume) await chrome.storage.local.set({ [K_RESUME]: false });
    } catch (e) { warn("resume check failed", e); }

    if (!autoResume) return;

    const cur = getCurrentChannel();
    if (savedTarget && cur !== savedTarget) {
      debugLog(`resume: navigation to /${savedTarget} required (current /${cur || "?"})`);
      await chrome.storage.local.set({ [K_RESUME]: true, [K_TARGET]: savedTarget });
      location.href = `https://www.twitch.tv/${savedTarget}`;
      return;
    }

    debugLog(`auto-resume: settling ${RESUME_SETTLE_MS}ms then starting`);
    state.targetChannel = savedTarget || cur;
    setTimeout(() => startRun(true), RESUME_SETTLE_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();