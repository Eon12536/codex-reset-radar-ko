const test = require("node:test");
const assert = require("node:assert/strict");

global.RadarTranslations = require("../src/core/translations.js");
global.chrome = {
  i18n: {
    getMessage: () => "",
    getUILanguage: () => "en"
  }
};
const I18n = require("../src/core/i18n.js");

test("selects each supported runtime locale from the Chrome UI language", () => {
  const cases = {
    "zh-CN": "zh_CN",
    "zh-TW": "zh_CN",
    "en-US": "en",
    ja: "ja",
    ko: "ko",
    fr: "fr",
    it: "it",
    es: "es",
    ar: "ar"
  };
  for (const [language, expected] of Object.entries(cases)) {
    assert.equal(I18n.catalogLanguage(language), expected);
  }
});

test("uses right-to-left layout for Arabic", () => {
  assert.equal(I18n.direction("ar"), "rtl");
  assert.equal(I18n.direction("ar-SA"), "rtl");
  assert.equal(I18n.direction("fr"), "ltr");
});

test("interpolates localized runtime messages", () => {
  global.chrome.i18n.getUILanguage = () => "en-US";
  assert.equal(I18n.t("possibleResetAt", "10:30", "Possible reset at $1"), "Possible reset at 10:30");
  assert.equal(I18n.t("missingMessage", undefined, ""), "");
  global.chrome.i18n.getUILanguage = () => "es";
  assert.equal(I18n.t("remainingWithReset", ["42", "mañana"]), "42% restante · mañana");
  global.chrome.i18n.getUILanguage = () => "ar";
  assert.match(I18n.t("weeklyRemaining", "35"), /35/);
});
