// content/injected.js — MAIN world, document_start
// Патчи применяются последовательно во всех фреймах (all_frames: true).
(() => {
  "use strict";

  const LS_KEY = "__tsr_profile_v1";
  const CFG = { profile: null };
  let uaDataCache = new WeakMap();

  // ---------- загрузка профиля ----------
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) CFG.profile = JSON.parse(raw);
  } catch { /* ignore */ }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__tsr !== 1) return;
    if (d.type === "CONFIG") {
      CFG.profile = d.profile || null;
      uaDataCache = new WeakMap();
    }
  }, true);

  window.addEventListener("storage", (e) => {
    if (e.key !== LS_KEY) return;
    try {
      CFG.profile = e.newValue ? JSON.parse(e.newValue) : null;
    } catch { CFG.profile = null; }
    uaDataCache = new WeakMap();
  });

  // ---------- tamper detection scaffolding ----------
  const _toString = Function.prototype.toString;
  const nativeLike = new WeakMap();

  function markNative(fn, original) {
    nativeLike.set(fn, original);
    return fn;
  }

  // Устанавливает name/length как у нативной функции + регистрирует в nativeLike,
  // чтобы Function.prototype.toString.call(patched) возвращал исходный код.
  function mimic(patched, nativeFn, name, length) {
    try {
      Object.defineProperty(patched, "name",   { value: name,   configurable: true });
      Object.defineProperty(patched, "length", { value: length, configurable: true });
    } catch { /* ignore */ }
    const realNative = nativeLike.get(nativeFn) || nativeFn;
    return markNative(patched, realNative);
  }

  {
    const patchedToString = function () {
      const orig = nativeLike.get(this);
      return orig ? _toString.call(orig) : _toString.call(this);
    };
    try {
      Object.defineProperty(patchedToString, "name",   { value: "toString", configurable: true });
      Object.defineProperty(patchedToString, "length", { value: 0,          configurable: true });
    } catch { /* ignore */ }
    markNative(patchedToString, _toString);
    Function.prototype.toString = patchedToString;
  }

  function safeDefine(obj, prop, descriptor) {
    try { Reflect.defineProperty(obj, prop, descriptor); }
    catch { /* non-configurable */ }
  }

  // ---------- Navigator ----------
  (function patchNavigator() {
    if (typeof Navigator === "undefined" || !Navigator.prototype) return;
    const NavProto = Navigator.prototype;

    function redefine(name, wrap) {
      const desc = Object.getOwnPropertyDescriptor(NavProto, name);
      if (!desc || typeof desc.get !== "function") return;
      const orig = desc.get;
      const patched = wrap(orig);
      mimic(patched, orig, "get " + name, 0);
      safeDefine(NavProto, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: patched
      });
    }

    redefine("userAgent", (orig) => function () {
      return CFG.profile ? CFG.profile.ua : orig.call(this);
    });
    redefine("appVersion", (orig) => function () {
      return CFG.profile ? CFG.profile.appVersion : orig.call(this);
    });
    redefine("platform", (orig) => function () {
      return CFG.profile ? CFG.profile.platformName : orig.call(this);
    });
    redefine("vendor", (orig) => function () {
      return CFG.profile ? CFG.profile.vendor : orig.call(this);
    });
    redefine("language", (orig) => function () {
      const langs = CFG.profile && CFG.profile.languages;
      return langs && langs.length ? langs[0] : orig.call(this);
    });
    redefine("languages", (orig) => function () {
      const langs = CFG.profile && CFG.profile.languages;
      return langs && langs.length ? Object.freeze(langs.slice()) : orig.call(this);
    });
    redefine("hardwareConcurrency", (orig) => function () {
      return CFG.profile && CFG.profile.hardwareConcurrency
        ? CFG.profile.hardwareConcurrency
        : orig.call(this);
    });
    redefine("deviceMemory", (orig) => function () {
      return CFG.profile && CFG.profile.deviceMemory
        ? CFG.profile.deviceMemory
        : orig.call(this);
    });

    // userAgentData
    const uaDesc = Object.getOwnPropertyDescriptor(NavProto, "userAgentData");
    if (uaDesc && typeof uaDesc.get === "function") {
      const origGet = uaDesc.get;
      const patched = mimic(function () {
        if (!CFG.profile) return origGet.call(this);
        if (CFG.profile.browser !== "chrome") return undefined;
        let cached = uaDataCache.get(CFG.profile);
        if (!cached) {
          cached = new FakeNavigatorUAData(CFG.profile);
          uaDataCache.set(CFG.profile, cached);
        }
        return cached;
      }, origGet, "get userAgentData", 0);
      safeDefine(NavProto, "userAgentData", {
        configurable: true,
        enumerable: true,
        get: patched
      });
    }

    const uaProfiles = new WeakMap();

    class FakeNavigatorUAData {
      constructor(profile) {
        uaProfiles.set(this, profile);
      }
      get [Symbol.toStringTag]() { return "NavigatorUAData"; }
      get brands() {
        const p = uaProfiles.get(this);
        const brands = ((p && p.uaBrands) || []).map(b =>
          Object.freeze({ brand: b.brand, version: String(b.version) })
        );
        return Object.freeze(brands);
      }
      get mobile() {
        const p = uaProfiles.get(this);
        return !!(p && p.mobile);
      }
      get platform() {
        const p = uaProfiles.get(this);
        return p ? p.platform : "";
      }
      async getHighEntropyValues(hints) {
        const p = uaProfiles.get(this) || {};
        const want = new Set(Array.isArray(hints) ? hints : []);
        const out = {
          brands: this.brands,
          mobile: this.mobile,
          platform: this.platform
        };
        if (want.has("architecture")) out.architecture = "x86";
        if (want.has("bitness")) out.bitness = "64";
        if (want.has("formFactors")) out.formFactors = ["Desktop"];
        if (want.has("model")) out.model = "";
        if (want.has("platformVersion")) out.platformVersion = p.platformVersion || "10.0.0";
        if (want.has("uaFullVersion")) out.uaFullVersion = p.version;
        if (want.has("wow64")) out.wow64 = false;
        if (want.has("fullVersionList")) {
          out.fullVersionList = Object.freeze(
            (p.fullVersionList || []).map(b =>
              Object.freeze({ brand: b.brand, version: String(b.version) })
            )
          );
        }
        return out;
      }
      toJSON() {
        return { brands: this.brands, mobile: this.mobile, platform: this.platform };
      }
    }

    try {
      Object.defineProperty(FakeNavigatorUAData, "name", {
        value: "NavigatorUAData", configurable: true
      });
    } catch { /* ignore */ }

    for (const k of ["getHighEntropyValues", "toJSON"]) {
      const fn = FakeNavigatorUAData.prototype[k];
      if (typeof fn === "function") {
        try { Object.defineProperty(fn, "name", { value: k, configurable: true }); } catch {}
        try { Object.defineProperty(fn, "length", { value: k === "toJSON" ? 0 : 1, configurable: true }); } catch {}
      }
    }
  })();

  // ---------- WebRTC ----------
  // ИСПРАВЛЕНИЕ: iceTransportPolicy = "relay" теперь применяется только при
  // активном профиле. Раньше relay форсился безусловно — это ломало
  // ICE-негоциацию на нормальном Twitch и могло приводить к выбору другого
  // edge/CDN, а от него зависит региональный контент и язык.
  (function patchRTC() {
    const RTC = window.RTCPeerConnection;
    if (typeof RTC !== "function") return;

    const Patched = function (...args) {
      if (!CFG.profile) return new RTC(...args);
      const config = args[0];
      const cfg = config ? { ...config } : {};
      cfg.iceTransportPolicy = "relay";
      return new RTC(cfg, ...args.slice(1));
    };
    mimic(Patched, RTC, "RTCPeerConnection", 0);
    Patched.prototype = RTC.prototype;

    try {
      Object.defineProperty(RTC.prototype, "constructor", {
        value: Patched, configurable: true, writable: true
      });
    } catch { /* ignore */ }

    try { window.RTCPeerConnection = Patched; } catch { /* ignore */ }
  })();

  // ---------- Canvas noise ----------
  let sessionSalt = 0;
  try {
    const s = localStorage.getItem("__tsr_salt_v1");
    if (s) sessionSalt = parseInt(s, 10) | 0;
    if (!sessionSalt) {
      sessionSalt = (Math.random() * 0x7fffffff) | 0;
      localStorage.setItem("__tsr_salt_v1", String(sessionSalt));
    }
  } catch {
    sessionSalt = (Math.random() * 0x7fffffff) | 0;
  }

  function hash32(str) {
    let h = 0x811c9dc5 ^ sessionSalt;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function addDetNoise(data, seed) {
    let s = (seed || 1) >>> 0;
    const step = 4 * 500;
    for (let i = 0; i < data.length; i += step) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const bit = (s & 1) ? 1 : -1;
      data[i] = (data[i] + bit) & 0xff;
    }
  }

  function serializeNoisy(canvas, serializer) {
    // ИСПРАВЛЕНИЕ: шум добавляем только при активном профиле. Раньше
    // toDataURL/toBlob портили пиксели безусловно, что задевало и нормальный
    // Twitch (рендер превью, оффскрин-пайплайны) и могло приводить к
    // fallback-поведению, включая серверный выбор локали.
    if (!CFG.profile) return serializer(canvas);
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return serializer(canvas);
    let img;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return serializer(canvas);
    }
    addDetNoise(img.data, hash32(canvas.width + "x" + canvas.height));
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const offCtx = off.getContext("2d");
    if (!offCtx) return serializer(canvas);
    offCtx.putImageData(img, 0, 0);
    return serializer(off);
  }

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  if (typeof origToDataURL === "function") {
    HTMLCanvasElement.prototype.toDataURL = mimic(function (...args) {
      try { return serializeNoisy(this, (c) => origToDataURL.apply(c, args)); }
      catch { return origToDataURL.apply(this, args); }
    }, origToDataURL, "toDataURL", 0);
  }

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  if (typeof origToBlob === "function") {
    HTMLCanvasElement.prototype.toBlob = mimic(function (cb, ...rest) {
      try { return serializeNoisy(this, (c) => origToBlob.apply(c, [cb, ...rest])); }
      catch { return origToBlob.apply(this, [cb, ...rest]); }
    }, origToBlob, "toBlob", 1);
  }

  // ---------- WebGL ----------
  const SPOOF_BY_PLATFORM = {
    Windows: {
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"
    },
    macOS: {
      vendor: "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"
    },
    Linux: {
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)"
    }
  };
  const P_VENDOR = 0x9245;
  const P_RENDERER = 0x9246;

  function spoofValue(which) {
    if (!CFG.profile) return null;
    if (CFG.profile.browser !== "chrome") return null;
    const s = SPOOF_BY_PLATFORM[CFG.profile.platform] || SPOOF_BY_PLATFORM.Windows;
    return which === "vendor" ? s.vendor : s.renderer;
  }

  function patchWebGL(proto) {
    if (!proto || !proto.getParameter) return;
    if (nativeLike.has(proto.getParameter)) return;
    const orig = proto.getParameter;
    proto.getParameter = mimic(function (p) {
      if (p === P_VENDOR) {
        const v = spoofValue("vendor");
        if (v !== null) return v;
      } else if (p === P_RENDERER) {
        const v = spoofValue("renderer");
        if (v !== null) return v;
      }
      return orig.apply(this, arguments);
    }, orig, "getParameter", 1);
  }
  if (typeof WebGLRenderingContext !== "undefined") patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") patchWebGL(WebGL2RenderingContext.prototype);

  // ---------- WebGPU ----------
  (function patchWebGPU() {
    if (typeof GPUAdapterInfo === "undefined" || !GPUAdapterInfo.prototype) return;

    const FAKE = {
      Windows: { vendor: "nvidia", architecture: "gen-3",    device: "NVIDIA GeForce RTX 3060", description: "" },
      macOS:   { vendor: "apple",  architecture: "apple-m2", device: "Apple M2",                description: "" },
      Linux:   { vendor: "intel",  architecture: "gen-3",    device: "Intel UHD Graphics 620",  description: "" }
    };

    function fakeFor(name) {
      if (!CFG.profile || CFG.profile.browser !== "chrome") return undefined;
      const s = FAKE[CFG.profile.platform] || FAKE.Windows;
      return s[name];
    }

    for (const name of ["vendor", "architecture", "device", "description"]) {
      const desc = Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype, name);
      if (!desc || typeof desc.get !== "function") continue;
      const orig = desc.get;
      const patched = mimic(function () {
        const fake = fakeFor(name);
        return fake !== undefined ? fake : orig.call(this);
      }, orig, "get " + name, 0);
      safeDefine(GPUAdapterInfo.prototype, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: patched
      });
    }
  })();

  // ---------- AudioContext ----------
  (function patchAudio() {
    if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") return;

    function noiseForAudio(data, seed) {
      let s = (seed || 1) >>> 0;
      for (let i = 0; i < data.length; i += 100) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const bit = (s & 1) ? 1e-7 : -1e-7;
        data[i] += bit;
      }
    }

    function audioSeedFor(x) {
      try {
        const sr = x.sampleRate || (x.context && x.context.sampleRate) || 0;
        const len = x.length || x.frequencyBinCount || 0;
        const nc = x.numberOfChannels || 0;
        return hash32("a" + sr + "|" + len + "|" + nc);
      } catch { return 1; }
    }

    if (typeof AudioBuffer !== "undefined") {
      const origGetChannelData = AudioBuffer.prototype.getChannelData;
      if (typeof origGetChannelData === "function") {
        AudioBuffer.prototype.getChannelData = mimic(function (channel) {
          const data = origGetChannelData.call(this, channel);
          if (!CFG.profile) return data;
          noiseForAudio(data, audioSeedFor(this));
          return data;
        }, origGetChannelData, "getChannelData", 1);
      }

      const origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
      if (typeof origCopyFromChannel === "function") {
        AudioBuffer.prototype.copyFromChannel = mimic(function (destination, channelNumber, bufferOffset = 0) {
          const result = origCopyFromChannel.call(this, destination, channelNumber, bufferOffset);
          if (!CFG.profile) return result;
          noiseForAudio(destination, audioSeedFor(this));
          return result;
        }, origCopyFromChannel, "copyFromChannel", 2);
      }
    }

    if (typeof AnalyserNode !== "undefined") {
      const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      if (typeof origGetFloat === "function") {
        AnalyserNode.prototype.getFloatFrequencyData = mimic(function (array) {
          const result = origGetFloat.call(this, array);
          if (!CFG.profile) return result;
          noiseForAudio(array, audioSeedFor(this));
          return result;
        }, origGetFloat, "getFloatFrequencyData", 1);
      }

      const origGetByte = AnalyserNode.prototype.getByteFrequencyData;
      if (typeof origGetByte === "function") {
        AnalyserNode.prototype.getByteFrequencyData = mimic(function (array) {
          const result = origGetByte.call(this, array);
          if (!CFG.profile) return result;
          let s = audioSeedFor(this);
          for (let i = 0; i < array.length; i += 50) {
            s = (Math.imul(s, 1103515245) + 12345) >>> 0;
            array[i] = (array[i] + ((s & 1) ? 1 : -1)) & 0xff;
          }
          return result;
        }, origGetByte, "getByteFrequencyData", 1);
      }
    }
  })();

  // ---------- Шрифты (font enumeration) ----------
  (function patchFonts() {
    if (typeof FontFaceSet !== "undefined" && FontFaceSet.prototype &&
        typeof FontFaceSet.prototype.check === "function") {
      const origCheck = FontFaceSet.prototype.check;
      const STD = /(\bserif\b|\bsans-serif\b|\bmonospace\b|\bcursive\b|\bfantasy\b|\bsystem-ui\b|-apple-system|\bBlinkMacSystemFont\b|\bSegoe UI\b|\bRoboto\b|\bHelvetica\b|\bArial\b)/i;
      try {
        FontFaceSet.prototype.check = mimic(function (font, text = " ") {
          if (CFG.profile && STD.test(font)) return true;
          return origCheck.call(this, font, text);
        }, origCheck, "check", 1);
      } catch { /* ignore */ }
    }

    const origMeasure = CanvasRenderingContext2D.prototype.measureText;
    if (typeof origMeasure === "function") {
      CanvasRenderingContext2D.prototype.measureText = mimic(function (text) {
        const m = origMeasure.call(this, text);
        if (!CFG.profile) return m;
        const seed = hash32(text + this.font);
        const delta = ((seed % 100) - 50) / 10000;
        for (const prop of ["width", "actualBoundingBoxAscent", "actualBoundingBoxDescent",
                            "fontBoundingBoxAscent", "fontBoundingBoxDescent"]) {
          try {
            const v = m[prop];
            if (typeof v === "number") {
              Object.defineProperty(m, prop, { value: v + delta, configurable: true });
            }
          } catch { /* read-only */ }
        }
        return m;
      }, origMeasure, "measureText", 1);
    }
  })();

  // ---------- Workers ----------
  function buildWorkerSource(profile, salt) {
    const pJson = JSON.stringify(profile);
    return `(function(){
  "use strict";
  var __P__ = ${pJson};
  if (!__P__) return;
  var SALT = ${salt | 0};
  function hash32(str) {
    var h = 0x811c9dc5 ^ SALT;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  try {
    var NavProto = Object.getPrototypeOf(self.navigator);
    var _ts = Function.prototype.toString;
    var _nat = new WeakMap();
    function markNat(fn, orig) { _nat.set(fn, orig); return fn; }
    function mimic(fn, orig, name, length) {
      try {
        Object.defineProperty(fn, "name",   { value: name,   configurable: true });
        Object.defineProperty(fn, "length", { value: length, configurable: true });
      } catch (e) {}
      return markNat(fn, orig);
    }
    var patchedToString = function () {
      var o = _nat.get(this);
      return o ? _ts.call(o) : _ts.call(this);
    };
    mimic(patchedToString, _ts, "toString", 0);
    Function.prototype.toString = patchedToString;
    function redefine(name, value) {
      if (value === undefined) return;
      var d = Object.getOwnPropertyDescriptor(NavProto, name);
      if (!d || typeof d.get !== "function") return;
      var orig = d.get;
      var fn = mimic(function () { return value; }, orig, "get " + name, 0);
      try {
        Reflect.defineProperty(NavProto, name, {
          configurable: true, enumerable: d.enumerable, get: fn
        });
      } catch (e) {}
    }
    redefine("userAgent", __P__.ua);
    redefine("appVersion", __P__.appVersion);
    redefine("platform", __P__.platformName);
    if (__P__.languages && __P__.languages.length) {
      redefine("language", __P__.languages[0]);
      redefine("languages", Object.freeze(__P__.languages.slice()));
    }
    redefine("hardwareConcurrency", __P__.hardwareConcurrency);
    redefine("deviceMemory", __P__.deviceMemory);
  } catch (e) {}
  if (typeof AudioBuffer !== "undefined") {
    var _g = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (ch) {
      var d = _g.call(this, ch);
      var s = hash32("ch" + ch + "|" + this.sampleRate + "|" + this.length);
      for (var i = 0; i < d.length; i += 100) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        d[i] += (s & 1) ? 1e-7 : -1e-7;
      }
      return d;
    };
  }
})();`;
  }

  (function patchWorkers() {
    if (typeof Worker === "undefined") return;
    const OrigWorker = Worker;

    function PatchedWorker(url, options = undefined) {
      try {
        const isModule = options && options.type === "module";
        let resolved = url;
        try {
          if (typeof url === "string") {
            resolved = new URL(url, location.href).href;
          }
        } catch { /* keep url */ }
        if (
          !isModule &&
          CFG.profile &&
          typeof resolved === "string" &&
          resolved.startsWith(location.origin + "/") &&
          !resolved.startsWith("blob:")
        ) {
          const source = buildWorkerSource(CFG.profile, sessionSalt);
          const blob = new Blob([source + "\nimportScripts(" + JSON.stringify(resolved) + ");"], {
            type: "application/javascript"
          });
          const blobUrl = URL.createObjectURL(blob);
          return new OrigWorker(blobUrl, options);
        }
      } catch { /* fall through */ }
      return new OrigWorker(url, options);
    }

    mimic(PatchedWorker, OrigWorker, "Worker", 1);
    PatchedWorker.prototype = OrigWorker.prototype;

    try {
      Object.defineProperty(OrigWorker.prototype, "constructor", {
        value: PatchedWorker, configurable: true, writable: true
      });
    } catch { /* ignore */ }

    try { window.Worker = PatchedWorker; } catch { /* ignore */ }
  })();

})();