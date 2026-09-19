(() => {
  "use strict";

  // --- context guard -------------------------------------------------------
  const HAS_EXT =
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.get === "function";

  function showWrongContext() {
    const banner = document.getElementById("ctx-warning");
    const urlEl = document.getElementById("ctx-warning-url");
    if (banner) banner.style.display = "block";
    if (urlEl) urlEl.textContent = "current url: " + location.href;
    document.querySelectorAll("button, input, select, textarea")
      .forEach((el) => { el.disabled = true; });
    const live = document.getElementById("live-pill");
    if (live) {
      live.textContent = "offline";
      live.classList.remove("live");
    }
    console.warn(
      "[TS-Reporter/Dashboard] no chrome.storage — opened outside the extension. " +
      "open via panel → open dashboard, or right-click extension icon → Options."
    );
  }

  if (!HAS_EXT) { showWrongContext(); return; }

  // --- constants -----------------------------------------------------------
  const K_SETTINGS = "tsr_settings_v1";
  const K_PROGRESS = "tsr_progress_v1";
  const K_DEBUG    = "tsr_debug_v1";
  const K_EMAILS   = "tsr_emails_v1";
  const K_TARGET   = "tsr_target_channel_v1";

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

  const CONTENT_TYPES = [
    { label: "Chat Messages", slug: "CHAT_REPORT" },
    { label: "Whispers",      slug: "WHISPER_REPORT" },
    { label: "Username",      slug: "USERNAME_REPORT" },
    { label: "User (Avatar, Channel Points, Panels, Tags, etc.)", slug: "USER_REPORT" }
  ];

  const REASONS = {
    "Ban Evasion": { slug: "ban_evasion", subs: ["Account Ban Evasion", "Aiding Ban Evasion"] },
    "Bullying or Harassment": { slug: "harassment",
      subs: ["Advocating Harassment", "Coordinating Harassment", "Malicious Pranks",
             "Revealing Personal Information", "Targeted Abuse", "Unwanted Sexual Advances"] },
    "Cheating in Game": { slug: "cheating", subs: [] },
    "Explicit Harm": { slug: "explicit_harm",
      subs: ["Animal Endangerment", "Child Endangerment", "Swatting"] },
    "Hateful Conduct": { slug: "hateful_conduct",
      subs: ["Slurs or Symbols", "Encouraging Hateful Behavior",
             "Threatening Violence", "Mocking Trauma"] },
    "IP Violation": { slug: "ip_violation", subs: [] },
    "Impersonation": { slug: "impersonation", subs: [] },
    "Misinformation": { slug: "misinformation", subs: [] },
    "Nudity or Sexually Explicit": { slug: "nudity_sexual",
      subs: ["Sexually Explicit", "Sexual Violence", "Full or Partial Nudity",
             "Sexual Conduct Involving Minors", "Sharing Private Images"] },
    "Self-Harm": { slug: "self_harm",
      subs: ["Intentional Self-Harm", "Threatening Self-Harm", "Encouraging Others to Self-Harm"] },
    "Spam, Scams, Bots, or Tampering": { slug: "spam",
      subs: ["Spam", "Scam", "Bots", "Cyber Attack", "Viewership Tampering"] },
    "Terrorism": { slug: "terrorism", subs: [] },
    "Underage User": { slug: "underage", subs: [] },
    "Violence or Gore": { slug: "violence_gore", subs: [] },
    "Other Illegality": { slug: "other_illegality", subs: [] }
  };

  const $ = (id) => document.getElementById(id);

  let settings = { ...DEFAULT_SETTINGS };
  let saveTimer = null;

  function saveSettingsSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [K_SETTINGS]: settings });
    }, 200);
  }

  // --- dropdowns -----------------------------------------------------------
  function populateDropdowns() {
    const contentSel = $("s-content");
    const reasonSel  = $("s-reason");
    contentSel.innerHTML = "";
    reasonSel.innerHTML = "";
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
  }

  function refreshSubs() {
    const subSel = $("s-subreason");
    const parent = $("s-reason").value;
    subSel.innerHTML = "";
    const none = document.createElement("option");
    none.value = ""; none.textContent = "— none —";
    subSel.appendChild(none);
    const r = REASONS[parent];
    if (!r) return;
    for (const s of r.subs) {
      const o = document.createElement("option");
      o.value = s; o.textContent = s;
      subSel.appendChild(o);
    }
  }

  function applySettingsToForm() {
    $("s-content").value  = settings.content;
    $("s-reason").value   = settings.reason;
    refreshSubs();
    if (settings.subreason) $("s-subreason").value = settings.subreason;
    $("s-delay-min").value = settings.delayMin;
    $("s-delay-max").value = settings.delayMax;
    $("s-timeout").value   = settings.timeoutMs;
    $("s-retries").value   = settings.maxRetries;
    $("s-cycles").value    = settings.cycleLimit;
    $("s-details").value   = settings.descriptionText || "";
  }

  function bindSettings() {
    const bindText = (el, key) => {
      el.addEventListener("input", () => {
        settings[key] = el.value;
        saveSettingsSoon();
      });
    };
    const bindInt = (el, key, min, max) => {
      const handler = () => {
        const n = parseInt(el.value, 10);
        if (!Number.isFinite(n)) return;
        if (min !== null && n < min) return;
        if (max !== null && n > max) return;
        settings[key] = n;
        saveSettingsSoon();
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    };

    $("s-content").addEventListener("change", () => {
      settings.content = $("s-content").value;
      saveSettingsSoon();
    });
    $("s-reason").addEventListener("change", () => {
      settings.reason = $("s-reason").value;
      refreshSubs();
      settings.subreason = $("s-subreason").value || "";
      saveSettingsSoon();
    });
    $("s-subreason").addEventListener("change", () => {
      settings.subreason = $("s-subreason").value || "";
      saveSettingsSoon();
    });
    bindInt($("s-delay-min"), "delayMin", 0, null);
    bindInt($("s-delay-max"), "delayMax", 0, null);
    bindInt($("s-timeout"),   "timeoutMs", 500, null);
    bindInt($("s-retries"),   "maxRetries", 1, 20);
    bindInt($("s-cycles"),    "cycleLimit", 0, 999);
    bindText($("s-details"),  "descriptionText");
  }

  // --- variant parser ($-prefixed) -----------------------------------------
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

  // --- progress ------------------------------------------------------------
  function renderProgress(progress, settingsObj, target) {
    const p = progress || {};
    const s = settingsObj || DEFAULT_SETTINGS;
    const cycle = p.cycleCount || 0;
    const limit = s.cycleLimit === 0 ? "∞" : String(s.cycleLimit ?? "—");
    const used = Array.isArray(p.usedLines) ? p.usedLines.length : 0;
    const total = parseDescriptionLines(s.descriptionText).length;

    $("p-cycle").textContent = String(cycle);
    $("p-limit").textContent = limit;
    $("p-used").textContent = total > 0 ? `${used} / ${total}` : String(used);
    $("p-target").textContent = target ? "/" + target : "—";
  }

  // --- debug ---------------------------------------------------------------
  function renderDebug(lines) {
    const el = $("debug-log");
    const countEl = $("debug-count");
    const arr = Array.isArray(lines) ? lines : [];
    countEl.textContent = arr.length + " line" + (arr.length === 1 ? "" : "s");

    const autoscroll = $("debug-autoscroll").checked;
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;

    el.textContent = arr.length ? arr.join("\n") : "(no logs yet)";
    if (autoscroll && wasAtBottom) el.scrollTop = el.scrollHeight;
  }

  // --- emails --------------------------------------------------------------
  function renderEmails(rows) {
    const tbody = document.querySelector("#emails-table tbody");
    const countEl = $("emails-count");
    const arr = Array.isArray(rows) ? rows : [];
    countEl.textContent = arr.length + " entr" + (arr.length === 1 ? "y" : "ies");

    if (arr.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">no emails used yet</td></tr>`;
      return;
    }
    const view = arr.slice().reverse();
    tbody.innerHTML = view.map((r, i) => {
      const idx = arr.length - i;
      const ts = r.ts ? new Date(r.ts).toLocaleString() : "";
      return `<tr>
        <td class="idx">${idx}</td>
        <td>${escapeHtml(r.email || "")}</td>
        <td>${escapeHtml(r.channel || "")}</td>
        <td>${escapeHtml(r.reason || "")}</td>
        <td>${escapeHtml(r.subreason || "")}</td>
        <td class="time">${escapeHtml(ts)}</td>
      </tr>`;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- buttons -------------------------------------------------------------
  function wireButtons() {
    $("btn-refresh").addEventListener("click", reloadAll);

    $("btn-reset-progress").addEventListener("click", async () => {
      await chrome.storage.local.set({
        [K_PROGRESS]: { usedLines: [], cycleCount: 0 }
      });
      flash("progress reset");
    });
    $("btn-reset-all").addEventListener("click", async () => {
      if (!confirm("reset settings + progress + debug + emails?")) return;
      await chrome.storage.local.set({
        [K_SETTINGS]: { ...DEFAULT_SETTINGS },
        [K_PROGRESS]: { usedLines: [], cycleCount: 0 },
        [K_DEBUG]: [],
        [K_EMAILS]: [],
        [K_TARGET]: null
      });
      settings = { ...DEFAULT_SETTINGS };
      applySettingsToForm();
      flash("everything reset");
    });

    $("btn-clear-debug").addEventListener("click", async () => {
      await chrome.storage.local.set({ [K_DEBUG]: [] });
      flash("debug cleared");
    });
    $("btn-copy-debug").addEventListener("click", async () => {
      const data = await chrome.storage.local.get(K_DEBUG);
      const text = (data[K_DEBUG] || []).join("\n");
      await navigator.clipboard.writeText(text);
      flash("debug copied");
    });

    $("btn-clear-emails").addEventListener("click", async () => {
      await chrome.storage.local.set({ [K_EMAILS]: [] });
      flash("emails cleared");
    });
    $("btn-copy-emails").addEventListener("click", async () => {
      const data = await chrome.storage.local.get(K_EMAILS);
      const rows = data[K_EMAILS] || [];
      const text = rows.map((r) =>
        `${new Date(r.ts).toISOString()}\t${r.email}\t${r.channel || ""}\t${r.reason || ""}\t${r.subreason || ""}`
      ).join("\n");
      await navigator.clipboard.writeText(text);
      flash("emails copied");
    });
  }

  let flashTimer = null;
  function flash(msg) {
    const el = $("settings-note");
    if (!el) return;
    const prev = el.textContent;
    el.textContent = msg;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.textContent = prev; }, 1500);
  }

  // --- live storage subscription -------------------------------------------
  function subscribeStorage() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[K_DEBUG])  renderDebug(changes[K_DEBUG].newValue);
      if (changes[K_EMAILS]) renderEmails(changes[K_EMAILS].newValue);
      if (changes[K_SETTINGS]) {
        settings = { ...DEFAULT_SETTINGS, ...(changes[K_SETTINGS].newValue || {}) };
        const active = document.activeElement?.id || "";
        if (!active.startsWith("s-")) applySettingsToForm();
      }
      loadProgressAndTarget();
    });
  }

  async function loadProgressAndTarget() {
    const data = await chrome.storage.local.get([K_PROGRESS, K_SETTINGS, K_TARGET]);
    renderProgress(data[K_PROGRESS], data[K_SETTINGS] || settings, data[K_TARGET]);
  }

  // --- boot ----------------------------------------------------------------
  async function reloadAll() {
    const data = await chrome.storage.local.get([K_SETTINGS, K_PROGRESS, K_DEBUG, K_EMAILS, K_TARGET]);
    settings = { ...DEFAULT_SETTINGS, ...(data[K_SETTINGS] || {}) };
    applySettingsToForm();
    renderProgress(data[K_PROGRESS], settings, data[K_TARGET]);
    renderDebug(data[K_DEBUG] || []);
    renderEmails(data[K_EMAILS] || []);
    flash("refreshed");
  }

  async function init() {
    populateDropdowns();
    bindSettings();
    wireButtons();
    subscribeStorage();
    await reloadAll();
    $("live-pill").classList.add("live");
    console.log("[TS-Reporter/Dashboard] ready");
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();