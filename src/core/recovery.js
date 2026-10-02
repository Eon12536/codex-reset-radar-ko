(function initRecovery(root) {
  // Keep the comparison across weekends, shutdowns and failed startup requests.
  const MAX_GAP = 30 * 24 * 3600000;
  const KINDS = ["fiveHour", "weekly"];
  const textId = value => typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;

  async function accountKey(token, rawUsage, salt) {
    if (!token || !salt) return null;
    let identity = ["session", token];
    try {
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")), char => char.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const auth = payload["https://api.openai.com/auth"] || {};
      const user = textId(auth.chatgpt_user_id) || textId(payload.sub);
      const account = textId(auth.chatgpt_account_id);
      // Claims are read only to compare sessions from the existing trusted
      // endpoint, never as authorization. Opaque/unknown tokens are compared
      // conservatively: a rotation starts a new baseline instead of alerting.
      if (user && account) identity = ["account", user, account];
    } catch { /* Opaque token: use the conservative session fingerprint. */ }
    const scope = textId(rawUsage?.account_id) || textId(rawUsage?.accountId) || "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([salt, identity, scope])));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function advance(previous, usage, key, { now = Date.now(), enabled = true, resumed = false, pollMinutes = 30 } = {}) {
    if (!key) return { accountKey: null, plan: null, windows: {}, sequence: 0, events: [] };
    const plan = usage?.plan ?? previous?.plan ?? null;
    const same = previous?.accountKey === key && previous?.plan === plan;
    const state = same ? { ...previous, windows: { ...previous.windows } } : { accountKey: key, plan, windows: {}, sequence: 0, events: [] };
    state.events = enabled ? currentEvents(state, now) : [];
    if (resumed) state.events = state.events.map(event => ({ ...event, catchUp: true }));
    for (const kind of KINDS) {
      if (usage?.invalidWindowKinds?.includes(kind)) delete state.windows[kind];
      if (state.windows[kind] && now - state.windows[kind].observedAt > MAX_GAP) delete state.windows[kind];
    }
    const recovered = [];
    for (const kind of KINDS) {
      const window = root.RadarUsage.findWindow(usage, kind);
      if (!window) continue;
      const used = window.usedPercentExact;
      if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100 ||
          (used === 0 && (usage.allowed === false || usage.limitReached || window.limitReached))) {
        delete state.windows[kind];
        continue;
      }
      const before = state.windows[kind];
      const boundaryPassed = before?.resetAt > before?.observedAt && before.resetAt <= now &&
        window.resetAt > now && window.resetAt > before.resetAt + 60000;
      // Time alone does not prove recovery: require an observed quota increase.
      if (before && before.observedAt <= now && before.used > 0 &&
          (used === 0 || (boundaryPassed && used < before.used && usage.allowed !== false &&
            !usage.limitReached && !window.limitReached))) {
        recovered.push({ kind, previousRemaining: 100 - before.used, remaining: 100 - used,
          previousObservedAt: before.observedAt,
          // A scheduled boundary can preserve Chat observations made after it.
          // For an unscheduled reset only its observation time is known.
          counterResetAt: boundaryPassed ? before.resetAt : now,
          catchUp: resumed || now - before.observedAt > Math.max(5, pollMinutes * 2) * 60000 });
      }
      state.windows[kind] = { used, observedAt: now, resetAt: window.resetAt || null };
    }
    if (recovered.length && enabled) {
      state.sequence = (state.sequence || 0) + 1;
      state.events = [...state.events, { id: `recovery:${key.slice(0, 16)}:${state.sequence}:${now}`, accountKey: key,
        observedAt: now, catchUp: recovered.some(window => window.catchUp), windows: recovered }].slice(-8);
    }
    return state;
  }

  function currentEvents(state, now = Date.now()) {
    return (state?.events || []).filter(event => event.accountKey === state.accountKey && event.windows?.length &&
      event.observedAt <= now && now - event.observedAt <= MAX_GAP);
  }

  root.RadarRecovery = Object.freeze({ accountKey, advance, currentEvents });
  if (typeof module !== "undefined") module.exports = root.RadarRecovery;
})(globalThis);
