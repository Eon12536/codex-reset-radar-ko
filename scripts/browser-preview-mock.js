(() => {
  const now = Date.now();
  const previewLanguage = new URLSearchParams(globalThis.location?.search || "").get("lang") || "en-US";
  const previewWidth = Number(new URLSearchParams(globalThis.location?.search || "").get("previewWidth"));
  const pickerState = new URLSearchParams(globalThis.location?.search || "").get("pickerState");
  if(pickerState) document.addEventListener('DOMContentLoaded',async()=>{
    await globalThis.RadarI18n.ready;
    const button=document.getElementById('popupLanguage');
    if(['hover','focus','active'].includes(pickerState)) button.classList.add('is-'+pickerState);
    if(['disabled','loading'].includes(pickerState)) button.disabled=true;
    button.dataset.state=pickerState;
  });
  if ([320, 375, 414, 768].includes(previewWidth)) document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `html, body { width: ${previewWidth}px !important; min-width: ${previewWidth}px !important; }`;
    document.head.append(style);
  });
  const meterState = new URLSearchParams(location.search).get('meterState');
  if (meterState) document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    const select = document.getElementById('chatPlanChoice'), controls = document.getElementById('chatPlanControls');
    if (!select || !controls) return;
    controls.open = true; controls.dataset.state = meterState;
    if (['hover', 'focus', 'active'].includes(meterState)) select.classList.add('is-' + meterState);
    if (meterState === 'disabled') select.disabled = true;
    if (meterState === 'error') select.setAttribute('aria-invalid', 'true');
  }, 50));
  const messages = [];
  const storageListeners = [];
  const themeQuery = new URLSearchParams(globalThis.location?.search || "").get("theme");
  const state = {
    uiLocale: localStorage.getItem("radar-preview-language") || "ko-KR",
    appearanceTheme: themeQuery || localStorage.getItem("radar-preview-appearance") || undefined,
    settings: {
      theme: themeQuery || localStorage.getItem("radar-preview-theme") || "system",
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
      updatedAt: now - 2 * 60 * 1000,
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
        url: "https://x.com/thsottiaux/status/123456789",
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
          url: "https://x.com/thsottiaux/status/123456789",
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
    adviceSnapshot: { tier: "guest", title: "旧建议", message: "中文缓存", detail: "旧数据" },
    lastCheckedAt: now - 2 * 60 * 1000,
  };

  const mode = new URLSearchParams(globalThis.location?.search || "").get("mode");
  if (mode === 'resetPolls') {
    state.settings.notifyResetHints = true;
    state.signalSnapshot = { checkedAt: now, activeSignals: [], reports: [] };
    state.hintSnapshot = { items: [
      { id: '930', text: 'To calibrate', pollOptions: ['👌 (great release)', '🫨 (needs a reset)'] },
      { id: '931', text: 'Four updates or a reset. Or both. How was day 2.' }
    ].map((post, index) => ({ ...post, author: 'thsottiaux', createdAt: new Date(now - (index + 1) * 3600000).toISOString(),
      source: { id: 'codex-lead', weight: 1 }, url: 'https://x.com/thsottiaux/status/' + post.id })) };
  }
  if (mode === 'checkTabsPaused') {
    state.directXScanTabV1GuardV1 = { blocked: true, reason: 'session-lost' };
    state.settings.monitorDirectX = true;
  }
  if (mode === 'resetUpdates') {
    const parent = { id: '2106233145163141249', author: 'thsottiaux', createdAt: new Date(now - 3600000).toISOString(),
      text: 'Seeing some reports that the Pro 500 didn’t get the reset as expected earlier. Investigating and will make up for it',
      url: 'https://x.com/thsottiaux/status/2106233145163141249', source: { id: 'codex-lead', weight: 1 } };
    const fixed = { id: '2106239435461579088', author: 'thsottiaux', createdAt: new Date(now - 1800000).toISOString(),
      text: 'All fixed. Surprising number of Pro 500 users on here.', url: 'https://x.com/thsottiaux/status/2106239435461579088',
      source: parent.source, replyContext: { ...parent, relation: 'quoted-post', targetId: '2106239435461579088' } };
    state.settings.monitorDirectX = true;
    state.signalSnapshot = { checkedAt: now, activeSignals: [], reports: [fixed, parent] };
    state.hintSnapshot = { items: [], events: [] };
    state.publicAlertState = { entries: Object.fromEntries([parent, fixed].map(post => [post.id,
      { observedAt: now - 60000, expiresAt: now + 86400000 - 60000, publishedAt: Date.parse(post.createdAt) }])) };
  }
  if (['bankedUnread', 'badgeReadError', 'bankedBaseline', 'publicUnread', 'bankedHeld'].includes(mode)) {
    const accountKey = 'a'.repeat(64);
    state.accountSnapshot.accountKey = accountKey;
    state.accountSnapshot.usage.windows.find(window => window.kind === 'weekly').remainingPercent = 40;
    state.accountSnapshot.credits.availableCount = 3;
    state.creditGrantState = { accountKey, count: 3, observedAt: now, events: ['bankedBaseline', 'publicUnread', 'bankedHeld'].includes(mode) ? [] : [{
      id: 'banked:preview:1', accountKey, added: 1, availableCount: 3, notify: true, observedAt: now - 60000
    }] };
    const post = { id: 'preview-completed', author: 'thsottiaux', createdAt: new Date(now - 3600000).toISOString(),
      text: 'Resets all propagated.', url: 'https://x.com/thsottiaux/status/2105843926221660585',
      source: { id: 'codex-lead', weight: 1 } };
    state.signalSnapshot = { checkedAt: now, activeSignals: [], reports: [post] };
    state.publicAlertState = { entries: { [post.id]: { observedAt: now - 60000, expiresAt: now - 60000 + 86400000,
      publishedAt: Date.parse(post.createdAt) } } };
    state.hintSnapshot = { items: [] };
    if (mode === 'publicUnread') state.accountSnapshot.credits = null;
    if (mode === 'bankedHeld') state.publicAlertState.entries[post.id].badgeReadAt = now;
  }
  // Browser-only regression example independently read from X on October 2.
  if (mode === 'globalReset' || mode === 'frozenFeed') {
    const post = { id: '2105843926221660585', author: 'thsottiaux', createdAt: '2026-10-02T02:14:51.000Z',
      text: "Global reset landing tomorrow 10am PST for all paid ChatGPT accounts. Apologies for the slow start with GPT-6.1 Sol, it's now back to running at expected speeds after the massive load spike in the first two days.",
      url: 'https://x.com/thsottiaux/status/2105843926221660585', source: { id: 'codex-lead', weight: 1 },
      assessment: { actionable: true, confidence: 'high', score: 8, weightedScore: 8, eventAt: null, untimedPromise: true } };
    state.settings.monitorDirectX = mode === 'globalReset';
    state.signalSnapshot = { checkedAt: now, activeSignals: mode === 'globalReset' ? [post] : [], reports: [],
      leadStatus: { state: mode === 'globalReset' ? 'ok' : 'stale', latestPostAt: mode === 'globalReset' ? Date.parse(post.createdAt) : Date.parse('2026-09-06T21:51:18Z'),
        directOk: mode === 'globalReset', collectionVerified: true,
        directScan: { posts: 1, contextPending: 0, timelines: ['posts','replies'].flatMap(kind =>
          ['thsottiaux','reach_vb','openai'].map(author => ({author,kind,ok:true,stopReason:'seven-days'}))) } } };
    state.hintSnapshot = { items: [], events: [] };
  }
  if (mode === 'bankedArrival') {
    const example = new URLSearchParams(location.search).get('arrivalState') || 'fresh';
    const accountKey = 'a'.repeat(64);
    state.accountSnapshot.accountKey = accountKey;
    state.creditGrantState = { accountKey, count: 2, observedAt: now, events: example === 'baseline' ? [] : [{
      id: 'banked:preview:1', accountKey, added: 1, availableCount: 2, notify: true,
      observedAt: now - (example === 'expired' ? 86400000 : 2 * 60000)
    }] };
    if (example === 'mismatch') state.creditGrantState.accountKey = 'b'.repeat(64);
    if (example === 'unavailable') state.accountSnapshot.credits = null;
    if (example === 'used') state.accountSnapshot.credits.availableCount = 0;
    state.signalSnapshot = { checkedAt: now, activeSignals: [], reports: [] };
    state.hintSnapshot = { items: [] };
    state.lastCheckedAt = now;
  }
  const chatMode = new URLSearchParams(globalThis.location?.search || "").get("chat");
  if (["reset", "on", "full", "pro100", "pro200", "pro200Current", "pro500", "generic", "free", "go", "plus", "enterprise", "edu", "businessStandard", "businessPremium"].includes(chatMode)) {
    state.settings.monitorChat = true;
    const basic = ['free', 'go', 'plus', 'enterprise', 'edu'].includes(chatMode);
    const plan = ["reset", "on", "full", "pro100"].includes(chatMode) ? "pro100" : chatMode === 'generic' || basic ? null : chatMode;
    const family = basic ? chatMode : chatMode.startsWith("business") ? "business" : "pro";
    const key = "a".repeat(64);
    state.chatAccount = { key, family, status: "connected", checkedAt: now };
    state.chatCounters = { [key]: { plan, planAt: now, family, events: Array.from({ length: chatMode === "full" ? 50 : basic ? 0 : 8 }, (_, index) => ({ key: index.toString(16).padStart(64, "0"), model: index < 6 ? "astra" : "sol", at: now - 60000 })) } };
    state.chatCounters[key].events.push(...Array.from({ length: 7 }, (_, i) => ({ key: (100 + i).toString(16).padStart(64, '0'), model: i < 5 ? 'solStandard' : 'luna', at: now - 60000 })));
  }
  if (chatMode === "reset") {
    const profile = state.chatCounters["a".repeat(64)];
    for (const entry of profile.events) entry.beforeCodexReset = true;
    profile.events.push(...["astra", "sol"].map((model, i) => ({ model, key: String(i + 8).repeat(64), at: now - 5000 })));
    profile.codexReset = { id: "preview-reset", at: now - 30000, effectiveAt: now - 30000, kinds: ["fiveHour", "weekly"] };
  }
  const planState = new URLSearchParams(location.search).get('planState');
  if (planState && state.chatAccount) {
    const profile = state.chatCounters[state.chatAccount.key];
    if (planState === 'cached') profile.planAt = now - 2 * 86400000;
    if (planState === 'selected') { profile.plan = null; profile.planChoice = { plan: 'pro100', at: now }; }
    if (planState === 'legacySelected') { profile.plan = 'pro200Current'; profile.planChoice = { plan: 'pro200', at: now }; }
    if (['loading', 'error'].includes(planState)) { profile.plan = null; profile.planCheck = { status: planState === 'loading' ? 'running' : 'timeout', checkedAt: now }; }
    if (planState === 'example31') profile.events = Array.from({ length: 31 }, (_, i) => ({ key: i.toString(16).padStart(64,'0'), model: 'astra', at: now - 60000 }));
  }
  const connectedPreview = structuredClone(state.accountSnapshot);
  const historyMode = new URLSearchParams(location.search).get('history');
  if (historyMode && state.chatAccount) {
    state.settings.syncChatHistory = true;
    const profile = state.chatCounters[state.chatAccount.key];
    profile.history = { status: historyMode === 'error' ? 'error' : 'partial', code: historyMode === 'error' ? 'auth' : null,
      checkedAt: now, scanned: 20, reused: 5, pending: 3, unknown: 2 };
    profile.historyEvents = [{ key: 'f'.repeat(64), model: 'astra', at: now - 30000 }];
  }
  let previewSignedIn = false;
  if (["signedOut", "error", "accessDenied", "reconnect"].includes(mode)) {
    state.accountSnapshot = null;
    state.accountState = { status: ["signedOut", "reconnect"].includes(mode) ? "signedOut" : "error", reason: mode === "accessDenied" ? "accessDenied" : "unavailable" };
    state.signalSnapshot = { checkedAt: now, activeSignals: [] };
    if (mode === "error") state.signalError = "Preview connection error";
  }

  // Synthetic UI fixtures only; these are not historical posts or live signals.
  const hintExamples = {
    productTime: "3am on a tuesday",
    hint: "Maybe we should dust off the reset button tomorrow.",
    rhetorical: "Who says Codex limits won't reset in a while?",
    qualified: "Codex will reset soon, but not today.",
    celebration: "We already pressed the reset button today. This celebration is moved to tomorrow."
  };
  if (hintExamples[mode]) {
    state.signalSnapshot = { checkedAt: now, activeSignals: [] };
    state.hintSnapshot = { items: [{ id: "123456789", text: hintExamples[mode], author: "thsottiaux", createdAt: new Date(now - 20 * 60000).toISOString(), source: { id: "codex-lead", weight: 1 }, url: "https://x.com/thsottiaux/status/123456789" }] };
  }
  if (mode === "productTime") state.hintSnapshot.items[0].replyContext = {
    id: "123456788", author: "My_Ai_Bi", text: "the GPT-6 Community Night was 🔥",
    url: "https://x.com/My_Ai_Bi/status/123456788", relation: "conversation-before", targetId: "123456789"
  };
  if (['latestNews', 'partialX', 'reportError', 'launchNews', 'eventBanners'].includes(mode)) {
    state.settings.monitorDirectX = true;
    const example = (text, id, age) => ({ id, text, author: 'thsottiaux', createdAt: new Date(now - age).toISOString(),
      source: { id: 'codex-lead', weight: 1 }, url: `https://x.com/thsottiaux/status/${id}` });
    state.signalSnapshot = { checkedAt: now, activeSignals: [], reports: [
      example('We are loading a banked reset into all accounts of our Plus, Pro and Business users.', '301', 3600000),
      example('Resets all propagated. That will be all. Have a fantastic weekend.', '302', 7200000),
      { ...example('Reset should be reflected for everyone - happy weekend!!', '304', 1800000), author: 'reach_vb', url: 'https://x.com/reach_vb/status/304' }],
      leadStatus: { state: 'ok', latestPostAt: now - 1800000, directEnabled: true, directOk: true,
        directScan: { posts: 18, contexts: 1, conversations: 2, pages: 12, timelines: [{ author: 'thsottiaux', kind: 'posts', ok: true, posts: 5 },
          { author: 'reach_vb', kind: 'posts', ok: true, posts: 3 }, { author: 'openai', kind: 'posts', ok: true, posts: 2 }, { author: 'openai', kind: 'replies', ok: true, posts: 1 }, { author: 'reach_vb', kind: 'replies', ok: true, posts: 4 },
          { author: 'thsottiaux', kind: 'replies', ok: mode !== 'partialX', posts: 6, ...(mode === 'partialX' ? { error: 'timeout', stage: 'reading' } : {}) }] } } };
    state.hintSnapshot = { items: [example('Burn those tokens', '303', 10800000)] };
    if (['launchNews', 'eventBanners'].includes(mode)) {
      const photos = { thsottiaux: 'https://pbs.twimg.com/profile_images/2093807917833281537/2yBgpwVV_normal.jpg',
        reach_vb: 'https://pbs.twimg.com/profile_images/1509901130670747666/JFlrSzB4_normal.jpg',
        OpenAI: 'https://pbs.twimg.com/profile_images/1885410181409820672/ztsaR0JW_normal.jpg' };
      state.hintSnapshot.items = [
        { ...example('Join us for OpenAI DevDay tomorrow at 10am PT. New tools, live demos and a look at what is coming next.', '305', 600000), author: 'OpenAI', url: 'https://x.com/OpenAI/status/305' },
        example("Can't wait for DevDay next Tuesday. Some really fun stuff, but also many many things that should change the way you work.", '306', 1200000),
        { ...example('A new ChatGPT model is coming tomorrow. Stay tuned 👀', '307', 2400000), author: 'reach_vb', url: 'https://x.com/reach_vb/status/307' },
        example('Something new is coming soon.', '308', 2800000)
      ];
      for (const item of [...state.hintSnapshot.items, ...state.signalSnapshot.reports]) item.avatarUrl = new URLSearchParams(location.search).get('avatars') === 'missing' ? '' : photos[item.author];
    }
    if (mode === 'eventBanners') {
      const params = new URLSearchParams(location.search);
      state.hintSnapshot.events = [];
      const eventPost = example('DevDay, 29th September 2026!', '909', 10 * 86400000);
      eventPost.author = 'reach_vb'; eventPost.url = 'https://x.com/reach_vb/status/909';
      state.hintSnapshot.events.push(eventPost);
      state.hintSnapshot.items = [];
      if (params.get('eventState') === 'grouped') {
        state.hintSnapshot.events.push(
          { ...example('See you at DevDay September 29, 2026 at 10am PT!', '911', 60000), author: 'OpenAI', url: 'https://x.com/OpenAI/status/911' },
          example('DevDay on September 29, 2026. Bring your ideas!', '912', 120000));
        state.hintSnapshot.items = [example('DevDay will be fun!', '913', 30000), example('DevDay is exciting. Burn those tokens', '914', 90000)];
      }
      if (params.get('eventState') === 'noEventTweet') {
        state.hintSnapshot.events = [];
        state.signalSnapshot.leadStatus.directScan = null;
      }
      if (params.get('eventState') === 'empty') {
        state.hintSnapshot.events = [];
        state.signalSnapshot.reports = [];
      }
      if (params.get('eventState') === 'unknown') {
        eventPost.text = 'OpenAI livestream on ' + new Date(now + 3 * 86400000).toISOString().slice(0,10) + ' at 10am PT.';
      }
      if (params.get('eventState') === 'expired') {
        eventPost.text = 'OpenAI livestream on ' + new Date(now - 86400000).toISOString().slice(0,10) + ' from 10am to 11am KST.';
      }
      if (params.get('eventState') === 'multiple') state.hintSnapshot.events.push({ ...example('Developer conference on ' + new Date(now + 4 * 86400000).toISOString().slice(0,10) + ' from 10am to 5pm PT.', '910', 9 * 86400000), author: 'OpenAI', url: 'https://x.com/OpenAI/status/910' });
    }
    if (mode === 'reportError') state.signalError = 'Example collection failure';
  }
  if (["newsList", "newsLinkError", "newsStates", "longNews", "newsZones"].includes(mode)) {
    const examples = ['3am on a tuesday', 'OK fine. But it’s also still coming in Tuesday',
      'Maybe we should dust off the reset button tomorrow.', 'Codex could get a fresh start tomorrow.',
      'Time to refuel Codex soon.'];
    if (mode === 'newsZones') {
      examples.splice(0, examples.length, '3am on a tuesday', 'Tuesday at 6:30 PM', 'Wednesday at 10am UTC', 'OK fine. But it’s also still coming in Tuesday');
      state.signalSnapshot = { checkedAt: now, activeSignals: [] };
    }
    if (mode === "newsStates") {
      examples.push(examples[0], examples[2], examples[3]);
      state.signalSnapshot = { checkedAt: now, activeSignals: [] };
    }
    if (mode === "longNews") examples[0] = 'Codex could get a fresh start tomorrow. ' + 'A longer public post with detailed context. '.repeat(30);
    state.hintSnapshot = { items: examples.map((text, i) => ({ id: String(200 + i), text, author: 'thsottiaux',
      createdAt: new Date(now - (i + 1) * 60000).toISOString(), source: { id: 'codex-lead', weight: 1 },
      url: `https://x.com/thsottiaux/status/${200 + i}`,
      ...((mode === 'newsZones' ? i === 3 : i === 1) ? { replyContext: { id: '199', text: 'you owe us a banked reset',
        url: 'https://x.com/example/status/199', relation: 'conversation-before', targetId: String(200 + i) } } : {}) })) };
    if (mode === "newsStates") document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
      const names = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success'];
      document.querySelectorAll('.news-link').forEach((button, i) => {
        const state = names[i]; button.textContent = state + ' · 원문 보기 ↗';
        if (['hover', 'focus', 'active'].includes(state)) button.classList.add('is-' + state);
        if (['disabled', 'loading'].includes(state)) button.disabled = true;
        button.dataset.state = state;
      });
    }, 100));
  }
  if (mode === "replyHint") {
    state.settings.monitorDirectX = true;
    state.settings.notifyHints = false;
    state.signalSnapshot = { checkedAt: now, activeSignals: [], leadStatus: { state: "ok", directOk: true, latestPostAt: now - 3600000 } };
    state.hintSnapshot = { items: [{ id: "123456789", text: "OK fine. But it’s also still coming in Tuesday", author: "thsottiaux",
      createdAt: new Date(now - 3600000).toISOString(), source: { id: "codex-lead", weight: 1 }, url: "https://x.com/thsottiaux/status/123456789",
      replyContext: { id: "123456788", author: "udiWertheimer", text: "you owe us a banked reset", url: "https://x.com/udiWertheimer/status/123456788", relation: "conversation-before", targetId: "123456789" } }] };
    state.settings.monitorDirectX = true;
    state.signalSnapshot.leadStatus = { state: "ok", latestPostAt: now - 3600000, directEnabled: true, directOk: true,
      directScan: { posts: 18, conversations: 3, contexts: 1, conversationFailures: 0, pages: 12, stopReason: "scan-limit" } };
  }
  if (mode === "xLoginNeeded") {
    state.settings.monitorDirectX = true;
    state.signalSnapshot.leadStatus = { state: "stale", latestPostAt: now - 14 * 86400000, directEnabled: true, directOk: false, directError: "login" };
  }
  if (mode === "staleFeed") state.signalSnapshot = { checkedAt: now, activeSignals: [], leadStatus: { state: "stale", directOk: false, latestPostAt: now - 14 * 86400000 } };
  if (mode === "alloff") { state.settings.monitorSignals = false; state.settings.monitorAccount = false; }
  if (mode === "full") for (const window of state.accountSnapshot.usage.windows) window.remainingPercent = 100;
  if (mode === "partial") {
    state.accountSnapshot.usage.windows = state.accountSnapshot.usage.windows.filter(window => window.kind === "weekly");
    state.accountSnapshot.usage.windows[0].remainingPercent = 36;
    state.signalSnapshot = { checkedAt: now, activeSignals: [] };
  }
  if (mode === "off") state.settings.monitorAccount = false;
  if (mode === "delay" || mode === "delayInferred") {
    const inferred = mode === "delayInferred";
    const original = { id: "123456789", text: inferred ? "new milestone to celebrate tomorrow" : "We will reset Codex usage limits later today.",
      createdAt: new Date(now - 3 * 3600000).toISOString(), author: "thsottiaux", source: { id: "codex-lead", weight: 1 }, url: "https://x.com/thsottiaux/status/123456789" };
    const post = { ...original, id: "123456790", text: inferred ? "This celebration is moved to tomorrow" : "The Codex reset is postponed until tomorrow. The new time is not confirmed yet.",
      createdAt: new Date(now - 15 * 60000).toISOString(), url: "https://x.com/thsottiaux/status/123456790", inReplyToId: inferred ? null : original.id };
    state.signalSnapshot = { checkedAt: now, activeSignals: [] };
    state.scheduleSnapshot = { events: [{ original, kind: inferred ? "hint" : "signal", updates: [{ post, previous: original, association: inferred ? "inferred" : "reference", detectedAt: now }] }] };
  }
  if (mode === "badlink") state.signalSnapshot.signal.url = "https://audit-phishing.invalid/sign-in";

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
      getMessage: () => previewLanguage.startsWith("zh") ? "中文消息" : "",
    },
    storage: {
      local: {
        get: async (keys) => selectKeys(keys),
        set: async (value) => {
          if (mode === "languageError" && Object.hasOwn(value, "uiLocale")) throw new Error("Preview language save failed");
          if (mode === "themeError" && Object.hasOwn(value, "appearanceTheme")) throw new Error("Preview storage write failed");
          const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, {oldValue:state[key],newValue}]));
          Object.assign(state, value);
          if (Object.hasOwn(value, "uiLocale")) localStorage.setItem("radar-preview-language", value.uiLocale);
          if (Object.hasOwn(value, "appearanceTheme")) localStorage.setItem("radar-preview-appearance", value.appearanceTheme);
          storageListeners.forEach(listener => listener(changes, "local"));
        },
        clear: async () => {
          for (const key of Object.keys(state)) delete state[key];
        },
      },
      session: {
        clear: async () => {},
      },
      onChanged: {
        addListener: listener => storageListeners.push(listener),
      },
    },
    runtime: {
      getURL: path => `/${path}`,
      openOptionsPage: async () => { location.href = `/src/options/options.html?lang=${encodeURIComponent(previewLanguage)}`; },
      sendMessage: async (message) => {
        messages.push(message);
        if (message?.type === 'RESUME_CHECK_TABS' && message.confirmed === true) {
          delete state.directXScanTabV1GuardV1; delete state.chatPlanScanTabV1GuardV1;
          storageListeners.forEach(listener => listener({ directXScanTabV1GuardV1: { newValue: undefined } }, 'local'));
          return { ok: true };
        }
        if (mode === "workerUnavailable") throw new Error("Preview: background worker unavailable");
        if (message?.type === 'ACK_VISIBLE_BADGES') {
          if (mode === 'badgeReadError') return { ok: false };
          const updates = RadarBadge.acknowledge(state, RadarSettings.sanitize(state.settings), message.receipt);
          Object.assign(state, updates);
          storageListeners.forEach(listener => listener(Object.fromEntries(Object.keys(updates)
            .map(key => [key, { newValue: updates[key] }])), 'local'));
          return { ok: true };
        }
        if (message?.type === "OPEN_ACCOUNT_LOGIN") {
          previewSignedIn = true; // UI fixture only: never open or authenticate a real account.
          return { ok: true };
        }
        if (message?.type === 'REFRESH_CHAT_ACCOUNT') {
          if (state.settings.monitorChat && state.chatAccount?.status === 'connected') {
            state.chatAccount.checkedAt = Date.now();
            storageListeners.forEach(listener => listener({ chatAccount: { newValue: state.chatAccount } }, 'local'));
          }
          return { ok: true };
        }
        if (["ENABLE_CHAT_COUNTER", "OPEN_CHAT_CONNECTION"].includes(message?.type)) {
          if (chatMode === "error") return { ok: false };
          state.settings.monitorChat = true;
          state.chatAccount = { key: "a".repeat(64), family: "pro", status: "connected", checkedAt: now };
          return { ok: true };
        }
        if (message?.type === 'SET_CHAT_PLAN_CHOICE') {
          if (mode === 'planError' || message.accountKey !== state.chatAccount?.key) return { ok: false };
          const plan = globalThis.RadarChatCounter.currentPlan(message.plan);
          if (plan !== 'auto' && globalThis.RadarChatCounter.PLANS[plan]?.family !== state.chatAccount.family) return { ok: false };
          const profile = state.chatCounters[message.accountKey];
          const changed = () => storageListeners.forEach(listener => listener({ chatCounters: { newValue: state.chatCounters } }, 'local'));
          if (plan === 'auto') {
            if (globalThis.RadarChatCounter.PLANS[state.chatAccount.family]?.family === state.chatAccount.family) {
              profile.planChoice = null; profile.planCheck = null; changed(); return { ok: true };
            }
            profile.planCheck = { status: 'running', checkedAt: Date.now() }; changed();
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (mode === 'planAutoFailure') {
              profile.planCheck = { status: 'failed', checkedAt: Date.now() }; changed();
              return { ok: false, code: 'plan-check-failed', preserved: Boolean(profile.planChoice || profile.plan) };
            }
            profile.plan = state.chatAccount.family === 'business' ? 'businessStandard' : 'pro100'; profile.planAt = Date.now(); profile.planChoice = null;
            profile.planCheck = { status: 'confirmed', checkedAt: Date.now() };
          } else {
            profile.planChoice = { plan, at: Date.now() }; profile.planCheck = null;
          }
          changed();
          return { ok: true };
        }
        if (message?.type === "ENABLE_ACCOUNT") {
          state.settings.monitorAccount = true;
          return { ok: true };
        }
        if (message?.type === 'SYNC_CHAT_HISTORY') {
          const profile = state.chatCounters?.[state.chatAccount?.key];
          if (profile) profile.history = { status: 'synced', checkedAt: Date.now(), scanned: 3, reused: 25, pending: 0, unknown: 2 };
          storageListeners.forEach(listener => listener({ chatCounters: { newValue: state.chatCounters } }, 'local'));
          return { ok: true };
        }
        if (message?.type === "REFRESH_SIGNALS") return { ok: true, leadVerified: mode !== "staleFeed" };
        if (message?.type === "NOTIFICATION_STATUS") return { ok: true, version: mode === "oldWorker" ? "0.2.18" : "0.2.79", permission: "granted", hintAlerts: Boolean(state.settings.notifyHints), resetHintAlerts: state.settings.notifyResetHints !== false, pending: 0, quiet: false, realDelivery: { status: "accepted", at: Date.now() - 3600000, test: false }, publicAlerts: { pending: 0, handled: 3, expired: 7, disabled: 2, eligible: 0 } };
        if (message?.type === "TEST_NOTIFICATION") {
          if (mode === "notificationTimeout") return new Promise(() => {});
          return { version: mode === "oldWorker" ? "0.2.18" : "0.2.79", ...(mode === "notificationImageError" ? { ok: false, reason: "image" } : { ok: true }) };
        }
        if (["REFRESH_ACCOUNT", "REFRESH_NOW"].includes(message?.type)) {
          if (mode === "reconnect" && previewSignedIn) {
            state.accountSnapshot = connectedPreview;
            state.accountState = { status: "connected" };
            storageListeners.forEach(listener => listener({ accountSnapshot: { newValue: connectedPreview }, accountState: { newValue: state.accountState } }, "local"));
          }
          const account = !state.settings.monitorAccount ? { ok: true, skipped: true }
            : state.accountState?.status === "signedOut" ? { ok: false, reason: "signedOut" }
            : state.accountState?.status === "error" ? { ok: false, reason: state.accountState.reason || "unavailable" } : { ok: true };
          return message.type === "REFRESH_ACCOUNT" ? account : { ok: true, account, signals: { ok: true } };
        }
        if (message?.type === "SAVE_THEME") {
          if (mode === "themeError") return { ok: false };
          const oldValue = state.settings;
          state.settings = { ...state.settings, theme: message.theme };
          localStorage.setItem("radar-preview-theme", state.settings.theme);
          storageListeners.forEach(listener => listener({settings:{oldValue,newValue:state.settings}}, "local"));
          return { ok: true, settings: state.settings };
        }
        if (message?.type === 'OPEN_NEWS') return { ok: mode !== 'newsLinkError' };
        if (message?.type === "SAVE_SETTINGS") {
          const oldValue = state.settings;
          state.settings = { ...state.settings, ...message.settings };
          if (!state.settings.monitorChat) { delete state.chatCounters; delete state.chatAccount; }
          localStorage.setItem("radar-preview-theme", state.settings.theme);
          storageListeners.forEach(listener => listener({settings:{oldValue,newValue:state.settings}}, "local"));
          return { ok: true, settings: state.settings };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => chatMode !== "denied" },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ ok: true }),
      create: async () => ({ id: 2 }),
    },
  };
  globalThis.__radarPreview = { state, messages };
  // Mirror the extension's cross-page settings event for local theme QA only.
  addEventListener("storage", event => {
    if (event.key === "radar-preview-appearance") {
      const oldValue = state.appearanceTheme;
      state.appearanceTheme = event.newValue;
      storageListeners.forEach(listener => listener({appearanceTheme:{oldValue,newValue:event.newValue}}, "local"));
      return;
    }
    if (event.key !== "radar-preview-theme") return;
    const oldValue = state.settings;
    state.settings = { ...state.settings, theme: event.newValue || "system" };
    storageListeners.forEach(listener => listener({settings:{oldValue,newValue:state.settings}}, "local"));
  });
})();
