(function initTime(root) {
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

  function formatDateTime(value, timeZone, locale = globalThis.navigator?.language || "zh-CN") {
    const timestamp = parseTimestamp(value) ?? Number(value);
    if (!Number.isFinite(timestamp)) return "时间未知";
    return new Intl.DateTimeFormat(locale, {
      timeZone: isValidTimeZone(timeZone) ? timeZone : systemTimeZone(),
      month: "short",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function formatTime(value, timeZone, locale = globalThis.navigator?.language || "zh-CN") {
    const timestamp = parseTimestamp(value) ?? Number(value);
    if (!Number.isFinite(timestamp)) return "--:--";
    return new Intl.DateTimeFormat(locale, {
      timeZone: isValidTimeZone(timeZone) ? timeZone : systemTimeZone(),
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function relativeDuration(target, now = Date.now()) {
    const timestamp = parseTimestamp(target) ?? Number(target);
    if (!Number.isFinite(timestamp)) return "时间未知";
    const seconds = Math.max(0, Math.round((timestamp - now) / 1000));
    if (seconds < 60) return "即将";
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟后`;
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.ceil((seconds % 3600) / 60);
      return minutes ? `${hours} 小时 ${minutes} 分钟后` : `${hours} 小时后`;
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.ceil((seconds % 86400) / 3600);
    return hours ? `${days} 天 ${hours} 小时后` : `${days} 天后`;
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
    formatDateTime,
    formatTime,
    relativeDuration,
    isQuietHours
  });
  if (typeof module !== "undefined") module.exports = root.RadarTime;
})(globalThis);
