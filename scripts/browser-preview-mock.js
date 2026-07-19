(() => {
  const now = Date.now();
  const previewLanguage = new URLSearchParams(globalThis.location?.search || "").get("lang") || "en-US";
  const messages = [];
  const state = {
    settings: {
      timezoneMode: "system",
      timezoneOverride: "UTC",
      monitorSignals: true,
      monitorAccount: true,
      monitorLeadSource: true,
      monitorStatusSource: true,
      monitorHistorySource: true,
      monitorCommunitySource: true,
      confidenceThreshold: "high",
      notifyOfficialReset: true,
      notifyCreditExpiry: true,
      notifyAdvice: true,
      quietHoursEnabled: true,
      quietStart: "23:00",
      quietEnd: "08:00",
      pollMinutes: 15,
      expiryWarningHours: 24,
    },
    accountSnapshot: {
      fetchedAt: now - 2 * 60 * 1000,
      usage: {
        windows: [
          {
            id: "primary",
            kind: "fiveHour",
            usedPercent: 82,
            remainingPercent: 18,
            resetAt: now + 47 * 60 * 1000,
          },
          {
            id: "secondary",
            kind: "weekly",
            usedPercent: 69,
            remainingPercent: 31,
            resetAt: now + 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000,
          },
        ],
      },
      credits: {
        availableCount: 2,
        credits: [
          {
            key: "preview-credit",
            status: "available",
            available: true,
            expiresAt: now + 9 * 60 * 60 * 1000,
          },
        ],
      },
    },
    signalSnapshot: {
      checkedAt: now - 4 * 60 * 1000,
      signal: {
        id: "preview-signal",
        text: "Codex usage limits will reset later today.",
        createdAt: now - 28 * 60 * 1000,
        author: "thsottiaux",
        source: { id: "codex-lead", label: "Codex lead updates", weight: 1 },
        url: "https://x.com/thsottiaux",
        assessment: {
          confidence: "high",
          actionable: true,
          score: 9,
          weightedScore: 9,
          eventAt: now + 3 * 60 * 60 * 1000 + 27 * 60 * 1000,
        },
      },
      activeSignals: [
        {
          id: "preview-signal",
          text: "Codex usage limits will reset later today.",
          createdAt: now - 28 * 60 * 1000,
          author: "thsottiaux",
          source: { id: "codex-lead", label: "Codex lead updates", weight: 1 },
          assessment: {
            confidence: "high",
            actionable: true,
            score: 9,
            weightedScore: 9,
            eventAt: now + 3 * 60 * 60 * 1000 + 27 * 60 * 1000,
          },
        },
        {
          id: "preview-status",
          text: "Codex usage limits will be restored later today.",
          createdAt: now - 18 * 60 * 1000,
          author: "OpenAI Status",
          source: { id: "openai-status", label: "OpenAI Status", weight: 0.7 },
          assessment: {
            confidence: "medium",
            actionable: true,
            score: 9,
            weightedScore: 6.3,
            eventAt: now + 4 * 60 * 60 * 1000,
          },
        },
      ],
    },
    adviceSnapshot: null,
    lastCheckedAt: now - 2 * 60 * 1000,
  };

  const selectKeys = (keys) => {
    if (!keys) return { ...state };
    if (typeof keys === "string") return { [keys]: state[keys] };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, state[key]]));
    }
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        state[key] === undefined ? fallback : state[key],
      ]),
    );
  };

  globalThis.chrome = {
    i18n: {
      getUILanguage: () => previewLanguage,
      getMessage: () => "",
    },
    storage: {
      local: {
        get: async (keys) => selectKeys(keys),
        set: async (value) => Object.assign(state, value),
        clear: async () => {
          for (const key of Object.keys(state)) delete state[key];
        },
      },
      session: {
        clear: async () => {},
      },
      onChanged: {
        addListener: () => {},
      },
    },
    runtime: {
      openOptionsPage: async () => {},
      sendMessage: async (message) => {
        messages.push(message);
        if (message?.type === "SAVE_SETTINGS") {
          state.settings = { ...state.settings, ...message.settings };
          return { ok: true, settings: state.settings };
        }
        return { ok: true };
      },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ ok: true }),
      create: async () => ({ id: 2 }),
    },
  };
  globalThis.__radarPreview = { state, messages };
})();
