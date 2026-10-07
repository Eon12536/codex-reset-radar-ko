(function initSettings(root) {
  const DEFAULTS = Object.freeze({
    theme: "system",
    monitorSignals: true,
    monitorAccount: false,
    monitorChat: false,
    syncChatHistory: false,
    syncChatResetWithCodex: false,
    monitorLeadSource: true,
    monitorDirectX: false,
    monitorStatusSource: true,
    monitorHistorySource: true,
    monitorCommunitySource: true,
    pollMinutes: 30,
    confidenceThreshold: "high",
    notifyOfficialReset: true,
    notifyHints: false,
    notifyResetHints: true,
    notifyScheduleChanges: true,
    notifyAccountReset: true,
    notifyBankedReset: true,
    notifyRecoveryOnResume: true,
    notifyPublicOnResume: true,
    notifyCreditExpiry: true,
    notifyAdvice: true,
    quietHoursEnabled: true,
    quietStart: "23:00",
    quietEnd: "08:00",
    timezoneMode: "system",
    timezoneOverride: "",
    sourceUrl: "",
    expiryWarningHours: 24
  });

  function sanitizePollMinutes(value) {
    const allowed = [15, 30, 60, 120];
    const number = Number(value);
    return allowed.includes(number) ? number : DEFAULTS.pollMinutes;
  }

  function sanitize(settings = {}) {
    const input = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const next = { ...DEFAULTS };
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(input, key) && typeof input[key] === typeof fallback) next[key] = input[key];
    }
    next.pollMinutes = sanitizePollMinutes(next.pollMinutes);
    if (!next.monitorChat) next.syncChatHistory = false;
    next.confidenceThreshold = ["high", "medium", "all"].includes(next.confidenceThreshold)
      ? next.confidenceThreshold
      : DEFAULTS.confidenceThreshold;
    next.timezoneMode = next.timezoneMode === "manual" ? "manual" : "system";
    next.theme = ["system", "light", "dark"].includes(next.theme) ? next.theme : DEFAULTS.theme;
    next.sourceUrl = ""; // Public requests are limited to bundled, fixed endpoints.
    next.timezoneOverride = String(next.timezoneOverride || "").trim().slice(0, 64);
    for (const key of ["quietStart", "quietEnd"]) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next[key])) next[key] = DEFAULTS[key];
    }
    next.expiryWarningHours = Math.min(168, Math.max(1, Number(next.expiryWarningHours) || 24));
    return next;
  }

  root.RadarSettings = Object.freeze({ DEFAULTS, sanitize });
  if (typeof module !== "undefined") module.exports = root.RadarSettings;
})(globalThis);
