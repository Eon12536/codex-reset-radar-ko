(function initTime(root) {
  function translated(key, substitutions, fallback) {
    const localized = root.RadarI18n?.t?.(key, substitutions, "");
    if (localized) return localized;
    const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
    return String(fallback).replace(/\$(\d+)/g, (_match, index) => String(values[Number(index) - 1] ?? ""));
  }

  function locale() {
    return root.RadarI18n?.uiLanguage?.() || root.navigator?.language || "en";
  }

  function systemTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function isValidTimeZone(value) {
    if (!value) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
      return true;
    } catch {
      return false;
    }
  }

  function resolveTimeZone(settings = {}) {
    if (settings.timezoneMode === "manual" && isValidTimeZone(settings.timezoneOverride)) {
      return settings.timezoneOverride;
    }
    return systemTimeZone();
  }

  // Country is a presentation preference. Do not change quiet-hour scheduling
  // or the source zone used to interpret the author's original words.
  function countryZone() {
    const country = root.RadarI18n?.country?.();
    return { zone: country?.timeZone || 'Asia/Seoul', label: country?.timeLabel || '한국' };
  }

  function parseTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
      let epoch = Number(value);
      if (!Number.isFinite(epoch)) return null;
      if (epoch > 10_000_000_000 && epoch < 10_000_000_000_000) epoch /= 1000;
      if (epoch < 946684800 || epoch > 7258118400) return null;
      return epoch * 1000;
    }
    const text = String(value).trim();
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatLocalized(value, options, selectedLocale = locale()) {
    const text = new Intl.DateTimeFormat(selectedLocale, options).format(value);
    // Some ICU versions keep English day periods even in Korean date formats.
    return /^ko(?:-|$)/i.test(selectedLocale)
      ? text.replace(/\bAM\b/g, "오전").replace(/\bPM\b/g, "오후")
      : text;
  }

  function formatDateTime(value, timeZone, selectedLocale = locale()) {
    const timestamp = parseTimestamp(value);
    if (!Number.isFinite(timestamp)) return translated("timeUnknown", undefined, "Time unknown");
    return formatLocalized(new Date(timestamp), {
      timeZone: isValidTimeZone(timeZone) ? timeZone : systemTimeZone(),
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12"
    }, selectedLocale);
  }

  function formatTime(value, timeZone, selectedLocale = locale()) {
    const timestamp = parseTimestamp(value);
    if (!Number.isFinite(timestamp)) return "--:--";
    return formatLocalized(new Date(timestamp), {
      timeZone: isValidTimeZone(timeZone) ? timeZone : systemTimeZone(),
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12"
    }, selectedLocale);
  }

  function relativeDuration(target, now = Date.now()) {
    const timestamp = parseTimestamp(target);
    if (!Number.isFinite(timestamp)) return translated("timeUnknown", undefined, "Time unknown");
    const seconds = Math.max(0, Math.round((timestamp - now) / 1000));
    if (seconds < 60) return translated("timeSoon", undefined, "soon");
    if (seconds < 3600) return translated("inMinutes", String(Math.ceil(seconds / 60)), "in $1 min");
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return minutes
        ? translated("inHoursMinutes", [String(hours), String(minutes)], "in $1 hr $2 min")
        : translated("inHours", String(hours), "in $1 hr");
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.ceil((seconds % 86400) / 3600);
    return hours
      ? translated("inDaysHours", [String(days), String(hours)], "in $1 d $2 hr")
      : translated("inDays", String(days), "in $1 d");
  }

  function elapsedDuration(since, now = Date.now()) {
    const timestamp = parseTimestamp(since);
    if (!Number.isFinite(timestamp)) return translated("timeUnknown", undefined, "Time unknown");
    const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
    if (seconds < 60) return translated("justNow", undefined, "just now");
    if (seconds < 3600) return translated("minutesAgo", String(Math.ceil(seconds / 60)), "$1 min ago");
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return minutes
        ? translated("hoursMinutesAgo", [String(hours), String(minutes)], "$1 hr $2 min ago")
        : translated("hoursAgo", String(hours), "$1 hr ago");
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.ceil((seconds % 86400) / 3600);
    return hours
      ? translated("daysHoursAgo", [String(days), String(hours)], "$1 d $2 hr ago")
      : translated("daysAgo", String(days), "$1 d ago");
  }

  function minutesOfDay(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function zonedParts(now, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(now));
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function isQuietHours(settings, now = Date.now()) {
    if (!settings?.quietHoursEnabled) return false;
    const start = minutesOfDay(settings.quietStart);
    const end = minutesOfDay(settings.quietEnd);
    if (start === null || end === null || start === end) return false;
    const timeZone = resolveTimeZone(settings);
    const parts = zonedParts(now, timeZone);
    const current = Number(parts.hour) * 60 + Number(parts.minute);
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  root.RadarTime = Object.freeze({
    systemTimeZone,
    isValidTimeZone,
    resolveTimeZone,
    parseTimestamp,
    countryZone,
    formatLocalized,
    formatDateTime,
    formatTime,
    relativeDuration,
    elapsedDuration,
    isQuietHours
  });
  if (typeof module !== "undefined") module.exports = root.RadarTime;
})(globalThis);
