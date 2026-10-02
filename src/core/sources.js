(function initSources(root) {
  const DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "codex-lead",
      label: "Tibo의 Codex 소식",
      kind: "dayclaw",
      url: "https://api.dayclaw.com/api/source/public/x/thsottiaux/items",
      weight: 1,
      setting: "monitorLeadSource"
    }),
    Object.freeze({
      id: "openai-status",
      label: "OpenAI Status",
      kind: "statuspage",
      url: "https://status.openai.com/api/v2/incidents.json",
      weight: 0.7,
      setting: "monitorStatusSource"
    }),
    Object.freeze({
      id: "community-reset-history",
      label: "커뮤니티 리셋 기록",
      kind: "reset-tracker-html",
      url: "https://codex-resets.com/",
      weight: 0.58,
      setting: "monitorHistorySource"
    }),
    Object.freeze({
      id: "github-community",
      label: "OpenAI/Codex GitHub 커뮤니티",
      kind: "github-issues",
      url: "https://api.github.com/repos/openai/codex/issues?state=all&labels=rate-limits&sort=updated&direction=desc&per_page=20",
      weight: 0.35,
      setting: "monitorCommunitySource"
    })
  ]);

  function enabled(settings = {}) {
    return DEFINITIONS.filter((source) => settings[source.setting] !== false);
  }

  function sourceMeta(source) {
    return {
      id: source.id,
      label: source.label,
      weight: source.weight,
      kind: source.kind
    };
  }

  function normalizeDayclaw(payload, source) {
    return root.RadarSignals.extractItems(payload).map((item) => ({
      ...item,
      entityId: item.id,
      source: sourceMeta(source)
    }));
  }

  function normalizeStatusPage(payload, source) {
    const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
    return incidents.map((incident) => {
      const updates = Array.isArray(incident?.incident_updates) ? incident.incident_updates : [];
      const details = updates.slice(0, 4).map((update) => update?.body).filter(Boolean).join(" ");
      const revision = incident.updated_at || incident.created_at || "unknown";
      return {
        id: `status:${incident.id}:${revision}`,
        entityId: `status:${incident.id}`,
        text: `${incident.name || "OpenAI incident"}. ${details}`.slice(0, 6000),
        author: "OpenAI Status",
        createdAt: updates[0]?.created_at || incident.updated_at || incident.created_at || null,
        url: `https://status.openai.com/incidents/${encodeURIComponent(incident.id)}`,
        isReply: false,
        source: sourceMeta(source)
      };
    }).filter((item) => item.id && item.text);
  }

  function normalizeGithubIssues(payload, source) {
    if (!Array.isArray(payload)) return [];
    return payload.filter((issue) => !issue?.pull_request).map((issue) => ({
      id: `github:${issue.id}:${issue.updated_at || issue.created_at || "unknown"}`,
      entityId: `github:${issue.id}`,
      text: `${issue.title || ""}. ${issue.body || ""}`.slice(0, 6000),
      author: issue.user?.login || "GitHub community",
      createdAt: issue.created_at || issue.updated_at || null,
      url: `https://github.com/openai/codex/issues/${encodeURIComponent(issue.number)}`,
      isReply: false,
      source: sourceMeta(source)
    })).filter((item) => item.id && item.text);
  }

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function attribute(attributes, name) {
    const match = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(attributes);
    return decodeHtml(match?.[1] || "");
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function milestoneForecast(items, source, now = Date.now()) {
    const milestones = items.map((item) => {
      const match = /\b(\d{1,2})M active users\b/i.exec(item.text);
      return match ? { count: Number(match[1]), at: root.RadarTime.parseTimestamp(item.createdAt) } : null;
    }).filter((item) => item?.at).sort((a, b) => a.count - b.count);
    const unique = [...new Map(milestones.map((item) => [item.count, item])).values()];
    const latest = unique.at(-1);
    if (!latest || latest.count !== 9 || now - latest.at > 7 * 24 * 60 * 60 * 1000) return null;
    const recent = unique.filter((item) => item.count >= 6 && item.count <= 9);
    const intervals = recent.slice(1).map((item, index) => item.at - recent[index].at).filter((value) => value > 0);
    if (intervals.length < 2) return null;
    const typicalIntervalMs = median(intervals);
    const longestObservedIntervalMs = Math.max(...intervals);
    const expectedAt = latest.at + typicalIntervalMs;
    const lateExpectedAt = expectedAt + longestObservedIntervalMs;
    const experienceWindowClosesAt = latest.at + longestObservedIntervalMs * 2;
    const eventAt = [expectedAt, lateExpectedAt, experienceWindowClosesAt]
      .find((candidate) => candidate > now + 2 * 60 * 60 * 1000);
    if (!eventAt) return null;
    return {
      id: `milestone:10m:${new Date(latest.at).toISOString().slice(0, 10)}`,
      entityId: "milestone:10m",
      text: "Based on community experience, we expect Codex usage limits will reset tomorrow when 10M active users is reached.",
      author: "Community reset history",
      createdAt: now,
      eventAtHint: eventAt,
      url: source.url,
      isReply: false,
      prediction: {
        kind: "milestone",
        target: 10_000_000,
        latestConfirmed: 9_000_000,
        sampleCount: recent.length,
        typicalIntervalMs,
        expectedAt,
        lateExpectedAt,
        experienceWindowClosesAt
      },
      source: sourceMeta(source)
    };
  }

  function normalizeResetTracker(payload, source, options = {}) {
    const html = String(payload || "");
    const items = [];
    const anchorPattern = /<a\b([^>]*\bclass="[^"]*\bcg-cell\b[^"]*"[^>]*)>/gi;
    let match;
    while ((match = anchorPattern.exec(html))) {
      const date = attribute(match[1], "data-date");
      const text = attribute(match[1], "data-snippet");
      const url = attribute(match[1], "href");
      if (!date || !text) continue;
      const externalId = /status\/(\d+)/.exec(url)?.[1] || `${date}:${items.length}`;
      items.push({
        id: `history:${externalId}`,
        entityId: `history:${externalId}`,
        text,
        author: "Community reset history",
        createdAt: `${date}T12:00:00Z`,
        url: url || source.url,
        isReply: false,
        source: sourceMeta(source)
      });
    }
    const forecast = milestoneForecast(items, source, options.now ?? Date.now());
    return forecast ? [...items, forecast] : items;
  }

  function normalize(payload, source, options = {}) {
    if (source.kind === "statuspage") return normalizeStatusPage(payload, source);
    if (source.kind === "reset-tracker-html") return normalizeResetTracker(payload, source, options);
    if (source.kind === "github-issues") return normalizeGithubIssues(payload, source);
    return normalizeDayclaw(payload, source);
  }

  root.RadarSources = Object.freeze({ DEFINITIONS, enabled, normalize });
  if (typeof module !== "undefined") module.exports = root.RadarSources;
})(globalThis);
