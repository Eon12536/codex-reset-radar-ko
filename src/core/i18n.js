(function initI18n(root) {
  const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

  function uiLanguage() {
    const value = root.chrome?.i18n?.getUILanguage?.() || root.navigator?.language || "en";
    return String(value).replace(/_/g, "-");
  }

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
    const value = root.chrome?.i18n?.getMessage?.(key, substitutions);
    if (value) return value;
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

  root.RadarI18n = Object.freeze({ uiLanguage, catalogLanguage, direction, t, apply });
  if (typeof module !== "undefined") module.exports = root.RadarI18n;
})(globalThis);
