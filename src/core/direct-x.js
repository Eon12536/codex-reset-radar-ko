(function initDirectX(root) {
  const URL = "https://x.com/thsottiaux/with_replies";
  const POST_URL = "https://x.com/thsottiaux";
  const AUTHORS = ['thsottiaux', 'reach_vb', 'openai'];
  const trusted = author => AUTHORS.includes(String(author || '').toLowerCase());
  const PERMISSION = { permissions: ["scripting"], origins: ["https://x.com/*"] };
  const CLEANUP_ALARM = 'codex-reset-radar-x-tab-cleanup';
  const scanUrl = value => typeof value === 'string' && /^https:\/\/x\.com\/(?:(?:thsottiaux|reach_vb|OpenAI)(?:\/with_replies|\/status\/[1-9]\d{0,24})?|codex_resets\/status\/[1-9]\d{0,24})$/i.test(value);
  function wrapperRedirect(actual, requested, marked) {
    try {
      const url = new globalThis.URL(actual), from = new globalThis.URL(requested);
      const id = /^\/thsottiaux\/status\/([1-9]\d{0,24})$/i.exec(from.pathname)?.[1];
      return id && url.origin === 'https://x.com' && !url.username && !url.password && !url.search &&
        (!url.hash || url.hash === new globalThis.URL(marked).hash) &&
        url.pathname.replace(/\/$/, '').toLowerCase() === '/codex_resets/status/' + id
        ? 'https://x.com/codex_resets/status/' + id : null;
    } catch { return null; }
  }
  function sameReaderPage(actual, expected) {
    try {
      const current = new globalThis.URL(actual), requested = new globalThis.URL(expected);
      // Account casing and a terminal slash do not change the public page.
      // Keep the nonce, query, origin and route identity exact so this cannot
      // authorize reading a different page after a user navigation.
      return current.origin === 'https://x.com' && !current.username && !current.password &&
        current.origin === requested.origin && current.search === requested.search && current.hash === requested.hash &&
        current.pathname.replace(/\/$/, '').toLowerCase() === requested.pathname.replace(/\/$/, '').toLowerCase();
    } catch { return false; }
  }
  function ownedUrl(value, urls) {
    if (value === 'about:blank') return true;
    try {
      const url = new globalThis.URL(value);
      if (url.origin !== 'https://x.com' || url.username || url.password) return false;
      const path = url.pathname.replace(/\/$/, '').toLowerCase();
      return ['/home', '/i/timeline', '/i/flow/login'].includes(path) ||
        urls.some(requested => new globalThis.URL(requested).pathname.toLowerCase() === path);
    } catch { return false; }
  }
  function readerRedirect(value, urls) {
    try {
      const actual = new globalThis.URL(value);
      if (actual.origin !== 'https://x.com' || actual.username || actual.password || actual.search || actual.hash) return false;
      const result = /^\/codex_resets\/status\/([1-9]\d{0,24})\/?$/i.exec(actual.pathname);
      return Boolean(result && urls.some(requested => {
        const url = new globalThis.URL(requested);
        return url.origin === 'https://x.com' && !url.search && !url.hash &&
          url.pathname.toLowerCase() === '/thsottiaux/status/' + result[1];
      }));
    } catch { return false; }
  }
  const TabOwner = root.RadarTabOwner || (typeof require === 'function' ? require('./tab-owner') : null);
  const owner = TabOwner.create({ key: 'directXScanTabV1', alarm: CLEANUP_ALARM, accepts: scanUrl, matches: ownedUrl, prefix: 'X',
    closeSelectedReader: true, sameReaderPage, readerRedirect,
    recovery: { marker: 'radar-x-reader', permission: PERMISSION, urls: AUTHORS.flatMap(author =>
      ['https://x.com/' + author, 'https://x.com/' + author + '/with_replies', 'https://x.com/' + author + '/status/*'])
      .concat(['https://x.com/OpenAI', 'https://x.com/OpenAI/with_replies', 'https://x.com/OpenAI/status/*', 'https://x.com/codex_resets/status/*', 'https://x.com/home', 'https://x.com/i/timeline', 'https://x.com/i/flow/login*']) } });
  let readJob, readHistoryOnly = false, historyAbort;
  const day = 86400000;
  const CONTEXT_SCHEMA = '2:' + (root.chrome?.runtime?.getManifest?.()?.version || 'local');
  const resetContext = text => /\b(?:banked resets?|reset credits?|codex.{0,60}(?:reset|limits?|quota)|(?:reset|limits?|quota).{0,60}codex|(?:usage|weekly|rate) limits?.{0,40}reset)\b/i.test(text || "");
  const publicContext = text => resetContext(text) ||
    (root.RadarSignals || (typeof require === 'function' ? require('./signals') : null))?.resetHeadline(text) ||
    /\b(?:that(?:'|’)s|that is) (?:a |another |the )?reset\b/i.test(text || '') ||
    /\b(?:dev\s?day|developer conference|codex|chatgpt|openai|sora|gpt[- ]?\d[\w.-]*|reset\s+day\s+today|today\s+is\s+reset\s+day)\b/i.test(text || "");
  const needsContext = item => /^(?:done(?: and dusted)?|all done|complete(?:d)?|finished|it(?:'s| is) (?:now )?(?:done|complete(?:d)?|finished))[.!]*$/i.test(item.text.trim()) || item.truncated || item.quotedPost || /👀|🚀/.test(item.text) || /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|soon|next week|coming|eod|midnight|noon|propagated|rolled out|end of (?:the )?day|confirmed|landed|dev\s?day|launch|release|keynote|stay tuned|👀|surprise|refill|refuel|button|reset)\b|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(item.text);

  function quotedPost(value, now) {
    if (!value || !trusted(value.author) || typeof value.text !== 'string' || !value.text || value.truncated) return null;
    const at = Date.parse(value.createdAt);
    if (!Number.isFinite(at) || at > now + 300000 || now - at > 14 * day) return null;
    return { author: value.author.toLowerCase(), text: value.text.slice(0, 6000), createdAt: new Date(at).toISOString() };
  }

  function linkQuotedContexts(items) {
    // X quote cards have no public status link in the DOM. Resolve only an
    // exact author/time/body match with a separately collected original post.
    // A quote alone or its position in a timeline cannot establish identity.
    const body = text => String(text).replace(/\s+(?:https?:\/\/)?(?:x\.com|t\.co)\/\S+\s*$/i, '').replace(/\s+/g, ' ').trim();
    const linked = items.map(item => {
      const quote = item.quotedPost;
      if (!quote) return item;
      const matches = items.filter(parent => parent.id !== item.id && !parent.truncated &&
        parent.author.toLowerCase() === quote.author && parent.createdAt === quote.createdAt &&
        body(parent.text) === body(quote.text) && Date.parse(parent.createdAt) <= Date.parse(item.createdAt));
      if (matches.length !== 1) return item;
      const parent = matches[0];
      return { ...item, replyContext: { id: parent.id, author: parent.author, text: parent.text,
        url: parent.url, createdAt: parent.createdAt, relation: 'quoted-post', targetId: item.id } };
    });
    // Rebuild timing subjects only for an exactly identified quote target.
    // Other conversation results and their short retry schedule stay intact.
    const targets = new Set(linked.filter(item => item.quotedPost && item.replyContext?.relation === 'quoted-post')
      .map(item => item.replyContext.id));
    if (!targets.size) return linked;
    const signals = root.RadarSignals || (typeof require === 'function' ? require('./signals') : null);
    const timing = new Map((signals?.linkTimingFollowUps(linked) || linked).map(item => [item.id, item]));
    return linked.map(item => targets.has(item.id) ? timing.get(item.id) : item);
  }

  function normalize(rows, now = Date.now()) {
    const valid = (Array.isArray(rows) ? rows : []).slice(0, 160).flatMap(row => {
      if (!row || typeof row.id !== "string" || typeof row.author !== "string" ||
          !/^[1-9]\d{0,24}$/.test(row.id) || !/^[a-zA-Z0-9_]{1,15}$/.test(row.author)) return [];
      if (row.url !== `https://x.com/${row.author}/status/${row.id}` || typeof row.text !== "string" || !row.text.trim()) return [];
      const at = Date.parse(row.createdAt);
      if (!Number.isFinite(at) || at > now + 300000 || now - at > 14 * day) return [];
      return [{ id: row.id, author: row.author, text: row.text.slice(0, 6000), createdAt: new Date(at).toISOString(), url: row.url, truncated: Boolean(row.truncated),
        ...(root.RadarSignals?.pollOptions(row.pollOptions).length ? { pollOptions: root.RadarSignals.pollOptions(row.pollOptions) } : {}),
        avatarUrl: typeof row.avatarUrl === "string" && row.avatarUrl.length <= 512 && /^https:\/\/pbs\.twimg\.com\/profile_images\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp)$/.test(row.avatarUrl) ? row.avatarUrl : null,
        ...(quotedPost(row.quotedPost, now) ? { quotedPost: quotedPost(row.quotedPost, now) } : {}),
        ...(typeof row.adjacentId === "string" ? { adjacentId: row.adjacentId } : {}) }];
    });
    return valid.flatMap((post, index) => {
      if (!trusted(post.author)) return [];
      const previous = Object.hasOwn(post, "adjacentId") ? valid.find(row => row.id === post.adjacentId) : valid[index - 1];
      // Adjacency is NOT an authenticated reply relationship. Keep this label
      // and use it only for weak candidates, never forecasts or reset claims.
      const context = previous && previous.author.toLowerCase() !== post.author.toLowerCase() &&
        Date.parse(previous.createdAt) <= Date.parse(post.createdAt) &&
        publicContext(previous.text)
        ? { ...previous, relation: "adjacent-unverified" } : null;
      return [{ ...post, entityId: post.id, source: { id: "codex-lead", label: ({thsottiaux: "Tibo", reach_vb: "VB", openai: "OpenAI"})[post.author.toLowerCase()] + " · X 직접 확인", weight: 1, kind: "x-page" },
        ...(context ? { replyContext: context, isReply: true } : {}) }];
    });
  }

  function conversationContext(item, result, now = Date.now()) {
    if (result?.targetId !== item.id || !Array.isArray(result.rows)) return item;
    const index = result.rows.findIndex(row => row.id === item.id && row.author?.toLowerCase() === item.author.toLowerCase());
    if (index < 0) return item;
    const { replyContext: _previousContext, semanticContext: _previousSemantic, ...original } = item;
    const target = result.rows[index];
    const verified = normalize([target], now).find(row => row.id === item.id && row.url === item.url);
    const { quotedPost: previousQuote, ...unquoted } = original;
    const quote = verified?.quotedPost || (verified && verified.text !== item.text ? null : previousQuote);
    const base = verified && !verified.truncated ? { ...unquoted, text: verified.text,
      ...(quote ? { quotedPost: quote } : {}),
      pollOptions: verified.pollOptions || [], avatarUrl: verified.avatarUrl || original.avatarUrl, truncated: false } : original;
    // Only rows preceding this exact target on its own conversation page.
    const candidates = result.rows.slice(0, index).slice(-6).reverse();
    const context = candidates.find(row => typeof row.id === "string" && /^[1-9]\d{0,24}$/.test(row.id) &&
      typeof row.author === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(row.author) &&
      row.url === `https://x.com/${row.author}/status/${row.id}` && typeof row.text === "string" && !row.truncated &&
        Date.parse(row.createdAt) <= Date.parse(item.createdAt) && now - Date.parse(row.createdAt) <= 14 * day &&
        (publicContext(row.text) || root.RadarSignals?.resetAnchor({ ...row, source: item.source })));
    const semanticParent = candidates.find(row => row?.author?.toLowerCase() === item.author.toLowerCase() &&
      /^[1-9]\d{0,24}$/.test(row.id || '') && row.url === `https://x.com/${row.author}/status/${row.id}` &&
      typeof row.text === 'string' && row.text.trim() && row.text.length <= 6000 && !row.truncated &&
      Date.parse(row.createdAt) < Date.parse(item.createdAt) && Date.parse(item.createdAt) - Date.parse(row.createdAt) <= 7 * day);
    const enriched = semanticParent ? { ...base, semanticContext: {
      id: semanticParent.id, author: semanticParent.author, text: semanticParent.text, url: semanticParent.url,
      createdAt: semanticParent.createdAt, relation: 'conversation-before', targetId: item.id
    } } : base;
    return context ? { ...enriched, isReply: true, replyContext: {
      id: context.id, author: context.author, text: context.text.slice(0, 6000), url: context.url,
      createdAt: context.createdAt, relation: "conversation-before", targetId: item.id
    } } : enriched;
  }

  function archivePosts(rows, now = Date.now()) {
    // Public text only, revalidated at the persistence boundary. Disable
    // inferred adjacency when restoring an archive rather than a live list.
    const input = [...new Map((Array.isArray(rows) ? rows : []).slice(-960).map(row => [row?.id, row])).values()];
    const recentFirst = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
    const posts = AUTHORS.flatMap(author => {
      const rows = input.filter(row => String(row?.author || '').toLowerCase() === author);
      const valid = [];
      // Validate all bounded input before applying the per-author cap. An old
      // full archive (or invalid rows) must never crowd out newly read posts.
      for (let i = 0; i < rows.length; i += 160) valid.push(...normalize(rows.slice(i, i + 160)
        .map(row => ({ ...row, adjacentId: '' })), now));
      return valid.filter(item => now - Date.parse(item.createdAt) <= 7 * day).sort(recentFirst).slice(0, 160);
    }).sort(recentFirst);
    const unique = new Map(); let bytes = 2;
    for (const item of posts) {
      if (unique.has(item.id)) continue;
      // Three bytes per UTF-16 code unit conservatively bounds UTF-8 JSON.
      const size = JSON.stringify(item).length * 3 + 1;
      if (bytes + size > 1000000) continue;
      bytes += size; unique.set(item.id, item);
    }
    return [...unique.values()];
  }

  function restorePosts(rows, contextCache = {}, now = Date.now()) {
    return linkQuotedContexts(archivePosts(rows, now).map(item => {
      const entry = contextCache?.[item.id];
      return entry?.text === item.text && entry.url === item.url && entry.createdAt === item.createdAt &&
        entry.truncated === item.truncated && entry.checkedAt > now - 7 * day
        ? conversationContext(item, entry.result, now) : item;
    }));
  }

  function failureReason(error) {
    const message = String(error?.message || "");
    if (/PERMISSION/.test(message)) return "permission";
    if (/TAB_BLOCKED|TAB_CLEANUP_FAILED/.test(message)) return "tab-blocked";
    if (/LOGIN/.test(message)) return "login";
    if (/TIMEOUT/.test(message)) return "timeout";
    if (/NO_PUBLIC_POSTS/.test(message)) return "no-posts";
    if (/BODY_UNAVAILABLE/.test(message)) return "body-unavailable";
    return "page-unavailable";
  }

  function read(signal, options = {}) {
    const historyOnly = options.historyOnly === true;
    if (readJob) {
      if (readHistoryOnly === historyOnly) return readJob;
      // Current public detection has priority over an optional historical read.
      if (readHistoryOnly && !historyOnly) historyAbort?.abort();
      return readJob.catch(() => {}).then(() => { signal.throwIfAborted(); return read(signal, options); });
    }
    readHistoryOnly = historyOnly;
    historyAbort = historyOnly ? new AbortController() : undefined;
    const combined = historyAbort ? AbortSignal.any([signal, historyAbort.signal]) : signal;
    readJob = runRead(combined, options).finally(() => { readJob = undefined; historyAbort = undefined; readHistoryOnly = false; });
    return readJob;
  }
  async function runRead(signal, { authors = AUTHORS, contextCache = {}, retainedPosts = [], resetTargets = [], onCheckpoint,
    telegramLeads = null, telegramAttempts = {}, knownHistoryIds = [], onTelegramAttempt, onTelegramHistory, historyOnly = false } = {}) {
    if (!Array.isArray(authors) || !authors.length || authors.some(author => !AUTHORS.includes(author))) throw new Error('X_UNSUPPORTED_AUTHOR');
    // Observe the already-started lookup without blocking primary collection.
    // Disabled, empty or failed channels must not consume its time budget.
    let secondarySnapshot;
    const secondaryJob = telegramLeads ? Promise.resolve(telegramLeads).then(
      result => (secondarySnapshot = result || { ids: [] }),
      () => (secondarySnapshot = { state: 'unavailable', ids: [] })) : null;
    const secondaryIds = result => Array.isArray(result?.ids)
      ? [...new Set(result.ids.filter(id => typeof id === 'string' && /^[1-9]\d{0,24}$/.test(id)))].slice(0, 80) : [];
    // Scan originals for every monitored author before replies so one busy reply feed cannot starve the other author.
    const TIMELINES = ['posts', 'replies'].flatMap(kind => authors.map(author => ({author, kind,
      url: 'https://x.com/' + (author === 'openai' ? 'OpenAI' : author) + (kind === 'replies' ? '/with_replies' : '')})));
    if (!await chrome.permissions.contains(PERMISSION)) throw new Error("X_PERMISSION_REQUIRED");
    signal.throwIfAborted();
    // Any persisted tab belongs to an interrupted previous scan. Cleanup must
    // succeed before another tab is opened, including after worker restarts.
    if (!await owner.cleanup({ force: true })) throw new Error('X_TAB_BLOCKED');
    signal.throwIfAborted();
    let tab, currentUrl = TIMELINES[0].url, currentStage = "navigation";
    // Navigation may take 15s and the conversation reader up to 24s. Give
    // each historical page room for both; a live scan can still interrupt it.
    const deadline = Date.now() + (historyOnly ? 90000 : authors.length * 90000);
    const diagnostics = { readerBuild: root.chrome?.runtime?.getManifest?.()?.version || 'local', posts: 0, contexts: 0, conversations: 0, conversationFailures: 0, pages: 0, stopReason: "unknown", timelines: [],
      bodyUnavailableCount: 0, bodyUnavailable: [], bodyUnavailableLatestAt: null, mediaOnlyCount: 0 };
    const unavailableBodies = new Map(), unavailableCounts = new Map(), mediaOnlyCounts = new Map();
    function bodyQualityOf(result, expectedAuthor) {
      const providedMetadata = Array.isArray(result?.bodyUnavailable) ? result.bodyUnavailable : [];
      const missing = providedMetadata.filter(row => typeof row?.id === 'string' && /^[1-9]\d{0,24}$/.test(row.id) &&
        typeof row.author === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(row.author) &&
        (!expectedAuthor || row.author.toLowerCase() === expectedAuthor) && Number.isFinite(Date.parse(row.createdAt)) &&
        Date.parse(row.createdAt) > 0 && Date.parse(row.createdAt) <= Date.now() + 300000 && Date.now() - Date.parse(row.createdAt) <= 7 * day);
      // Explicit stale/invalid identities have already been reviewed. They
      // must not reappear as anonymous count-only missing bodies.
      const countOnly = Math.max(0, Math.min(160, Number(result?.bodyUnavailableCount) || 0) - providedMetadata.length);
      return { missing, countOnly, count: missing.length + countOnly };
    }
    function updateBodyDiagnostics() {
      diagnostics.bodyUnavailable = [...unavailableBodies.values()].slice(0, 20);
      diagnostics.bodyUnavailableCount = unavailableBodies.size + [...unavailableCounts.values()].reduce((sum, count) => sum + count, 0);
      diagnostics.bodyUnavailableLatestAt = Math.max(0, ...[...unavailableBodies.values()].map(row => Date.parse(row.createdAt))) || null;
      diagnostics.mediaOnlyCount = [...mediaOnlyCounts.values()].reduce((sum, count) => sum + count, 0);
    }
    async function bounded(promise, limit, until = deadline) {
      signal.throwIfAborted();
      let timer, abort;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("X_TIMEOUT")), Math.max(1, Math.min(limit, until - Date.now())));
          abort = () => reject(new Error("X_ABORTED"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        })]);
      } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
    }
    async function page(url, until = deadline, allowWrapper = false) {
      currentStage = "navigation";
      signal.throwIfAborted();
      if (until <= Date.now()) throw new Error("X_TIMEOUT");
      const previousUrl = tab ? currentUrl : null;
      if (tab) {
        const current = await chrome.tabs.get(tab.id);
        if (!sameReaderPage(current.url, currentUrl) || (current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl)) || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
        await owner.navigate(tab.id, url, signal);
        currentUrl = owner.url(url);
        signal.throwIfAborted();
      } else {
        currentUrl = url;
        tab = await owner.open(url, deadline + 30000);
        currentUrl = owner.url(url);
        signal.throwIfAborted();
      }
      currentStage = "loading";
      await new Promise((resolve, reject) => {
        let settled = false, redirecting = false, adoptedWrapper = false;
        const finish = error => {
          if (settled) return; settled = true;
          clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated);
          signal.removeEventListener("abort", abort);
          error ? reject(error) : resolve();
        };
        const abort = () => finish(new Error("X_ABORTED"));
        const checkReady = () => chrome.tabs.get(tab.id).then(async current => {
          if (settled || redirecting) return;
          if (current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed ||
              (current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl) &&
                !(allowWrapper && wrapperRedirect(current.pendingUrl, url, currentUrl)))) return finish(new Error("X_PAGE_UNAVAILABLE"));
          if (current.url?.startsWith("https://x.com/i/flow/login")) return finish(new Error("X_LOGIN_REQUIRED"));
          // Only a same-ID Telegram redirect may be adopted, in this owned,
          // inactive tab. Register its exact route/nonce before reading it.
          const wrapper = allowWrapper && wrapperRedirect(current.url, url, currentUrl);
          if (wrapper && !adoptedWrapper && !sameReaderPage(current.url, currentUrl)) {
            adoptedWrapper = true;
            redirecting = true;
            currentUrl = owner.url(wrapper);
            try { await owner.navigate(tab.id, wrapper, signal); }
            finally { redirecting = false; }
            return checkReady();
          }
          const requested = sameReaderPage(current.url, currentUrl);
          // tabs.update/create can return while the old document still says
          // complete. Its completion event must not certify the new page.
          if (requested && !current.pendingUrl && current.status === "complete") return finish();
          const previous = previousUrl && sameReaderPage(current.url, previousUrl);
          const initial = !previousUrl && (!current.url || current.url === "about:blank");
          if (!requested && !previous && !initial) finish(new Error("X_PAGE_UNAVAILABLE"));
        }).catch(finish);
        const onUpdated = (id, change) => { if (id === tab.id && (change.status || change.url)) void checkReady(); };
        const timer = setTimeout(() => finish(new Error("X_TIMEOUT")), Math.max(1, Math.min(15000, until - Date.now())));
        chrome.tabs.onUpdated.addListener(onUpdated);
        signal.addEventListener("abort", abort, { once: true });
        void checkReady();
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      const current = await chrome.tabs.get(tab.id);
      if ((current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl)) || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
      if (current.url?.startsWith("https://x.com/i/flow/login")) throw new Error("X_LOGIN_REQUIRED");
      if (!sameReaderPage(current.url, currentUrl)) throw new Error("X_PAGE_UNAVAILABLE");
      currentStage = "reading";
      if (until <= Date.now()) throw new Error("X_TIMEOUT");
      const wrapper = allowWrapper && /^https:\/\/x\.com\/codex_resets\/status\//i.test(currentUrl);
      const result = await bounded(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: [wrapper ? "src/x-wrapper-reader.js" : "src/x-reader.js"] }), TIMELINES.some(t => t.url === url) ? 32000 : 24000, until);
      signal.throwIfAborted();
      const afterRead = await chrome.tabs.get(tab.id);
      if (!sameReaderPage(afterRead.url, currentUrl) || (afterRead.pendingUrl && !sameReaderPage(afterRead.pendingUrl, currentUrl)) || afterRead.active || afterRead.pinned || afterRead.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
      return result?.find(frame => frame.frameId === 0)?.result;
    }
    const cache = Object.fromEntries(Object.entries(contextCache || {}).filter(([id, entry]) =>
      /^[1-9]\d{0,24}$/.test(id) && (entry?.checkedAt || entry?.queuedAt) > Date.now() - 7 * day));
    const collected = new Map(archivePosts(retainedPosts).filter(item => authors.includes(item.author.toLowerCase())).map(item => [item.id, item]));
    const knownHistory = new Set(Array.isArray(knownHistoryIds) ? knownHistoryIds.filter(id => typeof id === 'string') : []);
    const completeLead = id => {
      const resolved = cache[id]?.resolvedLeadId;
      const originalId = typeof resolved === 'string' && /^[1-9]\d{0,24}$/.test(resolved) ? resolved : id;
      const item = collected.get(originalId);
      return knownHistory.has(originalId) || Boolean(item && !item.truncated && item.text?.trim());
    };
    diagnostics.retainedPosts = collected.size;
    function compactCache() {
      const entries = Object.entries(cache).sort((a, b) => (b[1].checkedAt || b[1].queuedAt) - (a[1].checkedAt || a[1].queuedAt));
      const result = {}; let bytes = 2;
      for (const [id, entry] of entries.slice(0, 480)) {
        const size = JSON.stringify([id, entry]).length * 3 + 1;
        if (bytes + size > 1000000) continue;
        bytes += size; result[id] = entry;
      }
      return result;
    }
    async function checkpoint() {
      signal.throwIfAborted();
      if (onCheckpoint) {
        try { await onCheckpoint({ posts: archivePosts([...collected.values()]), contextCache: compactCache(),
          timingReplies: root.RadarNews?.timingReplies([...collected.values()]) || [] }); }
        catch { diagnostics.checkpointError = true; }
      }
      signal.throwIfAborted();
    }
    // Roots stay eligible for the UI's 7-day retention. A timing child is never
    // a root: the candidate's own body must mention the reset.
    const recentResetRoot = item => !item.truncated && Date.now() - Date.parse(item.createdAt) < 7 * day &&
      /\breset(?:s|ting)?\b/i.test(item.text || '') &&
      (root.RadarSignals?.resetAnchor(item) || root.RadarSignals?.resetHeadline(item.text) || resetContext(item.text));
    // Per-run exact-root ledger: the same unchanged root is read at most once
    // per scan (known roots, posts and replies timelines share it).
    const checkedRoots = new Map(), rootKey = item => [item.text, item.url, item.createdAt].join('\n');
    const sameBody = (a, b) => a && b && a.id === b.id && a.author?.toLowerCase() === b.author?.toLowerCase() &&
      a.url === b.url && a.text === b.text && Date.parse(a.createdAt) === Date.parse(b.createdAt) && !a.truncated && !b.truncated;
    const parentChanged = entry => entry?.result?.rows?.some(row => {
      const known = row.id !== entry.result.targetId && collected.get(row.id);
      return known && !known.truncated && (known.text !== row.text || known.url !== row.url || Date.parse(known.createdAt) !== Date.parse(row.createdAt));
    });
    const matchesCache = (item, entry) => entry?.text === item.text && entry.truncated === item.truncated &&
      entry.url === item.url && entry.createdAt === item.createdAt && !parentChanged(entry);
    function retainedConversation(item, conversation) {
      const entry = cache[item.id];
      const prior = matchesCache(item, entry) && entry.result
        ? conversationContext(item, entry.result) : collected.get(item.id);
      const fresh = conversationContext(item, conversation);
      // Missing UI is not a retraction. Preserve only exact-target evidence;
      // edited bodies, changed parents and a different visible parent win.
      if (!sameBody(prior, fresh) || parentChanged(entry)) return fresh;
      const differentParent = fresh.semanticContext && prior.replyContext && !sameBody(fresh.semanticContext, prior.replyContext);
      const editedParent = prior.replyContext && conversation?.rows?.some(row => row.id === prior.replyContext.id &&
        !row.truncated && row.text?.trim() && row.url === prior.replyContext.url && !sameBody(row, prior.replyContext));
      const changedQuote = fresh.quotedPost && prior.quotedPost && JSON.stringify(fresh.quotedPost) !== JSON.stringify(prior.quotedPost);
      return { ...fresh,
        ...(!fresh.quotedPost && prior.quotedPost ? { quotedPost: prior.quotedPost } : {}),
        ...(!fresh.semanticContext && !changedQuote && prior.semanticContext?.targetId === item.id ? { semanticContext: prior.semanticContext } : {}),
        ...(!fresh.replyContext && !differentParent && !editedParent && !changedQuote && prior.replyContext?.targetId === item.id &&
          prior.replyContext.relation === 'conversation-before' ? { isReply: true, replyContext: prior.replyContext } : {}) };
    }
    function rememberConversation(item, conversation) {
      const enriched = retainedConversation(item, conversation);
      const { replyContext: parent, ...target } = enriched;
      cache[item.id] = { schema: CONTEXT_SCHEMA, text: enriched.text, truncated: enriched.truncated, url: enriched.url,
        createdAt: enriched.createdAt, queuedAt: cache[item.id]?.queuedAt || Date.now(), checkedAt: Date.now(), attemptedAt: Date.now(),
        result: { targetId: item.id, rows: parent ? [parent, target] : [target] } };
      collected.set(item.id, enriched); diagnostics.conversations++;
      if (parent?.relation === 'conversation-before') diagnostics.contexts++;
      return enriched;
    }
    const deferredResetRoots = new Set();
    async function checkResetFollowUps(item, reserve = 0) {
      const old = cache[item.id];
      if (old?.schema === CONTEXT_SCHEMA && old.text === item.text && old.url === item.url && old.createdAt === item.createdAt &&
          old.followUpsVerified && old.followUpsCheckedAt > Date.now() - 5 * 60000) return;
      if (checkedRoots.get(item.id) === rootKey(item)) return;
      const followUpDeadline = deadline - reserve;
      if (followUpDeadline - Date.now() < 15000) {
        if (!deferredResetRoots.has(item.id)) {
          deferredResetRoots.add(item.id);
          diagnostics.deferredResetChecks = deferredResetRoots.size;
          diagnostics.conversationFailures++;
        }
        return;
      }
      if (deferredResetRoots.delete(item.id)) {
        diagnostics.deferredResetChecks = deferredResetRoots.size;
        diagnostics.conversationFailures--;
      }
      checkedRoots.set(item.id, rootKey(item));
      const status = { id: item.id, author: item.author, state: 'checking', discovered: 0, verified: 0, inferred: 0, children: [] };
      (diagnostics.resetFollowUps ||= []).push(status);
      try {
        const conversation = await page(item.url, followUpDeadline);
        if (conversation?.targetId !== item.id || !conversation.rows?.some(row => row.id === item.id && row.author?.toLowerCase() === item.author.toLowerCase()))
          throw new Error('X_NO_PUBLIC_POSTS');
        if (bodyQualityOf(conversation).count) throw new Error('X_BODY_UNAVAILABLE');
        const target = normalize(conversation.rows).find(row => row.id === item.id && row.url === item.url && !row.truncated);
        if (!target) throw new Error('X_BODY_UNAVAILABLE');
        const original = rememberConversation(target, conversation);
        if (!recentResetRoot(original)) { status.state = 'changed'; return; }
        const leads = [...new Map([...normalize(conversation.followUps), ...collected.values()].filter(child => child.id !== original.id &&
          child.author.toLowerCase() === original.author.toLowerCase() && Date.parse(child.createdAt) > Date.parse(original.createdAt) &&
          Date.parse(child.createdAt) - Date.parse(original.createdAt) <= 2 * day &&
          /\b(?:eod|end of (?:the )?day|before|by)\b|\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\b|\b\d{1,2}:\d{2}\b/i.test(child.text))
          .map(child => [child.id, child])).values()].slice(0, 3);
        status.discovered = leads.length;
        for (const child of leads) {
          collected.set(child.id, child);
          if (followUpDeadline - Date.now() < 15000) throw new Error('X_TIMEOUT');
          const reply = await page(child.url, followUpDeadline);
          if (reply?.targetId !== child.id || !reply.rows?.some(row => row.id === child.id && row.author?.toLowerCase() === child.author.toLowerCase()))
            throw new Error('X_NO_PUBLIC_POSTS');
          if (bodyQualityOf(reply).count) throw new Error('X_BODY_UNAVAILABLE');
          const checked = rememberConversation(child, reply), parent = checked.replyContext;
          const matches = parent?.id === original.id && parent.url === original.url && parent.text === original.text &&
            Date.parse(parent.createdAt) === Date.parse(original.createdAt);
          const followUp = !parent && root.RadarSignals.linkTimingFollowUps([...collected.values()])
            .find(item => item.id === child.id && item.replyContext?.id === original.id && root.RadarSignals.inferredTimingContext(item));
          if (followUp) { collected.set(child.id, followUp); status.inferred++; }
          status.children.push({ id: child.id, parentId: parent?.id || followUp?.replyContext.id || null,
            state: matches ? 'verified' : followUp ? 'inferred' : !parent ? 'parent-missing' : parent.id !== original.id ? 'different-parent' : 'parent-mismatch' });
          if (matches) status.verified++;
          await checkpoint();
        }
        cache[item.id].followUpsCheckedAt = Date.now();
        cache[item.id].followUpsVerified = status.verified;
        status.state = status.verified ? 'verified' : status.inferred ? 'inferred' : 'not-found';
      } catch (error) {
        signal.throwIfAborted(); status.state = 'failed'; status.error = failureReason(error);
        diagnostics.conversationFailures++;
      } finally { await checkpoint(); }
    }
    try {
      let lastError;
      // A known reset shown in the popup must not depend on profile loading
      // succeeding again. Verify its permalink before bulk collection starts.
      const knownRoots = (Array.isArray(resetTargets) ? resetTargets : []).slice(0, 480).flatMap(item => {
        // Feed metadata can contain a display name or a prefixed source ID.
        // The URL is only a navigation lead; its actual public body must be
        // read and validated above before entering the collected evidence.
        const match = /^https:\/\/x\.com\/(thsottiaux|reach_vb|openai)\/status\/([1-9]\d{0,24})(?:[?#].*)?$/i.exec(item?.url || '');
        if (!match) return [];
        return normalize([{ ...item, author: match[1], id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` }]);
      }).filter(item => authors.includes(item.author.toLowerCase()) && recentResetRoot(item));
      // Bounded global pick: least recently checked first (never-checked = 0),
      // then newest, so an older visible root cannot be starved by a newer one.
      const knownPicks = historyOnly ? [] : [...new Map(knownRoots.map(item => [item.id, item])).values()]
        .sort((a, b) => (Number(cache[a.id]?.followUpsCheckedAt) || 0) - (Number(cache[b.id]?.followUpsCheckedAt) || 0) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3);
      const auxiliaryReserve = () => secondaryJob && authors.includes('thsottiaux') &&
        (secondarySnapshot === undefined || secondaryIds(secondarySnapshot).some(id =>
          !completeLead(id) && Date.now() - (Number(telegramAttempts[id]) || 0) >= 30 * 60000)) ? 45000 : 0;
      for (const known of knownPicks) {
        await checkResetFollowUps(known, TIMELINES.length * 32000 + auxiliaryReserve());
      }
      // X may expose a reply-only stream here; scan original posts separately
      // so a busy reply timeline cannot bury the latest reset announcement.
      for (const [timelineIndex, timeline] of (historyOnly ? [] : TIMELINES).entries()) {
        let bodyQuality = {};
        try {
          const remaining = TIMELINES.length - timelineIndex;
          const timelineBudget = Math.max(1000, Math.min(42000, (deadline - Date.now() - auxiliaryReserve()) / remaining));
          const result = await page(timeline.url, Date.now() + timelineBudget);
          const { missing, countOnly, count: missingCount } = bodyQualityOf(result, timeline.author);
          for (const row of missing) if (!collected.get(row.id)?.text?.trim())
            unavailableBodies.set(row.id, { id: row.id, author: timeline.author, createdAt: row.createdAt });
          bodyQuality = { bodyUnavailableCount: missingCount, mediaOnlyCount: Math.min(160, Math.max(0, Number(result?.mediaOnlyCount) || 0)) };
          mediaOnlyCounts.set(timeline.author + ':' + timeline.kind, bodyQuality.mediaOnlyCount);
          unavailableCounts.set(timeline.author + ':' + timeline.kind, countOnly);
          const rows = normalize(Array.isArray(result) ? result : result?.rows).filter(item => item.author.toLowerCase() === timeline.author);
          for (const item of rows) unavailableBodies.delete(item.id);
          updateBodyDiagnostics();
          if (!rows.length) throw new Error(missingCount ? 'X_BODY_UNAVAILABLE' : 'X_NO_PUBLIC_POSTS');
          for (const item of rows) {
            const previous = collected.get(item.id);
            const unchanged = sameBody(previous, item) || previous && !previous.truncated && item.truncated &&
              previous.url === item.url && previous.createdAt === item.createdAt;
            collected.set(item.id, { ...(unchanged ? previous : {}), ...item,
              ...(previous && !previous.truncated && item.truncated ? { text: previous.text, truncated: false } : {}),
              ...(unchanged && previous?.replyContext && !item.replyContext ? { replyContext: previous.replyContext } : {}) });
          }
          const pages = Number(result?.pages) || 1;
          diagnostics.pages += pages;
          diagnostics.timelines.push({ author: timeline.author, kind: timeline.kind, ok: true, posts: rows.length, pages, expanded: Number(result?.expanded) || 0, stopReason: result?.stopReason || 'initial-load', ...bodyQuality });
          await checkpoint();
          // Do not make the latest reset wait for all six expensive timelines.
          // Its own page and short timing replies share this same owned tab.
          if (timeline.kind === 'posts' || !diagnostics.resetFollowUps?.some(check => check.author.toLowerCase() === timeline.author && check.state === 'verified')) {
            const latest = rows.filter(recentResetRoot).filter(item => checkedRoots.get(item.id) !== rootKey(item)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
            if (latest) await checkResetFollowUps(latest, (TIMELINES.length - timelineIndex - 1) * 32000 + auxiliaryReserve());
          }
        } catch (error) {
          signal.throwIfAborted(); lastError = error;
          diagnostics.timelines.push({ author: timeline.author, kind: timeline.kind, ok: false, error: failureReason(error), stage: currentStage, ...bodyQuality });
          // A failed tab creation/persistence is not a failed author timeline.
          // Retrying another timeline would open more tabs against the same
          // unavailable ownership store in this single scan.
          if (!tab) throw error;
          if (tab) {
            const current = await chrome.tabs.get(tab.id).catch(() => ({}));
            if (!sameReaderPage(current.url, currentUrl) || (current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl)) || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) break;
          }
        }
      }
      // Telegram supplies IDs only. Read each missing Tibo status in the same
      // owned tab after the primary timelines; never trust channel text or labels.
      if (telegramLeads && authors.includes('thsottiaux')) {
        let secondaryTimer;
        const secondary = await Promise.race([secondaryJob, new Promise(resolve => {
          secondaryTimer = setTimeout(() => resolve({ state: 'pending', ids: [] }), 1000);
        })]).finally(() => clearTimeout(secondaryTimer));
        signal.throwIfAborted();
        const ids = secondaryIds(secondary);
        const channelIds = Array.isArray(secondary?.telegramIds) ? [...new Set(secondary.telegramIds.filter(id => ids.includes(id)))].slice(0, 40) : ids;
        const channelSet = new Set(channelIds);
        diagnostics.telegram = { state: secondary?.state || 'unavailable', leads: channelIds.length, missing: channelIds.filter(id => !completeLead(id)).length,
          attempted: 0, recovered: 0, channelAttempted: 0, channelRecovered: 0 };
        // Never let candidates that repeatedly fail monopolize the first two
        // slots every polling cycle. Stable ordering preserves source fairness
        // and recency among candidates attempted equally long ago.
        const orderedIds = [...ids].sort((a, b) => (Number(telegramAttempts[a]) || 0) - (Number(telegramAttempts[b]) || 0));
        for (const id of orderedIds) {
          if (completeLead(id) || diagnostics.telegram.attempted >= 2 || Date.now() - (Number(telegramAttempts[id]) || 0) < 30 * 60000) continue;
          const until = Math.min(deadline - (historyOnly ? 3000 : 10000), Date.now() + 42000);
          if ((!tab && !historyOnly) || until - Date.now() < 15000) break;
          try {
            // Persist before navigation so worker termination cannot repeatedly
            // open the same unavailable or misleading status every poll.
            if (onTelegramAttempt) await onTelegramAttempt(id);
            diagnostics.telegram.attempted++;
            if (channelSet.has(id)) diagnostics.telegram.channelAttempted++;
            let originalId = id;
            let result = await page('https://x.com/thsottiaux/status/' + id, until, true);
            if (result?.wrapperId === id) {
              const match = /^https:\/\/x\.com\/thsottiaux\/status\/([1-9]\d{0,24})$/.exec(result.originalUrl || '');
              if (!match || match[1] === id) { diagnostics.telegram.error = 'original-unresolved'; continue; }
              originalId = match[1];
              result = await page(result.originalUrl, until);
            }
            const target = (result?.rows || []).find(row => row.id === originalId && String(row.author || '').toLowerCase() === 'thsottiaux');
            if (historyOnly && !target) throw new Error(result?.bodyUnavailableCount ? 'X_BODY_UNAVAILABLE' : 'X_NO_PUBLIC_POSTS');
            const published = Date.parse(target?.createdAt), age = Date.now() - published;
            if (!Number.isFinite(published) || age < -300000 || age > 365 * day) {
              diagnostics.telegram.error = 'invalid-post';
              continue;
            }
            const item = normalize([target], age > 7 * day ? published : Date.now()).find(row => row.id === originalId && row.author.toLowerCase() === 'thsottiaux' && !row.truncated);
            if (result?.targetId !== originalId || !item) {
              diagnostics.telegram.error = target?.truncated ? 'body-unavailable' : 'invalid-post';
              continue;
            }
            if (historyOnly || age > 7 * day) {
              if (onTelegramHistory && await onTelegramHistory(conversationContext(item, result, published))) {
                knownHistory.add(originalId);
                diagnostics.telegram.recovered++; if (channelSet.has(id)) diagnostics.telegram.channelRecovered++;
              }
            } else {
              collected.set(originalId, conversationContext(item, result));
              diagnostics.telegram.recovered++;
              if (channelSet.has(id)) diagnostics.telegram.channelRecovered++;
            }
            if (originalId !== id) cache[id] = { checkedAt: Date.now(), resolvedLeadId: originalId };
            await checkpoint();
          } catch (error) {
            signal.throwIfAborted();
            diagnostics.telegram.error = failureReason(error);
            break; // Never navigate a tab whose ownership or page state is uncertain.
          }
        }
        diagnostics.telegram.missing = channelIds.filter(id => !completeLead(id)).length;
      }
      if (historyOnly) return { items: [], diagnostics, contextCache: {}, retainedPosts: [] };
      const items = authors.flatMap(author => [...collected.values()].filter(item => item.author.toLowerCase() === author).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 160)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, authors.length * 160);
      if (!items.length) throw Object.assign(lastError || new Error("X_NO_PUBLIC_POSTS"), { diagnostics });
      diagnostics.posts = items.length;
      diagnostics.truncated = items.filter(item => item.truncated).length;
      diagnostics.stopReason = diagnostics.timelines.length === TIMELINES.length && diagnostics.timelines.every(t => t.ok) ? 'all-timelines' : 'partial';
      // Cache exact conversation results, including unrelated/no-parent results.
      // Otherwise the same three newest replies starve every older candidate.
      const pending = [];
      for (let index = 0; index < items.length; index++) {
        let item = items[index];
        const entry = cache[item.id];
        if (!needsContext(item)) continue;
        const changedParent = parentChanged(entry);
        if (changedParent) {
          const { replyContext: _stale, semanticContext: _semantic, ...original } = item;
          item = original; items[index] = item; collected.set(item.id, item);
        }
        const identityMatch = matchesCache(item, entry);
        const match = identityMatch && entry?.schema === CONTEXT_SCHEMA;
        // These short follow-ups can appear before X hydrates the parent.
        // An empty first read must not suppress their context retry for hours.
        const shortGrantReply = /\b(?:eod|end of (?:the )?day|confirmed.{0,20}landed|lands?|landing|tomorrow|before|midnight|noon|done|complete(?:d)?|finished|propagated|rolled out|\d\s*[ap]m)\b/i.test(item.text);
        const recentReset = /\bresets?\b/i.test(item.text) && Date.now() - Date.parse(item.createdAt) < 2 * day;
        const contextAge = recentReset || shortGrantReply && !entry?.result?.rows?.some(row => row.id !== item.id &&
          publicContext(row.text)) ? 5 * 60000 : 6 * 3600000;
        // A refresh deadline is not evidence expiry. Keep an unchanged,
        // validated relationship while scheduling a fresh lookup. A failed
        // lookup must not remove a completion already tied to its reset.
        if (identityMatch && entry.result) {
          item = conversationContext(item, entry.result);
          items[index] = item;
          collected.set(item.id, item);
        }
        if (match && entry.result && entry.checkedAt > Date.now() - contextAge) {
          if (items[index].replyContext?.relation === 'conversation-before') diagnostics.contexts++;
        } else {
          cache[item.id] = { ...entry, ...(!identityMatch ? { result: undefined } : {}), queuedAt: entry?.queuedAt || Date.now() };
          pending.push(item);
        }
      }
      const age = item => cache[item.id]?.attemptedAt || cache[item.id]?.checkedAt || cache[item.id]?.queuedAt || 0;
      const priority = item => /\b(?:resets?|refill|refuel|eod|end of (?:the )?day|lands?|landed|done|shipped|finished|limits?|quota)\b/i.test(item.text) ? 2 : item.truncated ? 1 : 0;
      const oldest = [...pending].sort((a, b) => age(a) - age(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      // Read as many conversations as fit the existing scan deadline, rather
      // than stopping after three even when the reader still has time.
      // Reserve the third position for the oldest so fresh clues cannot starve it.
      const candidates = [...pending].sort((a, b) => priority(b) - priority(a) || age(a) - age(b) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (oldest && candidates.indexOf(oldest) > 2) {
        candidates.splice(candidates.indexOf(oldest), 1); candidates.splice(2, 0, oldest);
      }
      await checkpoint();
      let resolved = 0;
      for (const item of candidates) {
        if (deadline - Date.now() < 15000) { diagnostics.conversationFailures++; break; }
        cache[item.id] = { ...cache[item.id], schema: cache[item.id]?.result ? cache[item.id].schema : CONTEXT_SCHEMA,
          text: item.text, truncated: item.truncated, url: item.url,
          createdAt: item.createdAt, queuedAt: cache[item.id]?.queuedAt || Date.now(), attemptedAt: Date.now() };
        try {
          const conversation = await page(item.url);
          if (conversation?.targetId !== item.id || !conversation.rows?.some(row => row.id === item.id && row.author?.toLowerCase() === item.author.toLowerCase()))
            throw new Error("X_NO_PUBLIC_POSTS");
          const quality = bodyQualityOf(conversation);
          const unresolved = quality.missing.filter(row => {
            const known = collected.get(row.id);
            const complete = known && !known.truncated && known.text?.trim() &&
              known.author.toLowerCase() === row.author.toLowerCase() && Date.parse(known.createdAt) === Date.parse(row.createdAt);
            if (complete) unavailableBodies.delete(row.id);
            return !complete;
          });
          for (const row of unresolved) unavailableBodies.set(row.id, { id: row.id, author: row.author, createdAt: row.createdAt });
          unavailableCounts.set('conversation:' + item.id, quality.countOnly);
          for (const row of conversation.rows) if (typeof row?.text === 'string' && row.text.trim()) unavailableBodies.delete(row.id);
          updateBodyDiagnostics();
          // A rendered target does not prove that its preceding parent has
          // hydrated. Do not cache this as a verified six-hour no-parent read.
          if (unresolved.length + quality.countOnly) throw new Error('X_BODY_UNAVAILABLE');
          // An exact complete timeline body prevents a missing-text failure,
          // but does not establish this page's parent relationship. Leave the
          // context lookup pending without inventing a parent or caching an
          // authoritative no-parent result from this still-incomplete page.
          if (quality.missing.length) continue;
          resolved++;
          const enriched = rememberConversation(item, conversation);
          items[items.indexOf(item)] = enriched;
          if (root.RadarSignals?.resetAnchor(enriched) || resetContext(enriched.text) || root.RadarSignals?.resetHeadline(enriched.text)) {
            for (const child of normalize(conversation.followUps).filter(child => child.author.toLowerCase() === item.author.toLowerCase() &&
              Date.parse(child.createdAt) > Date.parse(item.createdAt) && Date.parse(child.createdAt) - Date.parse(item.createdAt) <= 2 * day && needsContext(child)).slice(0, 12)) {
              if (items.some(known => known.id === child.id)) continue;
              // Timeline order is not a relationship. Queue this exact public
              // child URL for independent parent verification in the same scan.
              items.push(child); collected.set(child.id, child); pending.push(child);
              cache[child.id] = { queuedAt: Date.now() };
              candidates.splice(candidates.indexOf(item) + 1, 0, child);
            }
          }
        } catch (error) {
          signal.throwIfAborted();
          diagnostics.conversationFailures++;
          // A user's navigation or login wall must stop subsequent navigation.
          const current = await chrome.tabs.get(tab.id).catch(() => ({}));
          if (!sameReaderPage(current.url, currentUrl) || (current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl)) || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) break;
        }
        await checkpoint();
      }
      diagnostics.contextPending = pending.length - resolved;
      diagnostics.truncated = items.filter(item => item.truncated).length;
      await checkpoint();
      const output = authors.flatMap(author => items.filter(item => item.author.toLowerCase() === author)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 160))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      diagnostics.posts = output.length;
      return { items: linkQuotedContexts(output), diagnostics, contextCache: compactCache(), retainedPosts: archivePosts(output) };
    } finally {
      if (tab?.id !== undefined) {
        try {
          if (!await owner.cleanup({ force: true })) diagnostics.cleanupError = 'tab-blocked';
        } catch (error) {
          // Fresh evidence must survive a failure to close the reader tab.
          // Its durable fence still prevents another tab from being created.
          diagnostics.cleanupError = failureReason(error);
          if (!diagnostics.posts) throw error;
        }
      }
    }
  }

  root.RadarDirectX = Object.freeze({ normalize, conversationContext, archivePosts, restorePosts, linkQuotedContexts, failureReason, read, cleanup: owner.cleanup, resume: owner.resume, GUARD_KEY: owner.guardKey, CLEANUP_ALARM, PERMISSION, AUTHORS });
  if (typeof module !== "undefined") module.exports = root.RadarDirectX;
})(globalThis);
