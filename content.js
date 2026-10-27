(() => {
  "use strict";

  const IS_INCOGNITO = chrome.extension?.inIncognitoContext === true;
  if (!IS_INCOGNITO) return;

  const PANEL_ID = "tsr-panel";
  const K_POS      = "tsr_panel_pos_v1";
  const K_SETTINGS = "tsr_settings_v1";
  const K_PROGRESS = "tsr_progress_v1";
  const K_RESUME   = "tsr_resume_v1";
  const K_TARGET   = "tsr_target_channel_v1";
  const K_EMAILS   = "tsr_emails_v1";

  const EMAIL_LIMIT = 2000;
  const USED_EMAILS_LIMIT = 5000;
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

  const DEFAULT_PROGRESS = {
    usedLines: [],
    cycleCount: 0,
    lastUA: null,
    usedEmails: []
  };

  const state = {
    running: false,
    settings: { ...DEFAULT_SETTINGS },
    progress: { ...DEFAULT_PROGRESS },
    currentStep: null,
    currentLine: null,
    usedSearchReason: false,
    targetChannel: null,
    challengeStrikes: 0
  };

  async function recordEmail(email, channel, reason, subreason, ua) {
    try {
      const data = await chrome.storage.local.get(K_EMAILS);
      const arr = Array.isArray(data[K_EMAILS]) ? data[K_EMAILS] : [];
      arr.push({
        email,
        channel: channel || null,
        reason: reason || null,
        subreason: subreason || null,
        ua: ua || null,
        ts: Date.now()
      });
      if (arr.length > EMAIL_LIMIT) arr.splice(0, arr.length - EMAIL_LIMIT);
      await chrome.storage.local.set({ [K_EMAILS]: arr });
    } catch {}
  }

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

  async function humanPause(baseMs) {
    const jitter = rand(-200, 400);
    const extra = Math.random() < 0.2 ? rand(200, 800) : 0;
    await sleepInterruptible(Math.max(100, baseMs + jitter + extra));
    if (!state.running) return;
    if (Math.random() < 0.3) {
      try { window.scrollBy({ top: rand(-80, 80), behavior: "smooth" }); } catch {}
    }
    if (Math.random() < 0.4) {
      try {
        const x = rand(100, Math.max(200, window.innerWidth - 100));
        const y = rand(100, Math.max(200, window.innerHeight - 100));
        const el = document.elementFromPoint(x, y);
        el?.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }));
      } catch {}
    }
  }

  function detectChallenge() {
    try {
      if (document.querySelector("[data-challenge], .challenge-container, #challenge-form, iframe[src*='kasada']")) return "kasada";
      const body = (document.body?.innerText || "").toLowerCase();
      if (body.includes("checking your browser") || body.includes("please wait while we verify")) return "verify";
      if (body.includes("verify you are human") || body.includes("are you a robot")) return "captcha";
    } catch {}
    return null;
  }

  const EMAIL_PREFIXES = [
    "user", "usr", "mail", "inbox", "contact", "acc", "account",
    "member", "reg", "signup", "hello", "info", "no-reply", "support",
    "help", "admin", "team", "office", "client", "guest"
  ];

  const WESTERN_FIRST_M = [
    "james","john","robert","michael","william","david","richard","joseph","thomas","charles",
    "christopher","daniel","matthew","anthony","mark","donald","steven","paul","andrew","joshua",
    "kenneth","kevin","brian","george","timothy","ronald","jason","edward","jeffrey","ryan",
    "jacob","gary","nicholas","eric","jonathan","stephen","larry","justin","scott","brandon",
    "benjamin","samuel","raymond","gregory","frank","alexander","patrick","jack","dennis","jerry",
    "tyler","aaron","jose","adam","nathan","henry","douglas","zachary","peter","kyle",
    "noah","ethan","jeremy","walter","christian","keith","roger","terry","gerald","harold",
    "sean","austin","carl","arthur","lawrence","dylan","jesse","jordan","bryan","billy",
    "bruce","gabriel","logan","albert","willie","alan","juan","wayne","elijah","randy",
    "roy","vincent","ralph","eugene","russell","bobby","mason","philip","louis","harry",
    "liam","lucas","oliver","leo","max","owen","caleb","isaac","connor","luke",
    "wyatt","hudson","asher","carter","hunter","evan","nolan","axel"
  ];
  const WESTERN_FIRST_F = [
    "mary","patricia","jennifer","linda","elizabeth","barbara","susan","jessica","sarah","karen",
    "nancy","lisa","betty","margaret","sandra","ashley","kimberly","emily","donna","michelle",
    "carol","amanda","dorothy","melissa","deborah","stephanie","rebecca","sharon","laura","cynthia",
    "kathleen","amy","angela","shirley","anna","brenda","pamela","emma","nicole","helen",
    "samantha","katherine","christine","debra","rachel","carolyn","janet","catherine","maria","heather",
    "diane","ruth","julie","olivia","joyce","virginia","victoria","kelly","lauren","christina",
    "joan","evelyn","judith","megan","cheryl","andrea","hannah","martha","jacqueline","frances",
    "gloria","ann","teresa","kathryn","sara","janice","jean","alice","madison","doris",
    "abigail","julia","judy","grace","denise","amber","marilyn","beverly","danielle","theresa",
    "sophia","marie","diana","brittany","natalie","isabella","charlotte","rose","alexis","kayla",
    "mia","chloe","ella","ava","lily","zoe","nora","ruby","stella","violet",
    "aurora","hazel","layla","scarlett","aria","ellie","audrey","claire","skylar","lucy"
  ];
  const WESTERN_LAST = [
    "smith","johnson","williams","brown","jones","garcia","miller","davis","rodriguez","martinez",
    "hernandez","lopez","gonzalez","wilson","anderson","thomas","taylor","moore","jackson","martin",
    "lee","perez","thompson","white","harris","sanchez","clark","ramirez","lewis","robinson",
    "walker","young","allen","king","wright","scott","torres","nguyen","hill","flores",
    "green","adams","nelson","baker","hall","rivera","campbell","mitchell","carter","roberts",
    "gomez","phillips","evans","turner","diaz","parker","cruz","edwards","collins","reyes",
    "stewart","morris","morales","murphy","cook","rogers","gutierrez","ortiz","morgan","cooper",
    "peterson","bailey","reed","kelly","howard","ramos","kim","cox","ward","richardson",
    "watson","brooks","chavez","wood","james","bennett","gray","mendoza","ruiz","hughes",
    "price","alvarez","castillo","sanders","patel","myers","long","ross","foster","jimenez",
    "powell","jenkins","perry","russell","sullivan","bell","coleman","butler","henderson","barnes",
    "gonzales","fisher","vasquez","simmons","romero","jordan","patterson","alexander","hamilton",
    "graham","reynolds","griffin","wallace","moreno","west","cole","hayes","bryant","herrera",
    "gibson","ellis","tran","medina","aguilar","stevens","murray","ford","castro","marshall"
  ];

  const RU_FIRST_M = [
    "aleksandr","alexander","aleksey","andrey","anton","arkadiy","artem","artyom","bogdan","boris",
    "vadim","valentin","valeriy","vasiliy","viktor","vitaliy","vladimir","vladislav","vsevolod","vyacheslav",
    "gennadiy","georgiy","german","gleb","grigoriy","daniil","denis","dmitriy","evgeniy","egor",
    "ilya","igor","ivan","kirill","konstantin","lev","leonid","maksim","maxim","marat",
    "mark","matvey","mikhail","nikita","nikolay","oleg","pavel","petr","platon","rinat",
    "rodion","roman","rostislav","ruslan","saveliy","semyon","sergey","stanislav","stepan","timofey",
    "timur","trofim","fedor","filipp","eduard","yuriy","yaroslav","arseniy","artur","david",
    "demid","innokentiy","luka","miroslav","prokhor","savva","taras","vasil","zahar","zakhar",
    "afanasiy","anatoliy","sasha","sanya"
  ];
  const RU_FIRST_F = [
    "aleksandra","alena","alina","alla","anastasiya","anna","antonina","valentina","valeriya","varvara",
    "vasilisa","vera","veronika","viktoriya","vladislava","galina","darya","daria","diana","evgeniya",
    "ekaterina","elena","elizaveta","zhanna","zinaida","zoya","inna","irina","karina","ksenia",
    "larisa","lidiya","liliya","lyubov","lyudmila","margarita","marina","mariya","nadezhda","natalya",
    "nina","oksana","olga","polina","raisa","regina","svetlana","sofia","sofya","stanislava",
    "taisiya","tatyana","ulyana","yuliya","yana","anzhelika","venera","dina","eva","zara",
    "zarina","ilona","inga","kamila","kristina","lada","laura","leyla","milana","mila",
    "neonila","nika","nonna","pelageya","rada","renata","ruslana","sabina","tamara","tina",
    "uzlana","fatima","faina","flora","edita","elvira","emma","yulianna","vasilina","agniya",
    "arkadiya","bella","sasha"
  ];
  const RU_LAST_M = [
    "ivanov","smirnov","kuznetsov","popov","vasiliev","petrov","sokolov","mikhailov","novikov","fedorov",
    "morozov","volkov","alekseev","lebedev","semenov","egorov","pavlov","kozlov","stepanov","nikolaev",
    "orlov","andreev","makarov","nikitin","zakharov","zaitsev","soloviev","borisov","yakovlev","grigoriev",
    "romanov","vorobyov","sergeev","kiselev","kuzmin","maksimov","isaev","tikhonov","gusev","bogdanov",
    "belyaev","komarov","frolov","krylov","nikiforov","matveev","dmitriev","kudryavtsev","baranov","kulikov",
    "sorokin","medvedev","ermolaev","mironov","tarasov","belov","komissarov","melnikov","shcherbakov","blinov",
    "kolesnikov","markov","suvorov","muravyov","zuev","sidorov","shubin","karpov","afanasev","biryukov",
    "vinogradov","grishin","drozdov","ershov","kalinin","kondratev","lavrentev","maltsev","maslov","moiseev",
    "polyakov","safonov","sharapov","shirokov","shishkin","gorshkov","golubev","denisov","egorov","iljin",
    "karpov","kiselev","korneev","kotov","kruglov","kudryashov","lavrov","litvinov","lobanov","lukin",
    "mironov","nikiforov","nikolaev","nosov","ovchinnikov","panov","pavlov","petukhov","pimenov","polyakov",
    "rodionov","rusakov","safronov","samsonov","savin","sazonov","seliverstov","shestakov","shilov","shubin"
  ];
  const RU_LAST_F = RU_LAST_M.map((n) => n + "a");

  const CN_FIRST = [
    "wei","fang","jing","min","jun","yan","hao","lei","qiang","jie","yu","yang","bo","kai","hui",
    "ling","na","xia","qing","hua","xiao","bing","chao","long","peng","fei","gang","tao","xin","zhe",
    "xin","yi","yuan","hao","ming","hui","yue","rui","ting","chen"
  ];
  const CN_LAST = [
    "wang","li","zhang","liu","chen","yang","huang","zhao","wu","zhou","xu","sun","ma","zhu","hu",
    "guo","he","gao","lin","luo","zheng","liang","xie","song","tang","han","feng","deng","cao","peng",
    "zeng","xiao","tian","dong","yuan","pan","yu","du","jiang","cai"
  ];

  const DOMAIN_WEIGHTS = {
    west: [
      { domain: "gmail.com",      weight: 50 },
      { domain: "outlook.com",    weight: 10 },
      { domain: "hotmail.com",    weight: 8  },
      { domain: "yahoo.com",      weight: 8  },
      { domain: "icloud.com",     weight: 7  },
      { domain: "proton.me",      weight: 4  },
      { domain: "protonmail.com", weight: 2  },
      { domain: "aol.com",        weight: 2  },
      { domain: "gmx.net",        weight: 2  },
      { domain: "web.de",         weight: 2  },
      { domain: "me.com",         weight: 2  },
      { domain: "mac.com",        weight: 1  },
      { domain: "atomicmail.io",  weight: 1  }
    ],
    ru: [
      { domain: "gmail.com",  weight: 28 },
      { domain: "mail.ru",    weight: 22 },
      { domain: "yandex.ru",  weight: 18 },
      { domain: "bk.ru",      weight: 8  },
      { domain: "list.ru",    weight: 6  },
      { domain: "inbox.ru",   weight: 5  },
      { domain: "ya.ru",      weight: 4  },
      { domain: "rambler.ru", weight: 3  },
      { domain: "icloud.com", weight: 2  },
      { domain: "outlook.com",weight: 2  },
      { domain: "proton.me",  weight: 1  },
      { domain: "hotmail.com",weight: 1  }
    ],
    cn: [
      { domain: "qq.com",      weight: 65 },
      { domain: "gmail.com",   weight: 25 },
      { domain: "outlook.com", weight: 5  },
      { domain: "proton.me",   weight: 5  }
    ]
  };

  let usedEmailsSet = new Set();

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function pickNameGroup() {
    const r = Math.random();
    if (r < 0.50) return "ru";
    if (r < 0.95) return "west";
    return "cn";
  }

  function pickNames(group) {
    if (group === "ru") {
      const isM = Math.random() < 0.5;
      return {
        first: pick(isM ? RU_FIRST_M : RU_FIRST_F),
        last:  pick(isM ? RU_LAST_M  : RU_LAST_F)
      };
    }
    if (group === "cn") {
      return { first: pick(CN_FIRST), last: pick(CN_LAST) };
    }
    const isM = Math.random() < 0.5;
    return {
      first: pick(isM ? WESTERN_FIRST_M : WESTERN_FIRST_F),
      last:  pick(WESTERN_LAST)
    };
  }

  function pickDomain(group) {
    const list = DOMAIN_WEIGHTS[group] || DOMAIN_WEIGHTS.west;
    const total = list.reduce((s, x) => s + x.weight, 0);
    let r = Math.random() * total;
    for (const { domain, weight } of list) {
      if (r < weight) return domain;
      r -= weight;
    }
    return list[list.length - 1].domain;
  }

  function buildLocalPart(group) {
    const { first, last } = pickNames(group);
    const f = first, l = last;
    const fi = f[0], li = l[0];

    const y4 = (() => {
      const r = Math.random();
      if (r < 0.55) return rand(1990, 2008);
      if (r < 0.82) return rand(1970, 1989);
      if (r < 0.94) return rand(1950, 1969);
      if (r < 0.99) return rand(2009, 2013);
      return rand(1940, 1949);
    })();
    const y2s = String(y4 % 100).padStart(2, "0");
    const n2  = rand(10, 99);
    const n3  = rand(100, 999);
    const n4  = rand(1000, 9999);
    const bizPrefix = pick(EMAIL_PREFIXES);

    const variants = [
      `${f}.${l}`, `${f}_${l}`, `${f}${l}`,
      `${l}.${f}`, `${l}_${f}`, `${l}${f}`,
      `${fi}.${l}`, `${fi}${l}`, `${fi}_${l}`,
      `${f}.${li}`, `${f}${li}`, `${f}_${li}`,
      `${fi}${li}`, `${fi}.${li}`,
      `${f}.${l}${y4}`, `${f}${l}${y4}`, `${f}_${l}_${y4}`, `${f}.${l}.${y4}`,
      `${l}${f}${y4}`, `${f}${li}${y4}`, `${fi}${l}${y4}`, `${f}${y4}`, `${l}${y4}`,
      `${f}${l}${y2s}`, `${f}.${l}${y2s}`, `${f}_${l}_${y2s}`, `${f}${y2s}`, `${l}${y2s}`,
      `${fi}${l}${y2s}`, `${fi}${li}${y2s}`,
      `${f}.${l}${n2}`, `${f}${l}${n2}`, `${f}_${l}${n2}`, `${f}${n2}`, `${l}${n2}`, `${fi}${li}${n2}`,
      `${f}.${l}${n3}`, `${f}${l}${n3}`, `${f}${n3}`, `${f}_${n3}`, `${fi}${l}${n3}`,
      `${f}.${l}${n4}`, `${f}${l}${n4}`, `${f}${n4}`,
      `${bizPrefix}${n3}`, `${bizPrefix}${n4}`, `${bizPrefix}_${n3}`, `${bizPrefix}.${l}`, `${bizPrefix}_${l}`
    ];

    // Минимальная длина локальной части email — 6 символов.
    const MIN_LOCAL = 6;
    const suitable = Array.from(
      new Set(variants.filter((v) => v.length >= MIN_LOCAL))
    );
    if (suitable.length > 0) return pick(suitable);

    // Страховка (на практике не срабатывает) — добиваем цифрами до 6.
    let out = pick(variants);
    while (out.length < MIN_LOCAL) out += String(rand(0, 9));
    return out;
  }

  function randomEmail() {
    const group = pickNameGroup();
    const domain = pickDomain(group);

    let email = "";
    for (let i = 0; i < 40; i++) {
      const candidate = `${buildLocalPart(group)}@${domain}`;
      if (!usedEmailsSet.has(candidate)) { email = candidate; break; }
    }
    if (!email) {
      email = `${buildLocalPart(group)}${rand(10000, 99999)}@${domain}`;
    }

    usedEmailsSet.add(email);
    if (!Array.isArray(state.progress.usedEmails)) state.progress.usedEmails = [];
    state.progress.usedEmails.push(email);
    if (state.progress.usedEmails.length > USED_EMAILS_LIMIT) {
      state.progress.usedEmails.splice(
        0, state.progress.usedEmails.length - USED_EMAILS_LIMIT
      );
    }
    persistSoon();

    return email;
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

  async function loadAll() {
    try {
      const data = await chrome.storage.local.get(
        [K_SETTINGS, K_PROGRESS, K_POS, K_TARGET, K_EMAILS]
      );
      if (data[K_SETTINGS]) state.settings = { ...DEFAULT_SETTINGS, ...data[K_SETTINGS] };
      delete state.settings.debug;
      if (data[K_PROGRESS]) state.progress = { ...DEFAULT_PROGRESS, ...data[K_PROGRESS] };
      if (data[K_TARGET])   state.targetChannel = data[K_TARGET];

      usedEmailsSet = new Set(
        Array.isArray(state.progress.usedEmails) ? state.progress.usedEmails : []
      );
      const log = Array.isArray(data[K_EMAILS]) ? data[K_EMAILS] : [];
      for (const rec of log) {
        if (rec && typeof rec.email === "string") usedEmailsSet.add(rec.email);
      }
      state.progress.usedEmails = Array.from(usedEmailsSet);
      if (state.progress.usedEmails.length > USED_EMAILS_LIMIT) {
        state.progress.usedEmails.splice(
          0, state.progress.usedEmails.length - USED_EMAILS_LIMIT
        );
      }
    } catch (e) {}
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

  const SEL = {
    moreOptions: [
      'button[data-a-target="report-button-more-button"]',
      'button[aria-label="More options"]',
      'button[aria-label="Plus d\'options"]',
      'button[aria-label="Más opciones"]',
      'button[aria-label="Mais opções"]',
      'button[aria-label="Weitere Optionen"]',
      'button[aria-label="Altre opzioni"]',
      'button[aria-label="Дополнительные параметры"]',
      'button[title="More options"]'
    ],
    reportChannel: [
      'button[data-a-target="report-button-report-button"]',
      'button[aria-label="Report Channel"]',
      'button[aria-label="Signaler la chaîne"]',
      'button[aria-label="Denunciar el canal"]',
      'button[aria-label="Informar sobre el canal"]',
      'button[aria-label="Denunciar canal"]',
      'button[aria-label="Kanal melden"]',
      'button[aria-label="Segnala il canale"]',
      'button[aria-label="Пожаловаться на канал"]'
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
      'button[data-a-target="form-navigation-close"]',
      '[data-a-target="form-navigation-close"]',
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

  const CHANNEL_BTN_TARGET = "report-button-report-button";

  const REPORT_CHANNEL_PATTERNS = [
    /report\s+channel/i, /report\s+.*channel/i,
    /kanal\s+melden/i, /kanal\s+reporten/i, /kanal\s+berichten/i,
    /über\s+.*kanal\s+berichten/i,
    /signaler\s+la\s+cha[iî]ne/i, /signaler\s+la\s+chaine/i, /signaler\s+.*cha[iî]ne/i,
    /denunciar\s+(el\s+)?canal/i, /informar\s+sobre\s+(el\s+)?canal/i,
    /reportar\s+(o\s+)?canal/i, /denunciar\s+canal/i,
    /segnala\s+(il\s+)?canale/i,
    /rapporter\s+kanal/i, /rapportera\s+kanal/i, /rapporteer\s+kanaal/i,
    /raportuj\s+kanał/i, /raportuj\s+kanal/i,
    /kanalı\s+şikayet\s+et/i,
    /пожаловаться\s+на\s+канал/i,
    /举报频道/, /通報チャンネル/, /チャンネルを報告/, /채널\s*신고/
  ];

  const FILE_REPORT_PATTERNS = [
    /file\s+a\s+report/i, /submit\s+a\s+report/i, /send\s+(a\s+)?report/i,
    /report\s+user/i, /file\s+report/i, /create\s+report/i,
    /eine\s+meldung\s+einreichen/i, /meldung\s+einreichen/i, /bericht\s+einreichen/i,
    /einen\s+versto[sß]\s+melden/i, /versto[sß]\s+melden/i,
    /envoyer\s+un\s+signalement/i, /envoyer\s+un\s+rapport/i,
    /signaler\s+un\s+rapport/i, /signaler\s+un\s+signalement/i,
    /enviar\s+un\s+informe/i, /enviar\s+un\s+reporte/i, /denunciar\s+un\s+reporte/i,
    /enviar\s+uma\s+den[uú]ncia/i, /enviar\s+den[uú]ncia/i,
    /invia\s+una\s+segnalazione/i, /invia\s+un.*segnalazione/i, /segnala\s+un.*segnalazione/i,
    /skicka\s+en\s+anmälan/i, /anmäl/i,
    /подать\s+жалобу/i, /отправить\s+жалобу/i, /пожаловаться/i, /сообщить\s+о\s+нарушении/i,
    /举报/, /报告/, /通報/, /報告/, /신고/,
    /şikayet\s+et/i, /bildir/i
  ];

  const BLOCK_EXCLUDE_PATTERNS = [
    /^block/i, /^blocking/i, /^blockieren/i, /^blockera/i, /^blocca/i,
    /^bloquer/i, /^bloquear/i, /^bloc\b/i, /^блок/i, /^заблокировать/i,
    /^屏蔽/i, /^ブロック/, /^차단/, /^engelle/i,
    /^cancel/i, /^abbrechen/i, /^annuler/i, /^cancelar/i, /^annulla/i,
    /^avbryt/i, /^annuller/i, /^anuluj/i, /^iptal/i,
    /^取消/, /^キャンセル/, /^취소/,
    /^close$/i, /^schlie[sß]en$/i, /^fermer$/i, /^cerrar$/i, /^chiudi$/i,
    /^stäng$/i, /^sluiten$/i, /^закрыть$/i, /^закрити$/i,
    /^关闭$/, /^閉じる$/, /^닫기$/, /^kapat$/i,
    /^anmelden$/i, /^einloggen$/i, /^log\s*in$/i, /^login$/i,
    /^sign\s*in$/i, /^sign\s*up$/i, /^register$/i, /^registrieren$/i,
    /^s'?inscrire$/i, /^connexion$/i, /^se\s+connecter$/i,
    /^iniciar\s+sesi[oó]n$/i, /^entrar$/i, /^accedi$/i, /^acceder$/i,
    /^войти$/i, /^вход$/i, /^注册$/, /^ログイン$/, /^로그인$/i, /^giri[sş]\s+yap$/i
  ];

  const REASON_LABELS_I18N = {
    "Ban Evasion": [
      "Ban Evasion", "Contournement de bannissement", "Contournement de ban",
      "Evasão de banimento", "Evasão de ban", "Umgehung einer Sperre",
      "Sperrumgehung", "Elusión de expulsión", "Evasione del ban",
      "Обход блокировки", "Обход бана", "Narı i̇hlali", "Yasak atlatma",
      "规避封禁", "封鎖回避", "밴 회피"
    ],
    "Bullying or Harassment": [
      "Bullying or Harassment", "Intimidation ou harcèlement",
      "Bullying ou assédio", "Assédio", "Mobbing oder Belästigung",
      "Belästigung", "Acoso o intimidación", "Acoso", "Bullismo o molestie",
      "Моббинг или домогательства", "Домогательства", "Taciz veya zorbalık",
      "Zorbalık", "欺凌或骚扰", "いじめ・嫌がらせ", "괴롭힘 또는 괴롭힘"
    ],
    "Cheating in Game": [
      "Cheating in Game", "Triche en jeu", "Trapaça no jogo",
      "Cheating im Spiel", "Schummeln", "Hacer trampa en el juego",
      "Trucchi nel gioco", "Читерство в игре", "Читерство", "Oyunda hile",
      "游戏作弊", "ゲームでのチート", "게임 내 부정행위"
    ],
    "Explicit Harm": [
      "Explicit Harm", "Préjudice explicite", "Dano explícito",
      "Explizite Schädigung", "Daño explícito", "Danno esplicito",
      "Явный вред", "Açık zarar", "明确的伤害", "明示的な危害", "명백한 피해"
    ],
    "Hateful Conduct": [
      "Hateful Conduct", "Conduite haineuse", "Conduta de ódio",
      "Hasserfülltes Verhalten", "Hassverhalten", "Conducta de odio",
      "Condotta d'odio", "Odio", "Враждебное поведение",
      "Nefret içerikli davranış", "Nefret söylemi", "仇恨行为",
      "ヘイト行為", "혐오 행위"
    ],
    "IP Violation": [
      "IP Violation", "Violation de propriété intellectuelle",
      "Violação de PI", "Urheberrechtsverletzung", "IP-Verletzung",
      "Violación de PI", "Violazione di PI", "Нарушение прав ИС",
      "Fikri mülkiyet ihlali", "侵犯知识产权", "知的財産権の侵害", "지식 재산권 침해"
    ],
    "Impersonation": [
      "Impersonation", "Usurpation d'identité", "Personificação",
      "Identitätstäuschung", "Impersonación", "Impersonificazione",
      "Выдача себя за другого", "Kimliğe bürünme", "冒充他人",
      "なりすまし", "사칭"
    ],
    "Misinformation": [
      "Misinformation", "Désinformation", "Desinformação",
      "Fehlinformation", "Desinformación", "Disinformazione",
      "Дезинформация", "Yanlış bilgi", "虚假信息", "誤情報", "허위 정보"
    ],
    "Nudity or Sexually Explicit": [
      "Nudity or Sexually Explicit", "Nudité ou contenu sexuellement explicite",
      "Nudez ou conteúdo sexualmente explícito", "Nacktheit oder sexuell explizite Inhalte",
      "Nudez o contenido sexual explícito", "Nudità o contenuti sessualmente espliciti",
      "Нагота или откровенно сексуальный контент", "Çıplaklık veya cinsel içerik",
      "裸体或露骨色情内容", "裸体または性的に露骨な表現", "노출 또는 성적으로 노골적인 콘텐츠"
    ],
    "Off Twitch Behavior": [
      "Off Twitch Behavior", "Comportement hors Twitch",
      "Comportamento fora da Twitch", "Verhalten außerhalb von Twitch",
      "Comportamiento fuera de Twitch", "Comportamento fuori da Twitch",
      "Поведение за пределами Twitch", "Twitch dışı davranış",
      "Twitch 平台外的行为", "Twitch 外での行為", "Twitch 외 행동"
    ],
    "Self-Harm": [
      "Self-Harm", "Automutilation", "Automutilação",
      "Selbstverletzung", "Selbstverletzendes Verhalten",
      "Autolesión", "Autolesionismo",
      "Самоповреждение", "Kendine zarar verme", "自残", "自傷行為", "자해"
    ],
    "Spam, Scams, Bots, or Tampering": [
      "Spam, Scams, Bots, or Tampering", "Spam, arnaques, bots ou manipulation",
      "Spam, golpes, bots ou manipulação", "Spam, Betrug, Bots oder Manipulation",
      "Spam, escroquerie, bots, altération de fichiers",
      "Spam, estafas, bots o manipulación", "Spam, truffe, bot o manomissione",
      "Спам, мошенничество, боты или вмешательство", "Spam, dolandırıcılık, botlar veya kurcalama",
      "垃圾信息、诈骗、机器人或篡改", "スパム、詐欺、ボット、改ざん", "스팸, 사기, 봇 또는 변조"
    ],
    "Terrorism": [
      "Terrorism", "Terrorisme", "Terrorismo", "Terrorismus",
      "Терроризм", "Terörizm", "恐怖主义", "テロリズム", "테러리즘"
    ],
    "Underage User": [
      "Underage User", "Utilisateur mineur", "Usuário menor de idade",
      "Minderjähriger Nutzer", "Usuario menor de edad", "Utente minorenne",
      "Несовершеннолетний пользователь", "Reşit olmayan kullanıcı",
      "未成年用户", "未成年ユーザー", "미성년자 사용자"
    ],
    "Violence or Gore": [
      "Violence or Gore", "Violence ou contenu sanglant", "Violência ou conteúdo sangrento",
      "Gewalt oder Blut", "Gewalt oder Gore", "Violencia o sangre", "Violenza o sangue",
      "Насилие или жестокость", "Şiddet veya vahşet", "暴力或血腥",
      "暴力または流血", "폭력 또는 유혈"
    ],
    "Other Illegality": [
      "Other Illegality", "Autre activité illégale", "Outra ilegalidade",
      "Sonstige Illegalität", "Otra ilegalidad", "Altra illegalità",
      "Иная незаконная деятельность", "Diğer yasa dışılık", "其他违法行为",
      "その他の違法行為", "기타 불법 행위"
    ]
  };

  const SUB_LABELS_I18N = {
    "Account Ban Evasion": ["Account Ban Evasion", "Contournement de bannissement de compte", "Evasão de banimento de conta"],
    "Aiding Ban Evasion": ["Aiding Ban Evasion", "Aide au contournement de bannissement", "Auxílio à evasão de banimento"],
    "Advocating Harassment": ["Advocating Harassment", "Incitation au harcèlement", "Incentivo ao assédio"],
    "Coordinating Harassment": ["Coordinating Harassment", "Coordination de harcèlement", "Coordenação de assédio"],
    "Malicious Pranks": ["Malicious Pranks", "Farces malveillantes", "Pegadinhas maliciosas"],
    "Revealing Personal Information": ["Revealing Personal Information", "Divulgation d'informations personnelles", "Divulgação de informações pessoais", "Doxxing"],
    "Targeted Abuse": ["Targeted Abuse", "Abus ciblé", "Abuso direcionado"],
    "Unwanted Sexual Advances": ["Unwanted Sexual Advances", "Avances sexuelles non désirées", "Avanços sexuais indesejados"],
    "Animal Endangerment": ["Animal Endangerment", "Mise en danger d'animaux", "Colocando animais em perigo"],
    "Child Endangerment": ["Child Endangerment", "Mise en danger d'enfants", "Colocando crianças em perigo"],
    "Swatting": ["Swatting", "Swatting", "Swatting"],
    "Slurs or Symbols": ["Slurs or Symbols", "Insultes ou symboles", "Injúrias ou símbolos"],
    "Encouraging Hateful Behavior": ["Encouraging Hateful Behavior", "Encouragement au comportement haineux", "Incentivo a comportamento de ódio"],
    "Threatening Violence": ["Threatening Violence", "Menaces de violence", "Ameaças de violência"],
    "Mocking Trauma": ["Mocking Trauma", "Moquerie du traumatisme", "Zombaria de trauma"],
    "Sexually Explicit": ["Sexually Explicit", "Sexuellement explicite", "Sexualmente explícito"],
    "Sexual Violence": ["Sexual Violence", "Violence sexuelle", "Violência sexual"],
    "Full or Partial Nudity": ["Full or Partial Nudity", "Nudité totale ou partielle", "Nudez total ou parcial"],
    "Sexual Conduct Involving Minors": ["Sexual Conduct Involving Minors", "Conduite sexuelle impliquant des mineurs", "Conduta sexual envolvendo menores"],
    "Sharing Private Images": ["Sharing Private Images", "Partage d'images privées", "Compartilhamento de imagens privadas"],
    "Intentional Self-Harm": ["Intentional Self-Harm", "Automutilation intentionnelle", "Automutilação intencional"],
    "Threatening Self-Harm": ["Threatening Self-Harm", "Menace d'automutilation", "Ameaça de automutilação"],
    "Encouraging Others to Self-Harm": ["Encouraging Others to Self-Harm", "Encouragement d'autrui à l'automutilation", "Incentivo a outros à automutilação"],
    "Spam": ["Spam", "Spam", "Spam"],
    "Scam": ["Scam", "Arnaque", "Golpe"],
    "Bots": ["Bots", "Bots", "Bots"],
    "Cyber Attack": ["Cyber Attack", "Cyberattaque", "Ataque cibernético"],
    "Viewership Tampering": ["Viewership Tampering", "Manipulation des audiences", "Manipulação de audiência"]
  };

  const CONTENT_LABELS_I18N = {
    "Chat Messages": ["Chat Messages", "Messages de chat", "Mensagens de chat", "Chat-Nachrichten", "Mensajes de chat", "Messaggi in chat"],
    "Whispers": ["Whispers", "Chuchotements", "Sussurros", "Flüstern", "Susurros", "Sussurri"],
    "Username": ["Username", "Nom d'utilisateur", "Nome de usuário", "Benutzername", "Nombre de usuario", "Nome utente"],
    "User (Avatar, Channel Points, Panels, Tags, etc.)": [
      "User (Avatar, Channel Points, Panels, Tags, etc.)",
      "Utilisateur (avatar, points de chaîne, panneaux, tags, etc.)",
      "Usuário (avatar, pontos do canal, painéis, tags, etc.)",
      "Benutzer (Avatar, Kanalpunkte, Panels, Tags usw.)",
      "Usuario (avatar, puntos de canal, paneles, etiquetas, etc.)",
      "Utente (avatar, punti canale, pannelli, tag, ecc.)"
    ],
    "Off Twitch Behavior": ["Off Twitch Behavior", "Comportement hors Twitch", "Comportamento fora da Twitch"]
  };

  function findClickable(patterns, scope = document, excludes = null) {
    const pats = Array.isArray(patterns) ? patterns : [patterns];
    const exs = excludes ? (Array.isArray(excludes) ? excludes : [excludes]) : [];

    const match = (text) => {
      if (!text) return false;
      const t = text.trim();
      if (!t) return false;
      const tl = t.toLowerCase();
      for (const ex of exs) {
        if (ex instanceof RegExp ? ex.test(t) : (tl === String(ex).toLowerCase() || tl.includes(String(ex).toLowerCase()))) return false;
      }
      for (const p of pats) {
        if (p instanceof RegExp ? p.test(t) : (tl === String(p).toLowerCase() || tl.includes(String(p).toLowerCase()))) return true;
      }
      return false;
    };

    for (const b of scope.querySelectorAll("button, [role='button']")) {
      if (inPanel(b)) continue;
      if (match(b.textContent || "")) return b;
    }
    for (const el of scope.querySelectorAll("span, div, a")) {
      if (inPanel(el)) continue;
      if (match(el.textContent || "")) {
        const btn = el.closest("button, [role='button'], a");
        if (btn && !inPanel(btn)) return btn;
      }
    }
    return null;
  }

  function isChannelReportButton(b) {
    if (!b) return false;
    if (b.getAttribute("data-a-target") === CHANNEL_BTN_TARGET) return true;
    const txt = (b.textContent || "").trim();
    if (!txt) return false;
    for (const p of REPORT_CHANNEL_PATTERNS) {
      if (p.test(txt)) return true;
    }
    return false;
  }

  function findFileReportButton() {
    const byText = findClickable(FILE_REPORT_PATTERNS, document, BLOCK_EXCLUDE_PATTERNS);
    if (byText && !isChannelReportButton(byText)) {
      return byText;
    }

    const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    for (const d of dialogs) {
      if (inPanel(d)) continue;
      const r = d.getBoundingClientRect();
      if (r.width < 300 || r.height < 100) continue;

      const btns = Array.from(d.querySelectorAll('button')).filter((b) => !inPanel(b));
      const good = btns.filter((b) => {
        const txt = (b.textContent || "").trim();
        if (!txt) return false;
        return !BLOCK_EXCLUDE_PATTERNS.some((ex) => ex.test(txt));
      });
      if (good.length === 0) continue;

      if (good.length === 1) {
        const only = good[0];
        const headingEl = d.querySelector('h1, h2, h3, [role="heading"]');
        const heading = (headingEl && headingEl.textContent) || "";
        if (/block|blockieren|bloquer|bloquear|blocca|blockera|engelle/i.test(heading)) {
          continue;
        }
        return only;
      }

      const byAt = good.find((b) => /report|submit|file|signal|denunc|inform|segnala|melden|bericht|жалоб|bildir|举报|通報|신고/i.test(b.getAttribute("data-a-target") || ""));
      if (byAt) return byAt;

      const byCls = good.find((b) => /primary/i.test(b.className || ""));
      if (byCls) return byCls;

      const last = good[good.length - 1];
      return last;
    }

    return null;
  }

  const CONTENT_TYPES = [
    { label: "Chat Messages", slug: "CHAT_REPORT" },
    { label: "Whispers",      slug: "WHISPER_REPORT" },
    { label: "Username",      slug: "USERNAME_REPORT" },
    { label: "User (Avatar, Channel Points, Panels, Tags, etc.)", slug: "USER_REPORT" },
    { label: "Off Twitch Behavior", slug: "OFF_TWITCH_REPORT" }
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
    "Off Twitch Behavior": { slug: "off_twitch_behavior", subs: [] },
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

  function clickRadioBySlug(name, slug, scope) {
    if (!slug) return false;
    const ids = [
      `${name}-${slug}`,
      `${name}-${slug.replace(/_/g, "-")}`,
      `${name}-${slug.replace(/-/g, "_")}`
    ];
    for (const id of ids) {
      const direct =
        scope.querySelector(`#${CSS.escape(id)}`) ||
        document.querySelector(`#${CSS.escape(id)}`);
      if (direct) {
        const label = direct.closest("label") ||
          scope.querySelector(`label[for="${CSS.escape(id)}"]`);
        (label || direct).click();
        return true;
      }
    }
    const inputs = scope.querySelectorAll(`input[name="${name}"]`);
    const lower = String(slug).toLowerCase().replace(/[-\s]+/g, "_");
    for (const inp of inputs) {
      const iid = (inp.id || "").toLowerCase();
      const ival = (inp.value || "").toLowerCase();
      if (iid.includes(lower) || ival === lower) {
        const label = inp.closest("label") ||
          scope.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
        (label || inp).click();
        return true;
      }
    }
    return false;
  }

  function clickRadioByLabelPrefix(name, prefix, scope) {
    const inputs = scope.querySelectorAll(`input[name="${name}"]`);
    const lower = String(prefix).toLowerCase();
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
    const lower = String(text).trim().toLowerCase();
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

  function clickRadioByAnyLabel(name, labels, scope) {
    if (!labels || !labels.length) return false;
    const sorted = labels.slice().sort((a, b) => b.length - a.length);
    for (const label of sorted) {
      if (clickRadioByLabelExact(name, label, scope)) return true;
    }
    for (const label of sorted) {
      if (clickRadioByLabelPrefix(name, label, scope)) return true;
    }
    return false;
  }

  async function pickRadio(name, slug, labelText) {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const el = await waitForInterruptible(
      () => wizard.querySelector(`input[name="${name}"]`), 5000);
    if (!el) throw new Error(`radio ${name} never appeared`);

    if (slug && clickRadioBySlug(name, slug, wizard)) return;
    if (labelText) {
      const labels = Array.isArray(labelText) ? labelText : [labelText];
      if (clickRadioByAnyLabel(name, labels, wizard)) return;
    }
    throw new Error(`radio ${name} not matched`);
  }

  async function clickNext() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const btn = await waitForInterruptible(
      () => wizard.querySelector('[data-a-target="form-navigation-next"]'), 3000);
    if (!btn) throw new Error("next button not found");
    btn.click();
  }

  async function fillDescription(text) {
    if (!text) return;
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const ta =
      wizard.querySelector('textarea[aria-label^="Tell us more"]') ||
      wizard.querySelector("textarea#report-wizard-description-form") ||
      wizard.querySelector("textarea");
    if (!ta) return;
    ta.focus();
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function checkVerify() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const cb = wizard.querySelector('input[data-a-target="tw-checkbox"]');
    if (!cb) return;
    if (!cb.checked) {
      const label = cb.closest("label") ||
        wizard.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
      (label || cb).click();
    }
  }

  async function fillEmail() {
    if (state.settings.reason === "Off Twitch Behavior") return;
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
    await recordEmail(
      value,
      state.targetChannel,
      state.settings.reason,
      state.settings.subreason,
      state.progress.lastUA
    );
  }

  async function submitReport() {
    const wizard = getWizard();
    if (!wizard) throw new Error("wizard not mounted");
    const btn = await waitForInterruptible(
      () => wizard.querySelector('[data-a-target="form-navigation-submit"]'), 3000);
    if (!btn) throw new Error("submit button not found");
    btn.click();
  }

  async function closeConfirmation() {
    const btn = await waitForInterruptible(() => qs(SEL.closeConfirm), 8000);
    if (!btn) return;
    btn.click();
  }

  function detectCaptcha() { return !!qs(SEL.captcha); }

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

  function pickDescriptionLine() {
    const variants = parseDescriptionLines(state.settings.descriptionText);
    if (variants.length === 0) return "";
    if (variants.length === 1) return variants[0];
    const used = new Set(state.progress.usedLines);
    let available = variants.filter((l) => !used.has(l));
    if (available.length === 0) {
      state.progress.usedLines = [];
      available = variants.slice();
    }
    const pick = available[Math.floor(Math.random() * available.length)];
    state.progress.usedLines.push(pick);
    persistSoon();
    return pick;
  }

  async function ensureBackOnChannel() {
    if (!state.targetChannel) return true;
    const cur = getCurrentChannel();
    if (cur === state.targetChannel) return true;
    await chrome.storage.local.set({ [K_RESUME]: true, [K_TARGET]: state.targetChannel });
    await persistNow();
    await sleepInterruptible(200);
    location.href = `https://www.twitch.tv/${state.targetChannel}`;
    return false;
  }

  async function rotateUA() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "ROTATE_UA" }, (resp) => {
          if (chrome.runtime.lastError) return resolve(null);
          if (resp && resp.ok && resp.ua) {
            state.progress.lastUA = resp.ua;
            persistSoon();
            return resolve(resp.ua);
          }
          resolve(null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  class StepTimeoutError extends Error {
    constructor(step, timeout) {
      super(`step "${step.name}" timeout after ${timeout}ms`);
      this.step = step;
    }
  }

  class ChallengeError extends Error {
    constructor(kind) {
      super(`challenge detected: ${kind}`);
      this.kind = kind;
    }
  }

  function subToSlug(subLabel) {
    if (!subLabel) return null;
    if (SUB_SLUG[subLabel]) return SUB_SLUG[subLabel];
    return String(subLabel).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  }

  function getReasonLabels(reasonName) {
    return REASON_LABELS_I18N[reasonName] || [reasonName];
  }
  function getSubLabels(subName) {
    return SUB_LABELS_I18N[subName] || [subName];
  }
  function getContentLabels(contentName) {
    return CONTENT_LABELS_I18N[contentName] || [contentName];
  }

  const STEPS = [
    {
      name: "open-menu",
      screen: "channel page (menu closed)",
      detect: () => qs(SEL.moreOptions),
      action: async () => {
        const btn = qs(SEL.moreOptions);
        if (!btn) throw new Error("more-options button not found");
        btn.click();
      }
    },
    {
      name: "click-report",
      screen: "channel menu (Report item)",
      detect: () => qs(SEL.reportChannel) || findClickable(REPORT_CHANNEL_PATTERNS, document, BLOCK_EXCLUDE_PATTERNS),
      action: async () => {
        const btn = qs(SEL.reportChannel) || findClickable(REPORT_CHANNEL_PATTERNS, document, BLOCK_EXCLUDE_PATTERNS);
        if (!btn) throw new Error("report channel button not found");
        btn.click();
      }
    },
    {
      name: "click-file-report",
      screen: "'File a Report' prompt",
      detect: () => findFileReportButton(),
      action: async () => {
        const btn = findFileReportButton();
        if (!btn) throw new Error("file-a-report button not found");
        btn.click();
      }
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
        const labels = getContentLabels(ct.label);
        await pickRadio("content-select-radio-group", ct.slug, labels);
        await clickNext();
      }
    },
    {
      name: "wizard-reason",
      screen: "wizard · step 2 (reason)",
      detect: () => {
        if (state.settings.reason === "Off Twitch Behavior") return "skipped";
        const w = getWizard();
        return w && w.querySelector('input[name="reason-select-radio-group"]');
      },
      action: async () => {
        const parentName = state.settings.reason;
        const r = REASONS[parentName];
        const wizard = getWizard();
        if (!r || !wizard) throw new Error("reason state invalid");

        const labels = getReasonLabels(parentName);

        if (r.slug && clickRadioBySlug("reason-select-radio-group", r.slug, wizard)) {
          state.usedSearchReason = false;
          await clickNext(); return;
        }
        if (clickRadioByAnyLabel("reason-select-radio-group", labels, wizard)) {
          state.usedSearchReason = false;
          await clickNext(); return;
        }

        if (!clickRadioBySlug("reason-select-radio-group", "searching-other", wizard) &&
            !clickRadioByAnyLabel("reason-select-radio-group",
              ["Search", "Rechercher", "Buscar", "Pesquisar", "Suchen", "Cerca", "Поиск", "Ara", "搜索", "検索", "検索", "검색"],
              wizard)) {
          throw new Error(`Search radio not found (reason="${parentName}")`);
        }
        state.usedSearchReason = true;
        await clickNext();
      }
    },
    {
      name: "wizard-search-pick",
      screen: "wizard · search results",
      detect: () => {
        if (state.settings.reason === "Off Twitch Behavior") return "skipped";
        if (!state.usedSearchReason) return "skipped";
        const w = getWizard();
        return w && w.querySelector('input[name="reason-search-radio-group"]');
      },
      action: async () => {
        const wizard = getWizard();
        if (!wizard) throw new Error("wizard not mounted");
        const sub = state.settings.subreason;
        const target = sub || state.settings.reason;
        if (!target) throw new Error("no search target");

        const slug = subToSlug(target);
        const labels = sub ? getSubLabels(sub) : getReasonLabels(state.settings.reason);

        const wantedRadio = () => {
          if (slug) {
            const candidates = [
              `#reason-search-radio-group-${CSS.escape(slug)}`,
              `#reason-search-radio-group-${CSS.escape(slug.replace(/_/g, "-"))}`,
              `#reason-search-radio-group-${CSS.escape(slug.replace(/-/g, "_"))}`
            ];
            for (const c of candidates) {
              const el = wizard.querySelector(c) || document.querySelector(c);
              if (el) return el;
            }
          }
          for (const inp of wizard.querySelectorAll('input[name="reason-search-radio-group"]')) {
            if (slug && (inp.id || "").toLowerCase().includes(slug)) return inp;
          }
          return null;
        };

        const appears = await waitForInterruptible(wantedRadio, 4000, 120);
        if (appears) {
          if (clickRadioBySlug("reason-search-radio-group", slug, wizard)) {
            await clickNext(); return;
          }
        }

        if (clickRadioByAnyLabel("reason-search-radio-group", labels, wizard)) {
          await clickNext(); return;
        }

        const all = wizard.querySelectorAll('input[name="reason-search-radio-group"]');
        if (all.length === 0) {
          throw new Error(`no search results rendered (target="${target}")`);
        }
        throw new Error(`search result not matched (slug="${slug}")`);
      }
    },
    {
      name: "wizard-detail",
      screen: "wizard · step 3 (detailed reason)",
      detect: () => {
        if (state.settings.reason === "Off Twitch Behavior") return "skipped";
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
        const slug = subToSlug(state.settings.subreason);
        const labels = getSubLabels(state.settings.subreason);
        await pickRadio("detailed-reason-select-radio", slug, labels);
        await clickNext();
      }
    },
    {
      name: "wizard-description",
      screen: "wizard · step 4 (description)",
      detect: () => {
        if (state.settings.reason === "Off Twitch Behavior") return "skipped";
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

    const challenge = detectChallenge();
    if (challenge) throw new ChallengeError(challenge);

    const detected = await waitForInterruptible(() => step.detect(), ctx.timeoutMs, 150);
    if (!state.running) return;
    if (detected === null) {
      throw new StepTimeoutError(step, ctx.timeoutMs);
    }
    if (detected === "skipped") return;

    const challenge2 = detectChallenge();
    if (challenge2) throw new ChallengeError(challenge2);

    const ok = await sleepInterruptible(ctx.delayMs);
    if (!ok) return;

    const challenge3 = detectChallenge();
    if (challenge3) throw new ChallengeError(challenge3);

    await step.action();
  }

  async function runStepWithRetries(step, ctx) {
    let attempt = 0;
    while (state.running) {
      try { await runStep(step, ctx); return; }
      catch (e) {
        if (e instanceof ChallengeError) throw e;
        if (!(e instanceof StepTimeoutError)) throw e;
        attempt++;
        if (attempt >= ctx.maxRetries) throw e;
        await sleepInterruptible(500);
      }
    }
  }

  async function scheduleResumeAndReload(failedStep) {
    await chrome.storage.local.set({
      [K_RESUME]: true,
      [K_TARGET]: state.targetChannel || getCurrentChannel()
    });
    await persistNow();
    setTimeout(() => location.reload(), 800);
  }

  async function runAll() {
    const ctx = {
      delayMs: rand(state.settings.delayMin, state.settings.delayMax),
      timeoutMs: state.settings.timeoutMs,
      maxRetries: state.settings.maxRetries
    };

    while (state.running) {
      if (state.settings.cycleLimit > 0 &&
          state.progress.cycleCount >= state.settings.cycleLimit) {
        setStatus("cycle limit reached — press 'reset cycles' or raise limit", "err");
        try {
          chrome.runtime.sendMessage({ type: "RESET_LANGUAGE_EN" }, () => {});
        } catch (e) {}
        return;
      }

      const ch = getCurrentChannel();
      if (ch) state.targetChannel = ch;
      await chrome.storage.local.set({ [K_TARGET]: state.targetChannel });

      state.progress.cycleCount++;
      persistSoon();
      updateProgressUI();

      await rotateUA();
      state.currentLine = pickDescriptionLine();
      state.usedSearchReason = false;
      state.challengeStrikes = 0;

      for (const step of STEPS) {
        if (!state.running) return;
        ctx.delayMs = rand(state.settings.delayMin, state.settings.delayMax);
        try { await runStepWithRetries(step, ctx); }
        catch (e) {
          if (e instanceof ChallengeError) {
            state.challengeStrikes++;
            if (state.challengeStrikes >= 2) {
              setStatus(`challenge detected twice — stopping`, "err");
              await scheduleResumeAndReload(step.name);
              return;
            }
            await humanPause(3000);
            await rotateUA();
            continue;
          }
          if (e instanceof StepTimeoutError && state.settings.reloadOnFail) {
            await scheduleResumeAndReload(step.name);
            return;
          }
          throw e;
        }
      }

      await sleepInterruptible(POST_CLOSE_SETTLE_MS);
      if (!state.running) return;
      const stillHere = await ensureBackOnChannel();
      if (!stillHere) return;
    }
  }

  async function startRun(autoResumed = false) {
    if (state.running) return;
    const cl = Number(state.settings.cycleLimit);
    if (!Number.isInteger(cl) || cl < 0 || cl > 999) { setStatus("error: cycles 0–999", "err"); return; }
    if (state.settings.timeoutMs < 500) { setStatus("error: timeout ≥ 500 ms", "err"); return; }
    if (state.settings.maxRetries < 1) { setStatus("error: retries ≥ 1", "err"); return; }

    const variants = parseDescriptionLines(state.settings.descriptionText || "");
    if (variants.length === 0) {
      setStatus("load a .reports file before starting", "err");
      return;
    }

    if (!autoResumed) {
      state.progress.cycleCount = 0;
      state.progress.usedLines = [];
      persistSoon();
      updateProgressUI();
    }

    state.running = true;
    updateUI();
    setStatus(autoResumed ? "resumed after reload…" : "running…");
    try {
      await runAll();
      if (state.running) setStatus("done.", "ok");
    } catch (e) {
      setStatus("error: " + e.message, "err");
    } finally {
      state.running = false;
      updateUI();
      persistSoon();
    }
  }

  function stopRun(reason = "user") {
    if (!state.running) return;
    state.running = false;
    setStatus("stopped by " + reason);
    updateUI();
  }

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
        <div class="tsr-row" id="tsr-reason-row">
          <label for="tsr-reason">reason (parent)</label>
          <select id="tsr-reason"></select>
        </div>
        <div class="tsr-row" id="tsr-subreason-row">
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
          <label for="tsr-reason-file">load .reports file</label>
          <input type="file" id="tsr-reason-file" accept=".reports" />
          <span id="tsr-reason-file-info" class="tsr-muted">no .reports file loaded</span>
        </div>
        <div class="tsr-buttons">
          <button class="tsr-btn tsr-btn-ghost" id="tsr-clear-file">clear file</button>
        </div>
        <div class="tsr-buttons">
          <button class="tsr-btn tsr-btn-primary" id="tsr-run">run</button>
          <button class="tsr-btn tsr-btn-secondary" id="tsr-stop" disabled>stop</button>
          <button class="tsr-btn tsr-btn-ghost" id="tsr-reset-cycles">reset cycles</button>
        </div>
        <div class="tsr-buttons">
          <button class="tsr-btn tsr-btn-ghost" id="tsr-dashboard">open dashboard</button>
        </div>
        <div class="tsr-progress" id="tsr-progress">cycle 0/10 — idle</div>
        <div class="tsr-status" id="tsr-status">idle</div>
      </div>
      <div class="tsr-resize-handle"></div>
    `;
    document.documentElement.appendChild(panel);

    const $ = (id) => panel.querySelector("#" + id);
    const contentSel  = $("tsr-content");
    const reasonSel   = $("tsr-reason");
    const reasonRow   = $("tsr-reason-row");
    const subRow      = $("tsr-subreason-row");
    const subSel      = $("tsr-subreason");
    const delayMinEl  = $("tsr-delay-min");
    const delayMaxEl  = $("tsr-delay-max");
    const timeoutEl   = $("tsr-timeout");
    const retriesEl   = $("tsr-retries");
    const cyclesEl    = $("tsr-cycles");
    const reasonFile  = $("tsr-reason-file");
    const reasonFileInfo = $("tsr-reason-file-info");
    const clearFileBtn = $("tsr-clear-file");
    const runBtn      = $("tsr-run");
    const stopBtn     = $("tsr-stop");
    const resetCycBtn = $("tsr-reset-cycles");
    const dashBtn     = $("tsr-dashboard");
    const collapseBtn = $("tsr-collapse");
    const resizeHandle = panel.querySelector(".tsr-resize-handle");

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

    function updateReasonFieldsVisibility() {
      const hide = reasonSel.value === "Off Twitch Behavior";
      reasonRow.style.display = hide ? "none" : "";
      subRow.style.display = hide ? "none" : "";
    }

    function refreshSubs() {
      subSel.innerHTML = "";
      const none = document.createElement("option");
      none.value = ""; none.textContent = "— none —";
      subSel.appendChild(none);
      const r = REASONS[reasonSel.value];
      if (!r) { updateReasonFieldsVisibility(); return; }
      for (const s of r.subs) {
        const o = document.createElement("option");
        o.value = s; o.textContent = s;
        subSel.appendChild(o);
      }
      const offTwitch = reasonSel.value === "Off Twitch Behavior";
      subSel.disabled = offTwitch || r.subs.length === 0;
      updateReasonFieldsVisibility();
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

    function refreshFileInfo() {
      const variants = parseDescriptionLines(state.settings.descriptionText || "");
      if (!state.settings._reasonFileName) {
        reasonFileInfo.textContent = variants.length
          ? `${variants.length} variant(s) loaded`
          : "no .reports file loaded";
      } else {
        reasonFileInfo.textContent = `${state.settings._reasonFileName} — ${variants.length} variant(s)`;
      }
    }
    refreshFileInfo();

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

    reasonFile.addEventListener("change", () => {
      const file = reasonFile.files && reasonFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        state.settings.descriptionText = text;
        state.settings._reasonFileName = file.name;
        persistSoon();
        refreshFileInfo();
        updateProgressUI();
      };
      reader.onerror = () => {};
      reader.readAsText(file);
    });

    clearFileBtn.addEventListener("click", () => {
      state.settings.descriptionText = "";
      state.settings._reasonFileName = null;
      reasonFile.value = "";
      persistSoon();
      refreshFileInfo();
      updateProgressUI();
    });

    collapseBtn.addEventListener("click", () => {
      panel.classList.toggle("tsr-collapsed");
      collapseBtn.textContent = panel.classList.contains("tsr-collapsed") ? "▸" : "▾";
    });

    runBtn.addEventListener("click", () => { startRun(false); });
    stopBtn.addEventListener("click", () => stopRun("user"));

    resetCycBtn.addEventListener("click", async () => {
      state.progress.cycleCount = 0;
      state.progress.usedLines = [];
      await persistNow();
      updateProgressUI();
      setStatus("cycle counter reset", "ok");
    });

    dashBtn.addEventListener("click", () => {
      try {
        chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }, (resp) => {
          if (chrome.runtime.lastError) {
            const m = chrome.runtime.lastError.message || "send failed";
            setStatus("dashboard error: " + m, "err");
            return;
          }
          if (resp && resp.ok) {
            const where = resp.tabId
              ? ("tab " + resp.tabId)
              : (resp.windowId ? ("window " + resp.windowId) : "tab");
            setStatus("dashboard opened (" + where + ")", "ok");
            return;
          }
          const errMsg = resp && resp.error ? resp.error : "unknown";
          setStatus("dashboard error: " + errMsg, "err");

          if (resp && resp.url) {
            try { window.open(resp.url, "_blank"); } catch {}
          }
        });
      } catch (e) {
        setStatus("dashboard error: " + e.message, "err");
      }
    });

    makeDraggable(panel, panel.querySelector("#tsr-header"));
    makeResizable(panel, resizeHandle);
    restorePosition(panel);

    panel._refs = { runBtn, stopBtn };
    updateUI();
    updateProgressUI();
  }

  function setStatus(msg, kind = "") {
    const el = document.getElementById("tsr-status");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("tsr-ok", "tsr-err");
    if (kind) el.classList.add(kind);
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
      chrome.storage.local.set({ [K_POS]: {
        left: r.left, top: r.top, width: r.width, height: r.height
      }});
    });
  }

  function makeResizable(panel, handle) {
    if (!handle) return;
    let resizing = false;
    let startW = 0, startH = 0, startX = 0, startY = 0;
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      resizing = true;
      startW = panel.offsetWidth;
      startH = panel.offsetHeight;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      panel.style.width  = Math.max(280, startW + e.clientX - startX) + "px";
      panel.style.height = Math.max(220, startH + e.clientY - startY) + "px";
    });
    document.addEventListener("mouseup", () => {
      if (!resizing) return;
      resizing = false;
      const r = panel.getBoundingClientRect();
      chrome.storage.local.set({ [K_POS]: {
        left: r.left, top: r.top, width: r.width, height: r.height
      }});
    });
  }

  async function restorePosition(panel) {
    try {
      const data = await chrome.storage.local.get(K_POS);
      const p = data[K_POS];
      if (p && typeof p.left === "number") {
        panel.style.left = p.left + "px";
        panel.style.top  = p.top + "px";
        if (typeof p.width === "number")  panel.style.width  = p.width + "px";
        if (typeof p.height === "number") panel.style.height = p.height + "px";
      }
    } catch (e) {}
  }

  const observer = new MutationObserver(() => {
    if (!document.getElementById(PANEL_ID)) buildPanel();
  });

  async function init() {
    await loadAll();

    const stale = document.getElementById(PANEL_ID);
    if (stale) stale.remove();

    buildPanel();
    observer.observe(document.documentElement, { childList: true, subtree: true });

    let autoResume = false;
    let savedTarget = null;
    try {
      const r = await chrome.storage.local.get([K_RESUME, K_TARGET]);
      autoResume = r[K_RESUME] === true;
      savedTarget = r[K_TARGET] || null;
      if (autoResume) await chrome.storage.local.set({ [K_RESUME]: false });
    } catch (e) {}

    if (!autoResume) return;

    const cur = getCurrentChannel();
    if (savedTarget && cur !== savedTarget) {
      await chrome.storage.local.set({ [K_RESUME]: true, [K_TARGET]: savedTarget });
      location.href = `https://www.twitch.tv/${savedTarget}`;
      return;
    }

    state.targetChannel = savedTarget || cur;
    setTimeout(() => startRun(true), RESUME_SETTLE_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();