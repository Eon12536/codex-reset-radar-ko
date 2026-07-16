(() => {
  const now = Date.now();
  const messages = [];
  const state = {
    settings: {
      timezoneMode: "system",
      timezoneOverride: "Asia/Shanghai",
      monitorSignals: true,
      monitorAccount: true,
      confidenceThreshold: "high",
      notifyOfficialReset: true,
      notifyCreditExpiry: true,
      notifyAdvice: true,
      quietHoursEnabled: true,
      quietStart: "23:00",
      quietEnd: "08:00",
      pollMinutes: 15,
      targetHandle: "thsottiaux",
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
        url: "https://x.com/thsottiaux",
        assessment: {
          confidence: "high",
          actionable: true,
          score: 9,
          eventAt: now + 3 * 60 * 60 * 1000 + 27 * 60 * 1000,
        },
      },
    },
    adviceSnapshot: {
      tier: "wait",
      title: "距离官方重置较近，建议先等待",
      message: "5 小时额度只剩 18%，但高可信公开信号显示可能很快重置。",
      detail: "重置券可保留给更紧急的工作",
      generatedAt: now - 2 * 60 * 1000,
    },
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
