(() => {
  "use strict";

  const LS_KEY = "__tsr_profile_v1";
  const CFG = { profile: null };
  let uaDataCache = new WeakMap();

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) CFG.profile = JSON.parse(raw);
  } catch {}

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

  const _toString = Function.prototype.toString;
  const nativeLike = new WeakMap();

  function markNative(fn, original) {
    nativeLike.set(fn, original);
    return fn;
  }

  function mimic(patched, nativeFn, name, length) {
    try {
      Object.defineProperty(patched, "name", { value: name, configurable: true });
      Object.defineProperty(patched, "length", { value: length, configurable: true });
    } catch {}
    const realNative = nativeLike.get(nativeFn) || nativeFn;
    return markNative(patched, realNative);
  }

  {
    const patchedToString = function () {
      const orig = nativeLike.get(this);
      return orig ? _toString.call(orig) : _toString.call(this);
    };
    try {
      Object.defineProperty(patchedToString, "name", { value: "toString", configurable: true });
      Object.defineProperty(patchedToString, "length", { value: 0, configurable: true });
    } catch {}
    markNative(patchedToString, _toString);
    Function.prototype.toString = patchedToString;
  }

  function safeDefine(obj, prop, descriptor) {
    try { Reflect.defineProperty(obj, prop, descriptor); }
    catch {}
  }

  function profileSalt() {
    return CFG.profile && typeof CFG.profile.salt === "number" ? CFG.profile.salt : 0;
  }

  function getOrigin() {
    try { return location.origin || ""; } catch { return ""; }
  }

  function hash32(str) {
    let h = (0x811c9dc5 ^ profileSalt()) | 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

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
    redefine("maxTouchPoints", (orig) => function () {
      return CFG.profile ? 0 : orig.call(this);
    });

    (function patchConnection() {
      const desc = Object.getOwnPropertyDescriptor(NavProto, "connection");
      if (!desc) return;

      const NativeNC = window.NetworkInformation;
      let cachedConn = null;

      function getFakeConnection() {
        if (cachedConn) return cachedConn;
        let obj;
        if (NativeNC && NativeNC.prototype) {
          try { obj = Object.create(NativeNC.prototype); } catch { obj = {}; }
        } else {
          obj = {};
        }
        safeDefine(obj, "effectiveType", { value: "4g",    configurable: true, enumerable: true });
        safeDefine(obj, "rtt",           { value: 50,      configurable: true, enumerable: true });
        safeDefine(obj, "downlink",      { value: 10,      configurable: true, enumerable: true });
        safeDefine(obj, "saveData",      { value: false,   configurable: true, enumerable: true });
        safeDefine(obj, "type",          { value: "wifi",  configurable: true, enumerable: true });
        safeDefine(obj, "onchange",      { value: null,    configurable: true, writable: true, enumerable: true });
        cachedConn = obj;
        return cachedConn;
      }

      redefine("connection", (origFn) => function () {
        if (!CFG.profile) return origFn.call(this);
        const b = CFG.profile.browser;
        if (b === "firefox" || b === "safari") return undefined;
        return getFakeConnection();
      });
    })();

    const uaDesc = Object.getOwnPropertyDescriptor(NavProto, "userAgentData");
    if (uaDesc && typeof uaDesc.get === "function") {
      const origGet = uaDesc.get;
      const patched = mimic(function () {
        if (!CFG.profile) return origGet.call(this);
        if (CFG.profile.browser !== "chrome" &&
            CFG.profile.browser !== "edge" &&
            CFG.profile.browser !== "brave") return undefined;
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
  })();

  const NativeUAData = typeof window !== "undefined" ? window.NavigatorUAData : undefined;

  function FakeNavigatorUAData(profile) {
    this._profile = profile;
    const brands = ((profile && profile.uaBrands) || []).map(b =>
      Object.freeze({ brand: b.brand, version: String(b.version) })
    );
    Object.defineProperty(this, "_brands", {
      value: Object.freeze(brands),
      configurable: true
    });
  }

  if (NativeUAData && NativeUAData.prototype) {
    try { Object.setPrototypeOf(FakeNavigatorUAData.prototype, NativeUAData.prototype); } catch {}
  }

  Object.defineProperty(FakeNavigatorUAData.prototype, "brands", {
    configurable: true,
    enumerable: true,
    get: function () { return this._brands; }
  });
  Object.defineProperty(FakeNavigatorUAData.prototype, "mobile", {
    configurable: true,
    enumerable: true,
    get: function () { return !!(this._profile && this._profile.mobile); }
  });
  Object.defineProperty(FakeNavigatorUAData.prototype, "platform", {
    configurable: true,
    enumerable: true,
    get: function () { return this._profile ? this._profile.platform : ""; }
  });
  Object.defineProperty(FakeNavigatorUAData.prototype, "getHighEntropyValues", {
    configurable: true,
    writable: true,
    value: function (hints) {
      const p = this._profile || {};
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
      return Promise.resolve(out);
    }
  });
  Object.defineProperty(FakeNavigatorUAData.prototype, "toJSON", {
    configurable: true,
    writable: true,
    value: function () {
      return { brands: this.brands, mobile: this.mobile, platform: this.platform };
    }
  });

  if (NativeUAData && NativeUAData.prototype) {
    const origHEV = NativeUAData.prototype.getHighEntropyValues;
    const origJSON = NativeUAData.prototype.toJSON;
    if (typeof origHEV === "function") {
      markNative(FakeNavigatorUAData.prototype.getHighEntropyValues, origHEV);
    }
    if (typeof origJSON === "function") {
      markNative(FakeNavigatorUAData.prototype.toJSON, origJSON);
    }
    try {
      Object.defineProperty(FakeNavigatorUAData, "name", { value: "NavigatorUAData", configurable: true });
      Object.defineProperty(FakeNavigatorUAData.prototype, "constructor", {
        value: NativeUAData, configurable: true, writable: true
      });
    } catch {}
  }

  (function patchBrave() {
    if (typeof Navigator === "undefined" || !Navigator.prototype) return;
    const NavProto = Navigator.prototype;

    const origDesc = Object.getOwnPropertyDescriptor(NavProto, "brave");
    const origGet = origDesc && typeof origDesc.get === "function" ? origDesc.get : null;

    function BraveSpoof() {}
    BraveSpoof.prototype.isBrave = function () {
      return Promise.resolve(true);
    };

    safeDefine(NavProto, "brave", {
      configurable: true,
      enumerable: origDesc ? origDesc.enumerable : false,
      get: function () {
        if (CFG.profile && CFG.profile.browser === "brave") {
          if (!this.__tsr_brave) {
            Object.defineProperty(this, "__tsr_brave", {
              value: new BraveSpoof(),
              configurable: true
            });
          }
          return this.__tsr_brave;
        }
        return origGet ? origGet.call(this) : undefined;
      }
    });
  })();

  (function patchPlugins() {
    if (typeof Navigator === "undefined" || !Navigator.prototype) return;
    if (typeof MimeType === "undefined" || typeof Plugin === "undefined" || typeof PluginArray === "undefined") return;
    const NavProto = Navigator.prototype;

    function buildPlugins(profile) {
      if (!profile) return null;
      if (profile.browser !== "chrome" &&
          profile.browser !== "edge" &&
          profile.browser !== "brave") return null;

      const pluginNames = [
        { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "" },
        { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "" }
      ];
      if (profile.browser === "edge") {
        pluginNames.push({ name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "" });
      }

      const mimeTypes = [
        { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
        { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format" }
      ];

      const fakeMimeTypes = mimeTypes.map(mt => {
        const obj = Object.create(MimeType.prototype);
        safeDefine(obj, "type", { value: mt.type, enumerable: true });
        safeDefine(obj, "suffixes", { value: mt.suffixes, enumerable: true });
        safeDefine(obj, "description", { value: mt.description, enumerable: true });
        safeDefine(obj, "enabledPlugin", { value: null, enumerable: true });
        return obj;
      });

      const fakePlugins = pluginNames.map(pn => {
        const obj = Object.create(Plugin.prototype);
        safeDefine(obj, "name", { value: pn.name, enumerable: true });
        safeDefine(obj, "filename", { value: pn.filename, enumerable: true });
        safeDefine(obj, "description", { value: pn.description, enumerable: true });
        safeDefine(obj, "length", { value: fakeMimeTypes.length, enumerable: true });
        fakeMimeTypes.forEach((mt, i) => {
          safeDefine(obj, i, { value: mt, enumerable: true });
          safeDefine(obj, mt.type, { value: mt, enumerable: true });
        });
        safeDefine(obj, "item", {
          value: mimic(function (idx) { return fakeMimeTypes[idx] || null; }, Plugin.prototype.item, "item", 1),
          configurable: true, writable: true
        });
        safeDefine(obj, "namedItem", {
          value: mimic(function (name) {
            return fakeMimeTypes.find(mt => mt.type === name) || null;
          }, Plugin.prototype.namedItem, "namedItem", 1),
          configurable: true, writable: true
        });
        return obj;
      });

      const arr = Object.create(PluginArray.prototype);
      safeDefine(arr, "length", { value: fakePlugins.length, enumerable: true });
      fakePlugins.forEach((p, i) => {
        safeDefine(arr, i, { value: p, enumerable: true });
        safeDefine(arr, p.name, { value: p, enumerable: true });
      });
      safeDefine(arr, "item", {
        value: mimic(function (idx) { return fakePlugins[idx] || null; }, PluginArray.prototype.item, "item", 1),
        configurable: true, writable: true
      });
      safeDefine(arr, "namedItem", {
        value: mimic(function (name) {
          return fakePlugins.find(p => p.name === name) || null;
        }, PluginArray.prototype.namedItem, "namedItem", 1),
        configurable: true, writable: true
      });
      safeDefine(arr, Symbol.iterator, {
        value: function () { return fakePlugins[Symbol.iterator](); },
        configurable: true, writable: true
      });
      return arr;
    }

    const pluginsDesc = Object.getOwnPropertyDescriptor(NavProto, "plugins");
    if (pluginsDesc && typeof pluginsDesc.get === "function") {
      const orig = pluginsDesc.get;
      const patched = mimic(function () {
        if (!CFG.profile) return orig.call(this);
        const fake = buildPlugins(CFG.profile);
        return fake || orig.call(this);
      }, orig, "get plugins", 0);
      safeDefine(NavProto, "plugins", {
        configurable: true,
        enumerable: pluginsDesc.enumerable,
        get: patched
      });
    }

    const pdfDesc = Object.getOwnPropertyDescriptor(NavProto, "pdfViewerEnabled");
    if (pdfDesc && typeof pdfDesc.get === "function") {
      const orig = pdfDesc.get;
      const patched = mimic(function () {
        if (!CFG.profile) return orig.call(this);
        const b = CFG.profile.browser;
        if (b === "chrome" || b === "edge" || b === "brave" || b === "safari") return true;
        return orig.call(this);
      }, orig, "get pdfViewerEnabled", 0);
      safeDefine(NavProto, "pdfViewerEnabled", {
        configurable: true,
        enumerable: pdfDesc.enumerable,
        get: patched
      });
    }
  })();

  (function patchScreen() {
    if (typeof Screen === "undefined" || !Screen.prototype) return;
    const ScreenProto = Screen.prototype;

    function redefineScreen(name, getter) {
      const desc = Object.getOwnPropertyDescriptor(ScreenProto, name);
      if (!desc || typeof desc.get !== "function") return;
      const orig = desc.get;
      const patched = mimic(function () {
        if (!CFG.profile || !CFG.profile.screen) return orig.call(this);
        return getter(CFG.profile.screen);
      }, orig, "get " + name, 0);
      safeDefine(ScreenProto, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: patched
      });
    }

    redefineScreen("width",       (s) => s.width);
    redefineScreen("height",      (s) => s.height);
    redefineScreen("availWidth",  (s) => s.availWidth);
    redefineScreen("availHeight", (s) => s.availHeight);
    redefineScreen("colorDepth",  (s) => s.colorDepth);
    redefineScreen("pixelDepth",  (s) => s.colorDepth);
  })();

  (function patchDPR() {
    let desc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    let target = window;
    if (!desc && typeof Window !== "undefined") {
      desc = Object.getOwnPropertyDescriptor(Window.prototype, "devicePixelRatio");
      target = Window.prototype;
    }
    if (!desc || typeof desc.get !== "function") return;
    const orig = desc.get;
    const patched = mimic(function () {
      if (!CFG.profile || !CFG.profile.screen) return orig.call(this);
      return CFG.profile.screen.pixelRatio;
    }, orig, "get devicePixelRatio", 0);
    safeDefine(target, "devicePixelRatio", {
      configurable: true,
      enumerable: desc.enumerable,
      get: patched
    });
  })();

  (function patchVisibility() {
    if (typeof Document === "undefined" || !Document.prototype) return;
    const DocProto = Document.prototype;

    let origHiddenGet = null;
    {
      const desc = Object.getOwnPropertyDescriptor(DocProto, "hidden");
      if (desc && typeof desc.get === "function") origHiddenGet = desc.get;
    }

    function redefineDocProp(name, value) {
      const desc = Object.getOwnPropertyDescriptor(DocProto, name);
      if (!desc || typeof desc.get !== "function") return;
      const orig = desc.get;
      const patched = mimic(function () {
        return CFG.profile ? value : orig.call(this);
      }, orig, "get " + name, 0);
      safeDefine(DocProto, name, {
        configurable: true,
        enumerable: desc.enumerable,
        get: patched
      });
    }

    redefineDocProp("hidden", false);
    redefineDocProp("visibilityState", "visible");

    const origHasFocus = DocProto.hasFocus;
    if (typeof origHasFocus === "function") {
      DocProto.hasFocus = mimic(function () {
        return CFG.profile ? true : origHasFocus.call(this);
      }, origHasFocus, "hasFocus", 0);
    }

    const origRAF = window.requestAnimationFrame;
    if (typeof origRAF === "function") {
      window.requestAnimationFrame = mimic(function (cb) {
        if (CFG.profile && origHiddenGet && origHiddenGet.call(document)) {
          return setTimeout(() => cb(performance.now()), 16);
        }
        return origRAF.call(window, cb);
      }, origRAF, "requestAnimationFrame", 1);
    }
  })();

  (function patchIntl() {
    if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return;
    const DTF = Intl.DateTimeFormat;
    const origResolvedOptions = DTF.prototype.resolvedOptions;
    if (typeof origResolvedOptions !== "function") return;

    DTF.prototype.resolvedOptions = mimic(function () {
      const opts = origResolvedOptions.call(this);
      if (!CFG.profile || !CFG.profile.timezone) return opts;
      try { opts.timeZone = CFG.profile.timezone; } catch {}
      return opts;
    }, origResolvedOptions, "resolvedOptions", 0);

    const origOffset = Date.prototype.getTimezoneOffset;
    if (typeof origOffset === "function") {
      Date.prototype.getTimezoneOffset = mimic(function () {
        if (!CFG.profile || !CFG.profile.timezone) return origOffset.call(this);
        try {
          const tz = CFG.profile.timezone;
          const dtf = new DTF("en-US", {
            timeZone: tz,
            hour12: false,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
          });
          const parts = dtf.formatToParts(this);
          const m = {};
          for (const p of parts) m[p.type] = p.value;
          const hour = m.hour === "24" ? "00" : m.hour;
          const asUTC = Date.UTC(
            parseInt(m.year, 10), parseInt(m.month, 10) - 1, parseInt(m.day, 10),
            parseInt(hour, 10), parseInt(m.minute, 10), parseInt(m.second, 10)
          );
          return Math.round((this.getTime() - asUTC) / 60000);
        } catch {
          return origOffset.call(this);
        }
      }, origOffset, "getTimezoneOffset", 0);
    }
  })();

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
    } catch {}

    try { window.RTCPeerConnection = Patched; } catch {}
  })();

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
    if (!CFG.profile) return serializer(canvas);
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx || canvas.width <= 0 || canvas.height <= 0) return serializer(canvas);
    let img;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return serializer(canvas);
    }
    addDetNoise(img.data, hash32(getOrigin() + "|" + canvas.width + "x" + canvas.height));
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

  const WEBGL_CONST = {
    MAX_TEXTURE_SIZE: 0x0D33,
    MAX_RENDERBUFFER_SIZE: 0x84E8,
    MAX_VIEWPORT_DIMS: 0x0D3A,
    ALIASED_LINE_WIDTH_RANGE: 0x846E,
    ALIASED_POINT_SIZE_RANGE: 0x846D,
    MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
    MAX_VARYING_VECTORS: 0x8DFC,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C
  };

  function spoofValue(which) {
    if (!CFG.profile) return null;
    if (CFG.profile.browser !== "chrome" &&
        CFG.profile.browser !== "brave") return null;
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

      if (CFG.profile && CFG.profile.webglParams) {
        for (const name in WEBGL_CONST) {
          if (p === WEBGL_CONST[name]) {
            const val = CFG.profile.webglParams[name];
            if (val !== undefined) {
              if (Array.isArray(val)) {
                return name === "MAX_VIEWPORT_DIMS" ? new Int32Array(val) : new Float32Array(val);
              }
              return val;
            }
          }
        }
      }

      return orig.apply(this, arguments);
    }, orig, "getParameter", 1);

    const origGetSupportedExtensions = proto.getSupportedExtensions;
    if (typeof origGetSupportedExtensions === "function") {
      proto.getSupportedExtensions = mimic(function () {
        if (CFG.profile && CFG.profile.webglParams && CFG.profile.webglParams.SUPPORTED_EXTENSIONS) {
          return CFG.profile.webglParams.SUPPORTED_EXTENSIONS.slice();
        }
        return origGetSupportedExtensions.apply(this, arguments);
      }, origGetSupportedExtensions, "getSupportedExtensions", 0);
    }

    const origGetExtension = proto.getExtension;
    if (typeof origGetExtension === "function") {
      proto.getExtension = mimic(function (name) {
        if (CFG.profile && CFG.profile.webglParams && CFG.profile.webglParams.SUPPORTED_EXTENSIONS) {
          if (!CFG.profile.webglParams.SUPPORTED_EXTENSIONS.includes(name)) {
            return null;
          }
        }
        return origGetExtension.apply(this, arguments);
      }, origGetExtension, "getExtension", 1);
    }
  }
  if (typeof WebGLRenderingContext !== "undefined") patchWebGL(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== "undefined") patchWebGL(WebGL2RenderingContext.prototype);

  (function patchWebGPU() {
    if (typeof GPUAdapterInfo === "undefined" || !GPUAdapterInfo.prototype) return;

    const FAKE = {
      Windows: { vendor: "nvidia", architecture: "gen-3",    device: "NVIDIA GeForce RTX 3060", description: "" },
      macOS:   { vendor: "apple",  architecture: "apple-m2", device: "Apple M2",                description: "" },
      Linux:   { vendor: "intel",  architecture: "gen-3",    device: "Intel UHD Graphics 620",  description: "" }
    };

    function fakeFor(name) {
      if (!CFG.profile) return undefined;
      if (CFG.profile.browser !== "chrome" &&
          CFG.profile.browser !== "brave") return undefined;
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

  (function patchAudio() {
    if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") return;

    function audioSeedFor(x) {
      try {
        const sr = x.sampleRate || (x.context && x.context.sampleRate) || 0;
        const len = x.length || x.frequencyBinCount || 0;
        const nc = x.numberOfChannels || 0;
        return hash32("a" + sr + "|" + len + "|" + nc + "|" + getOrigin());
      } catch { return 1; }
    }

    function noiseForAudio(data, seed) {
      let s = (seed || 1) >>> 0;
      for (let i = 0; i < data.length; i += 100) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        data[i] += (s & 1) ? 1e-8 : -1e-8;
      }
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
    }
  })();

  (function patchFonts() {
    if (typeof FontFaceSet !== "undefined" && FontFaceSet.prototype &&
        typeof FontFaceSet.prototype.check === "function") {
      const origCheck = FontFaceSet.prototype.check;
      const GENERIC_FONTS = /(?:^|\s)(?:["']?)(serif|sans-serif|monospace|cursive|fantasy|system-ui)(?:["']?)$/i;
      try {
        FontFaceSet.prototype.check = mimic(function (font, text = " ") {
          if (CFG.profile && GENERIC_FONTS.test(String(font))) return true;
          return origCheck.call(this, font, text);
        }, origCheck, "check", 1);
      } catch {}
    }

    const origMeasure = CanvasRenderingContext2D.prototype.measureText;
    if (typeof origMeasure === "function") {
      CanvasRenderingContext2D.prototype.measureText = mimic(function (text) {
        const m = origMeasure.call(this, text);
        if (!CFG.profile) return m;
        const seed = hash32(text + this.font + "|" + getOrigin());
        const delta = ((seed % 100) - 50) / 100000;
        try {
          const w = m.width;
          if (typeof w === "number") {
            Object.defineProperty(m, "width", { value: w + delta, configurable: true });
          }
        } catch {}
        return m;
      }, origMeasure, "measureText", 1);
    }
  })();

  function buildWorkerSource(profile, salt) {
    const pJson = JSON.stringify(profile);
    const s = (salt | 0) || 0;
    return `(function(){
  "use strict";
  var __P__ = ${pJson};
  if (!__P__) return;
  var SALT = ${s};
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
    redefine("maxTouchPoints", 0);

    if (__P__.browser === "brave") {
      try {
        var braveObj = { isBrave: function () { return Promise.resolve(true); } };
        var bd = Object.getOwnPropertyDescriptor(NavProto, "brave");
        if (!bd) {
          Reflect.defineProperty(NavProto, "brave", {
            configurable: true, enumerable: false,
            get: function () { return braveObj; }
          });
        }
      } catch (e) {}
    }

    if (__P__.browser === "firefox" || __P__.browser === "safari") {
      try {
        var cd = Object.getOwnPropertyDescriptor(NavProto, "connection");
        if (cd && cd.configurable) {
          delete NavProto.connection;
        }
      } catch (e) {}
    }

    if (__P__.timezone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      try {
        var DTF = Intl.DateTimeFormat;
        var _ro = DTF.prototype.resolvedOptions;
        DTF.prototype.resolvedOptions = function () {
          var o = _ro.call(this);
          try { o.timeZone = __P__.timezone; } catch (e) {}
          return o;
        };
        var _off = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function () {
          try {
            var dtf = new DTF("en-US", {
              timeZone: __P__.timezone,
              hour12: false,
              year: "numeric", month: "2-digit", day: "2-digit",
              hour: "2-digit", minute: "2-digit", second: "2-digit"
            });
            var parts = dtf.formatToParts(this);
            var m = {};
            for (var i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
            var hour = m.hour === "24" ? "00" : m.hour;
            var asUTC = Date.UTC(
              parseInt(m.year, 10), parseInt(m.month, 10) - 1, parseInt(m.day, 10),
              parseInt(hour, 10), parseInt(m.minute, 10), parseInt(m.second, 10)
            );
            return Math.round((this.getTime() - asUTC) / 60000);
          } catch (e) {
            return _off.call(this);
          }
        };
      } catch (e) {}
    }
  } catch (e) {}
  if (typeof AudioBuffer !== "undefined") {
    var _g = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function (ch) {
      var d = _g.call(this, ch);
      var s = hash32("ch" + ch + "|" + this.sampleRate + "|" + this.length);
      for (var i = 0; i < d.length; i += 100) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        d[i] += (s & 1) ? 1e-8 : -1e-8;
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
        } catch {}
        if (
          !isModule &&
          CFG.profile &&
          typeof resolved === "string" &&
          resolved.startsWith(location.origin + "/") &&
          !resolved.startsWith("blob:")
        ) {
          const source = buildWorkerSource(CFG.profile, profileSalt());
          const blob = new Blob([source + "\nimportScripts(" + JSON.stringify(resolved) + ");"], {
            type: "application/javascript"
          });
          const blobUrl = URL.createObjectURL(blob);
          return new OrigWorker(blobUrl, options);
        }
      } catch {}
      return new OrigWorker(url, options);
    }

    mimic(PatchedWorker, OrigWorker, "Worker", 1);
    PatchedWorker.prototype = OrigWorker.prototype;

    try {
      Object.defineProperty(OrigWorker.prototype, "constructor", {
        value: PatchedWorker, configurable: true, writable: true
      });
    } catch {}

    try { window.Worker = PatchedWorker; } catch {}
  })();

})();