(function initI18n(root) {
  const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);
  const COUNTRIES = Object.freeze([
    { locale: 'ko-KR', code: 'kr', name: '대한민국', timeZone: 'Asia/Seoul', timeLabel: '한국' },
    { locale: 'en-US', code: 'us', name: 'United States', timeZone: 'America/New_York', timeLabel: 'US Eastern (ET)' },
    { locale: 'en-GB', code: 'gb', name: 'United Kingdom', timeZone: 'Europe/London', timeLabel: 'UK' },
    { locale: 'ja-JP', code: 'jp', name: '日本', timeZone: 'Asia/Tokyo', timeLabel: '日本' },
    { locale: 'zh-CN', code: 'cn', name: '中国', timeZone: 'Asia/Shanghai', timeLabel: '中国' },
    { locale: 'fr-FR', code: 'fr', name: 'France', timeZone: 'Europe/Paris', timeLabel: 'France' },
    { locale: 'es-ES', code: 'es', name: 'España', timeZone: 'Europe/Madrid', timeLabel: 'España (Madrid)' },
    { locale: 'it-IT', code: 'it', name: 'Italia', timeZone: 'Europe/Rome', timeLabel: 'Italia' }
  ].map(Object.freeze));
  const LOCALES = Object.freeze(COUNTRIES.map(country => country.locale));
  let selected = 'ko-KR', revision = 0;
  const listeners = new Set();

  function uiLanguage() {
    return selected;
  }
  function country() { return COUNTRIES.find(item => item.locale === selected) || COUNTRIES[0]; }
  function setLocale(value) {
    selected = LOCALES.includes(value) ? value : 'ko-KR';
    revision++;
    apply();
    for (const listener of listeners) listener(selected);
  }
  async function save(value) {
    if (!LOCALES.includes(value)) throw new TypeError('Unsupported language');
    await root.chrome.storage.local.set({ uiLocale: value });
    setLocale(value);
    return selected;
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }

  function catalogLanguage(language = uiLanguage()) {
    const normalized = String(language).replace(/-/g, "_").toLowerCase();
    if (normalized.startsWith("zh")) return "zh_CN";
    const base = normalized.split("_")[0];
    return ["ar", "es", "fr", "it", "ja", "ko"].includes(base) ? base : "en";
  }

  function interpolate(template, substitutions) {
    const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
    return String(template).replace(/\{(\d+)\}/g, (_match, index) => String(values[Number(index)] ?? ""));
  }

  function interpolateFallback(template, substitutions) {
    const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
    return String(template).replace(/\$(\d+)/g, (_match, index) => String(values[Number(index) - 1] ?? ""));
  }

  function t(key, substitutions, fallback) {
    // Explicit preference is independent of the Chrome UI language and time zone.
    const template = root.RadarTranslations?.[catalogLanguage()]?.[key];
    if (template) return interpolate(template, substitutions);
    if (fallback !== undefined) return fallback ? interpolateFallback(fallback, substitutions) : "";
    return key;
  }

  function direction(language = uiLanguage()) {
    return RTL_LANGUAGES.has(String(language).split("-")[0].toLowerCase()) ? "rtl" : "ltr";
  }

  function apply(container = root.document) {
    if (!container) return;
    const language = uiLanguage();
    const documentElement = container.documentElement || root.document?.documentElement;
    if (documentElement) {
      documentElement.lang = language;
      documentElement.dir = direction(language);
    }
    const scope = container.querySelectorAll ? container : root.document;
    scope?.querySelectorAll?.("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n, undefined, element.textContent);
    });
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      scope?.querySelectorAll?.(`[data-i18n-${attribute}]`).forEach((element) => {
        const key = element.dataset[`i18n${attribute.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()).replace(/^./, (letter) => letter.toUpperCase())}`];
        element.setAttribute(attribute, t(key, undefined, element.getAttribute(attribute) || ""));
      });
    }
  }

  const initialRevision = revision;
  const ready = root.chrome?.storage?.local?.get?.('uiLocale')?.then(data => {
    if (revision === initialRevision) setLocale(data.uiLocale);
  }).catch(() => {}) || Promise.resolve();
  root.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.uiLocale) setLocale(changes.uiLocale.newValue);
  });
  root.RadarI18n = Object.freeze({ uiLanguage, country, catalogLanguage, direction, t, apply, save, subscribe, ready, setLocale, LOCALES, COUNTRIES });
  if (typeof module !== "undefined") module.exports = root.RadarI18n;
})(globalThis);
