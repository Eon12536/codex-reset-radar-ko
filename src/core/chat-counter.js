(function initChatCounter(root) {
  const WEEK = 7 * 86400000;
  const DAY = 86400000;
  // Numeric estimates use the dated 2026-09-27 reference. The 2026-10-02
  // Pro-tier change makes a price or usage multiplier insufficient evidence
  // of the legacy Pro 200 Chat allowance.
  const PLANS = Object.freeze({
    free: { label: 'Free', family: 'free' },
    go: { label: 'Go', family: 'go' },
    plus: { label: 'Plus', family: 'plus' },
    pro100: { label: 'Pro $100 · 5x', family: 'pro', shared: 50, days: 7 },
    // Retained only for historical reference; never offered as a current plan.
    pro200: { label: 'Pro $200 · 9/27', family: 'pro', retired: true, astraWeekly: 200, solDaily: 170, combinedDaily: 200 },
    pro200Current: { label: 'Pro $200', family: 'pro' },
    pro500: { label: 'Pro $500', family: 'pro' },
    businessStandard: { label: 'Business Standard', family: 'business', shared: 15, days: 30 },
    businessPremium: { label: 'Business Premium', family: 'business', shared: 50, days: 7 },
    enterprise: { label: 'Enterprise', family: 'enterprise' },
    edu: { label: 'Edu', family: 'edu' }
  });
  const POLICY = Object.freeze({ checkedAt: '2026-09-27', reviewedAt: '2026-10-02',
    url: 'https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt',
    tiersUrl: 'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers' });
  // Explicit Chat model metadata only. New aliases belong here; never infer a
  // paid Pro response from a generic model name or the requested model alone.
  const MODELS = Object.freeze({
    astra: { label: 'Astra', pro: true, slugs: ['gpt-6-pro'] },
    sol: { label: 'Sol Pro', pro: true, slugs: ['gpt-5.6-pro', 'gpt-5-6-pro', 'gpt-5.6-sol-pro', 'gpt-5-6-sol-pro'] },
    solStandard: { label: 'Sol 일반', pro: false, slugs: ['gpt-5.6', 'gpt-5-6', 'gpt-5.6-sol', 'gpt-5-6-sol', 'gpt-5.6-thinking', 'gpt-5-6-thinking'] },
    luna: { label: 'Luna', pro: false, slugs: ['gpt-5.6-luna', 'gpt-5-6-luna'] }
  });
  function family(value) {
    return ({ free: 'free', go: 'go', plus: 'plus', pro: 'pro', team: 'business', business: 'business', enterprise: 'enterprise', edu: 'edu' })[String(value).toLowerCase()] || 'unknown';
  }
  function planFromHeading(text) {
    const value = String(text || '').trim().replace(/\s+/g, ' ');
    return ({ 'chatgpt pro 5x': 'pro100', 'chatgpt pro $100': 'pro100', 'chatgpt pro 100': 'pro100',
      'chatgpt pro 20x': 'pro200Current', 'chatgpt pro $200': 'pro200Current', 'chatgpt pro 200': 'pro200Current',
      'chatgpt pro $500': 'pro500', 'chatgpt pro 500': 'pro500', 'chatgpt business standard': 'businessStandard',
      'chatgpt business premium': 'businessPremium' })[value.toLowerCase()] || null;
  }
  function identity(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')), char => char.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const auth = payload['https://api.openai.com/auth'] || {};
      const user = auth.chatgpt_user_id || payload.sub, account = auth.chatgpt_account_id;
      if (![user, account].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)) return null;
      return { family: family(auth.chatgpt_plan_type), user, account };
    } catch { return null; }
  }
  function currentPlan(id) {
    return id === 'pro200' ? 'pro200Current' : id;
  }
  function verifiedPlan(profile, accountFamily, now = Date.now()) {
    const id = currentPlan(profile?.plan);
    const plan = PLANS[id];
    return plan && plan.family === accountFamily && profile.planAt <= now && now - profile.planAt < DAY ? id : null;
  }
  function planEvidence(profile, accountFamily, now = Date.now()) {
    const choice = profile?.planChoice;
    if (PLANS[choice?.plan]?.family === accountFamily && choice.at <= now && now - choice.at < 30 * DAY &&
        choice.at >= (profile?.planAt || 0)) return { plan: currentPlan(choice.plan), source: 'selected', at: choice.at };
    const fresh = verifiedPlan(profile, accountFamily, now);
    if (fresh) return { plan: fresh, source: 'verified', at: profile.planAt };
    if (PLANS[profile?.plan]?.family === accountFamily && profile.planAt <= now && now - profile.planAt < WEEK)
      return { plan: currentPlan(profile.plan), source: 'cached', at: profile.planAt };
    if (PLANS[accountFamily]?.family === accountFamily)
      return { plan: accountFamily, source: 'account', at: null };
    return { plan: null, source: null, at: null };
  }
  function meters(count, plan) {
    const policy = PLANS[plan];
    if (!policy || !policy.shared && !policy.astraWeekly) return [];
    const row = (id, label, remaining, limit, days) => ({ id, label, remaining, limit, days,
      percent: Math.round(Math.max(0, Math.min(1, remaining / limit)) * 100) });
    return policy.shared ? [row('shared', 'Astra + Sol Pro', count.remaining, policy.shared, policy.days)] : [
      row('astra', 'Astra', count.astraRemaining, policy.astraWeekly, 7),
      row('sol', 'Sol Pro', count.solRemaining, policy.solDaily, 1)
    ];
  }
  function model(slug, { family: planFamily, product, effort } = {}) {
    if (product && !['chat', 'chatgpt', 'conversation', 'standard', 'primary_assistant'].includes(product)) return null;
    if (['gpt-5.6-instant', 'gpt-5-6-instant'].includes(slug)) {
      return ['free', 'go'].includes(planFamily) ? 'luna' : ['plus', 'pro', 'business', 'enterprise', 'edu'].includes(planFamily) ? 'solStandard' : null;
    }
    const found = Object.entries(MODELS).find(([, info]) => info.slugs.includes(slug))?.[0] || null;
    return found === 'solStandard' && effort === 'pro' ? 'sol' : found;
  }
  function chatUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://chatgpt.com' && !url.username && !url.password &&
        (url.pathname === '/' || /^\/c\/[a-zA-Z0-9-]+\/?$/.test(url.pathname));
    } catch { return false; }
  }
  function events(state, now = Date.now()) {
    return (Array.isArray(state?.events) ? state.events : []).filter(event =>
      Object.hasOwn(MODELS, event?.model) && /^[a-f0-9]{64}$/.test(event.key) &&
      Number.isFinite(event.at) && event.at <= now && event.at > now - 30 * DAY).slice(-2000);
  }
  function record(state, entry, now = Date.now()) {
    const kept = events(state, now);
    if (!kept.some(event => event.key === entry.key)) kept.push({ key: entry.key, model: entry.model, at: now });
    return { ...state, startedAt: state?.startedAt || now, updatedAt: now, events: events({ events: kept }, now) };
  }
  function mergedEvents(state, now, syncWithCodex = true) {
    const merged = new Map(events(state, now).map(event => [event.key, event]));
    // The account record replaces the local observation's time; IDs deduplicate
    // the same response across devices, imports and repeated scans.
    for (const event of events({ events: state?.historyEvents }, now)) merged.set(event.key, {
      ...event, beforeCodexReset: event.at <= (state?.codexReset?.effectiveAt || 0)
    });
    return [...merged.values()].filter(event => !syncWithCodex || !event.beforeCodexReset);
  }
  function modelCounts(state, now = Date.now(), syncWithCodex = true) {
    const kept = mergedEvents(state, now, syncWithCodex).filter(event => event.at > now - WEEK);
    return Object.fromEntries(Object.keys(MODELS).map(model => [model, kept.filter(event => event.model === model).length]));
  }
  function summary(state, planId = null, now = Date.now(), syncWithCodex = true) {
    const kept = mergedEvents(state, now, syncWithCodex);
    const policy = PLANS[planId];
    const days = policy?.days || 7;
    const count = (kind, window) => kept.filter(event => (kind ? event.model === kind : MODELS[event.model]?.pro) && event.at > now - window).length;
    const astra = count('astra', days * DAY), sol = count('sol', days * DAY);
    const result = { astra, sol, used: astra + sol, days, remaining: null, limit: null };
    if (policy?.shared) return { ...result, remaining: Math.max(0, policy.shared - result.used), limit: policy.shared };
    if (policy?.astraWeekly) {
      const combinedLeft = Math.max(0, policy.combinedDaily - count(null, DAY));
      return { ...result, sol: count('sol', DAY), used: astra + count('sol', DAY),
        astraRemaining: Math.min(combinedLeft, Math.max(0, policy.astraWeekly - count('astra', WEEK))),
        solRemaining: Math.min(combinedLeft, Math.max(0, policy.solDaily - count('sol', DAY))) };
    }
    return result;
  }
  function resetAfterCodex(state, recovery, now = Date.now()) {
    if (!state || !recovery?.id || recovery.id === state.codexReset?.id ||
        !Number.isFinite(recovery.observedAt) || recovery.observedAt > now ||
        recovery.observedAt < (state.codexReset?.at || 0)) return state;
    const windows = (recovery.windows || []).filter(window =>
      ['fiveHour', 'weekly'].includes(window.kind) && Number.isFinite(window.counterResetAt) &&
      window.counterResetAt > 0 && window.counterResetAt <= recovery.observedAt);
    if (!windows.length) return state;
    const effectiveAt = Math.max(...windows.map(window => window.counterResetAt));
    return { ...state, updatedAt: now,
      // Keep bounded hashes to reject delayed duplicates, but exclude these
      // observations from the new local cycle. This is not proof of a Chat reset.
      events: events(state, now).map(event => event.at <= effectiveAt ? { ...event, beforeCodexReset: true } : event),
      codexReset: { id: recovery.id, at: recovery.observedAt, effectiveAt,
        kinds: [...new Set(windows.map(window => window.kind))] }
    };
  }
  function view(data, now = Date.now()) {
    const account = data.chatAccount;
    const connected = data.settings?.monitorChat && account?.status === 'connected' && account.checkedAt <= now && now - account.checkedAt < 5 * 60000;
    const profile = connected ? data.chatCounters?.[account.key] : null;
    const evidence = connected ? planEvidence(profile, account.family, now) : { plan: null, source: null, at: null };
    const plan = evidence.plan;
    const label = plan ? PLANS[plan].label : ({ pro: 'Pro · 세부 요금제 미확인', business: 'Business · 세부 요금제 미확인',
      plus: 'Plus', free: 'Free', go: 'Go', enterprise: 'Enterprise', edu: 'Edu' })[account?.family] || '요금제 미확인';
    const linked = Boolean(data.settings?.syncChatResetWithCodex);
    const planCheck = profile?.planCheck;
    const count = summary(profile, plan, now, linked);
    return { connected: Boolean(connected), plan, label, count, meters: meters(count, plan),
      accountKey: connected ? account.key : null, planSource: evidence.source, planCheckedAt: evidence.at,
      modelCounts: modelCounts(profile, now, linked), family: account?.family || 'unknown',
      codexReset: linked ? profile?.codexReset || null : null,
      planCheck: planCheck?.status === 'running' && now - planCheck.checkedAt > 60000
        ? { ...planCheck, status: 'timeout' } : planCheck || null,
      history: profile?.history || null };
  }
  // Only a local send followed by a newly inserted user turn may arm a count.
  // Opening old conversations, paginating history, and replaying streamed DOM do not count.
  function tracker() {
    let seen = new Set(), path = '', pending = null;
    function baseline(rows) { for (const row of rows) if (row.id) seen.add(row.id); }
    return {
      arm(rows, nextPath, now) { path = nextPath; baseline(rows); pending = { at: now, user: null }; },
      reset(rows, nextPath) { seen = new Set(); baseline(rows); path = nextPath; pending = null; },
      scan(rows, nextPath, now, planFamily) {
        if (path !== nextPath && !(pending && path === '/' && /^\/c\//.test(nextPath))) {
          this.reset(rows, nextPath); return [];
        }
        path = nextPath;
        if (pending && now - pending.at > 15 * 60000) pending = null;
        const found = [];
        let afterUser = false;
        for (const row of rows) {
          if (!row.id) continue;
          if (pending && row.role === 'user' && !seen.has(row.id)) pending.user = row.id;
          if (pending?.user === row.id) afterUser = true;
          if (row.role === 'assistant' && !seen.has(row.id) && pending?.user && afterUser) {
            // Model metadata can arrive in a later mutation while the answer streams.
            if (!row.slug) continue;
            if (model(row.slug, { family: planFamily })) found.push({ id: row.id, model: row.slug });
            pending = null;
          }
          seen.add(row.id);
        }
        if (seen.size > 10000) seen = new Set(rows.map(row => row.id).filter(Boolean));
        return found;
      }
    };
  }
  root.RadarChatCounter = Object.freeze({ PLANS, MODELS, POLICY, family, planFromHeading, identity, currentPlan, verifiedPlan, planEvidence, meters, model, modelCounts, chatUrl, record, summary, resetAfterCodex, view, tracker });
  if (typeof module !== 'undefined') module.exports = root.RadarChatCounter;
})(globalThis);
