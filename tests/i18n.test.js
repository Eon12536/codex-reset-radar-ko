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

test("recognizes the upstream locale identifiers", () => {
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

test("keeps Korean text and layout even if Chrome supplies Chinese messages", () => {
  for (const language of ["zh-CN", "en-US", "ar", "ko-KR"]) {
    global.chrome.i18n.getUILanguage = () => language;
    global.chrome.i18n.getMessage = () => "重置";
    assert.equal(I18n.uiLanguage(), "ko-KR");
    assert.equal(I18n.catalogLanguage(), "ko");
    assert.equal(I18n.direction(), "ltr");
    assert.equal(I18n.t("possibleResetAt", "10:30", "Possible reset at $1"), "10:30 리셋 가능성");
    assert.equal(I18n.t("remainingWithReset", ["42", "내일"]), "42% 남음 · 내일");
  }
  assert.equal(I18n.t("missingMessage", undefined, ""), "");
  assert.equal(I18n.t("missingMessage", "값", "대체: $1"), "대체: 값");
});

test("Korean catalog covers all upstream messages and substitution slots", () => {
  const { ko, zh_CN: reference } = global.RadarTranslations;
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(reference).sort());
  const slots = (value) => [...new Set(value.match(/\{\d+\}/g) || [])].sort();
  for (const [key, value] of Object.entries(ko)) {
    assert.ok(value.length, key);
    assert.doesNotMatch(value, /\p{Script=Han}/u, key);
    assert.deepEqual(slots(value), slots(reference[key]), key);
  }
});

test("formats dates and relative reset times in Korean", () => {
  global.RadarI18n = I18n;
  const Time = require("../src/core/time.js");
  const now = Date.parse("2026-09-17T00:00:00Z");
  assert.equal(Time.formatTime(now, "Asia/Seoul"), "오전 9:00");
  assert.equal(Time.relativeDuration(now + 3600000, now), "1시간 후");
  assert.match(Time.formatDateTime(now, "Asia/Seoul"), /9월 17일/);
});
