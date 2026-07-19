(function initSettings(root) {
  const DEFAULTS = Object.freeze({
    monitorSignals: true,
    monitorAccount: true,
    monitorLeadSource: true,
    monitorStatusSource: true,
    monitorHistorySource: true,
    monitorCommunitySource: true,
    pollMinutes: 30,
    confidenceThreshold: "high",
    notifyOfficialReset: true,
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
    const next = { ...DEFAULTS, ...settings };
    next.pollMinutes = sanitizePollMinutes(next.pollMinutes);
    next.confidenceThreshold = ["high", "medium", "all"].includes(next.confidenceThreshold)
      ? next.confidenceThreshold
      : DEFAULTS.confidenceThreshold;
    next.timezoneMode = next.timezoneMode === "manual" ? "manual" : "system";
    next.sourceUrl = String(next.sourceUrl || "").trim();
    next.timezoneOverride = String(next.timezoneOverride || "").trim();
    next.expiryWarningHours = Math.min(168, Math.max(1, Number(next.expiryWarningHours) || 24));
    return next;
  }

  root.RadarSettings = Object.freeze({ DEFAULTS, sanitize });
  if (typeof module !== "undefined") module.exports = root.RadarSettings;
})(globalThis);
