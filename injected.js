// content/injected.js — MAIN world, document_start
(() => {
  "use strict";

  const LS_KEY = "__tsr_profile_v1";
  const CFG    = { profile: null };
  let uaDataCache = new WeakMap();

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
    } catch {
      CFG.profile = null;
    }
    uaDataCache = new WeakMap();
  });

  (function patchNavigator() {
    if (typeof Navigator === "undefined" || !Navigator.prototype) return;
    const NavProto = Navigator.prototype;

    function redefine(name, wrap) {
      const desc = Object.getOwnPropertyDescriptor(NavProto, name);
      if (!desc || typeof desc.get !== "function") return;
      const orig = desc.get;
      try {
        Object.defineProperty(NavProto, name, {
          configurable: true,
          enumerable: desc.enumerable,
          get: wrap(orig)
        });
      } catch { /* non-configurable */ }
    }

    redefine("userAgent",  (orig) => function () {
      return CFG.profile ? CFG.profile.ua : orig.call(this);
    });
    redefine("appVersion", (orig) => function () {
      return CFG.profile ? CFG.profile.appVersion : orig.call(this);
    });
    redefine("platform",   (orig) => function () {
      return CFG.profile ? CFG.profile.platformName : orig.call(this);
    });
    redefine("vendor",     (orig) => function () {
      return CFG.profile ? CFG.profile.vendor : orig.call(this);
    });
    redefine("language",   (orig) => function () {
      const langs = CFG.profile && CFG.profile.languages;
      return langs && langs.length ? langs[0] : orig.call(this);
    });
    redefine("languages",  (orig) => function () {
      const langs = CFG.profile && CFG.profile.languages;
      return langs && langs.length ? Object.freeze(langs.slice()) : orig.call(this);
    });

    const uaDesc = Object.getOwnPropertyDescriptor(NavProto, "userAgentData");
    if (uaDesc && typeof uaDesc.get === "function") {
      const origGet = uaDesc.get;
      try {
        Object.defineProperty(NavProto, "userAgentData", {
          configurable: true,
          enumerable: true,
          get: function () {
            if (!CFG.profile) return origGet.call(this);
            if (CFG.profile.browser !== "chrome") return undefined;
            let cached = uaDataCache.get(CFG.profile);
            if (!cached) {
              cached = new FakeNavigatorUAData(CFG.profile);
              uaDataCache.set(CFG.profile, cached);
            }
            return cached;
          }
        });
      } catch { /* ignore */ }
    }

    class FakeNavigatorUAData {
      constructor(profile) {
        const brands = (profile.uaBrands || []).map(b =>
          Object.freeze({ brand: b.brand, version: String(b.version) })
        );
        this.brands   = Object.freeze(brands);
        this.mobile   = !!profile.mobile;
        this.platform = profile.platform;
        this._p       = profile;
      }
      get [Symbol.toStringTag]() { return "NavigatorUAData"; }
      async getHighEntropyValues(hints) {
        const p = this._p;
        const want = new Set(Array.isArray(hints) ? hints : []);
        const out = { brands: this.brands, mobile: this.mobile, platform: this.platform };
        if (want.has("architecture"))    out.architecture    = "x86";
        if (want.has("bitness"))         out.bitness         = "64";
        if (want.has("formFactors"))     out.formFactors     = ["Desktop"];
        if (want.has("model"))           out.model           = "";
        if (want.has("platformVersion")) out.platformVersion = p.platformVersion || "10.0.0";
        if (want.has("uaFullVersion"))   out.uaFullVersion   = p.version;
        if (want.has("wow64"))           out.wow64           = false;
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
  })();

  const RTC = window.RTCPeerConnection;
  if (typeof RTC === "function") {
    const Patched = function (config, ...rest) {
      const cfg = config ? { ...config } : {};
      cfg.iceTransportPolicy = "relay";
      return new RTC(cfg, ...rest);
    };
    Object.defineProperty(Patched, "name", { value: "RTCPeerConnection" });
    Patched.prototype = RTC.prototype;
    Object.setPrototypeOf(Patched, RTC);
    try { window.RTCPeerConnection = Patched; } catch { /* ignore */ }
  }

  let sessionSalt = 0;
  try {
    const s = localStorage.getItem("__tsr_salt_v1");
    if (s) sessionSalt = parseInt(s, 10) | 0;
    if (!sessionSalt) {
      sessionSalt = (Math.random() * 0x7fffffff) | 0;
      localStorage.setItem("__tsr_salt_v1", String(sessionSalt));
    }
  } catch { sessionSalt = (Math.random() * 0x7fffffff) | 0; }

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
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return serializer(canvas);
    let img;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch { return serializer(canvas); }
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
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    try { return serializeNoisy(this, (c) => origToDataURL.apply(c, args)); }
    catch { return origToDataURL.apply(this, args); }
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  if (typeof origToBlob === "function") {
    HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
      try {
        return serializeNoisy(this, (c) => origToBlob.apply(c, [cb, ...rest]));
      } catch { return origToBlob.apply(this, [cb, ...rest]); }
    };
  }

  const SPOOF_BY_PLATFORM = {
    Windows: {
      vendor:   "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"
    },
    macOS: {
      vendor:   "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"
    },
    Linux: {
      vendor:   "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)"
    }
  };

  const P_VENDOR   = 0x9245;
  const P_RENDERER = 0x9246;

  function spoofValue(which) {
    if (!CFG.profile) return null;
    if (CFG.profile.browser !== "chrome") return null;
    const s = SPOOF_BY_PLATFORM[CFG.profile.platform] || SPOOF_BY_PLATFORM.Windows;
    return which === "vendor" ? s.vendor : s.renderer;
  }

  function patchWebGL(proto) {
    if (!proto || !proto.getParameter) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === P_VENDOR) {
        const v = spoofValue("vendor");
        if (v !== null) return v;
      } else if (p === P_RENDERER) {
        const v = spoofValue("renderer");
        if (v !== null) return v;
      }
      return orig.apply(this, arguments);
    };
  }

  if (typeof WebGLRenderingContext !== "undefined")
    patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined")
    patchWebGL(WebGL2RenderingContext.prototype);
})();