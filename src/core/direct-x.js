(function initDirectX(root) {
  const URL = "https://x.com/thsottiaux/with_replies";
  const POST_URL = "https://x.com/thsottiaux";
  const AUTHORS = ['thsottiaux', 'reach_vb', 'openai'];
  const trusted = author => AUTHORS.includes(String(author || '').toLowerCase());
  const PERMISSION = { permissions: ["scripting"], origins: ["https://x.com/*"] };
  const CLEANUP_ALARM = 'codex-reset-radar-x-tab-cleanup';
  const scanUrl = value => typeof value === 'string' && /^https:\/\/x\.com\/(?:thsottiaux|reach_vb|OpenAI)(?:\/with_replies|\/status\/[1-9]\d{0,24})?$/i.test(value);
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
  const TabOwner = root.RadarTabOwner || (typeof require === 'function' ? require('./tab-owner') : null);
  const owner = TabOwner.create({ key: 'directXScanTabV1', alarm: CLEANUP_ALARM, accepts: scanUrl, matches: ownedUrl, prefix: 'X',
    closeSelectedReader: true, sameReaderPage,
    recovery: { marker: 'radar-x-reader', permission: PERMISSION, urls: AUTHORS.flatMap(author =>
      ['https://x.com/' + author, 'https://x.com/' + author + '/with_replies', 'https://x.com/' + author + '/status/*'])
      .concat(['https://x.com/OpenAI', 'https://x.com/OpenAI/with_replies', 'https://x.com/OpenAI/status/*', 'https://x.com/home', 'https://x.com/i/timeline', 'https://x.com/i/flow/login*']) } });
  let readJob;
  const day = 86400000;
  const CONTEXT_SCHEMA = '2:' + (root.chrome?.runtime?.getManifest?.()?.version || 'local');
  const resetContext = text => /\b(?:banked resets?|reset credits?|codex.{0,60}(?:reset|limits?|quota)|(?:reset|limits?|quota).{0,60}codex|(?:usage|weekly|rate) limits?.{0,40}reset)\b/i.test(text || "");
  const publicContext = text => resetContext(text) ||
    (root.RadarSignals || (typeof require === 'function' ? require('./signals') : null))?.resetHeadline(text) ||
    /\b(?:dev\s?day|developer conference|codex|chatgpt|openai|sora|gpt[- ]?\d[\w.-]*)\b/i.test(text || "");
  const needsContext = item => item.truncated || item.quotedPost || /👀|🚀/.test(item.text) || /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|soon|next week|coming|eod|end of (?:the )?day|confirmed|landed|dev\s?day|launch|release|keynote|stay tuned|👀|surprise|refill|refuel|button|reset)\b|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(item.text);

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
    return items.map(item => {
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
    const { replyContext: _previousContext, ...original } = item;
    const target = result.rows[index];
    const verified = normalize([target], now).find(row => row.id === item.id && row.url === item.url);
    const base = verified && !verified.truncated ? { ...original, text: verified.text,
      pollOptions: verified.pollOptions || [], avatarUrl: verified.avatarUrl || original.avatarUrl, truncated: false } : original;
    // Only rows preceding this exact target on its own conversation page.
    const candidates = result.rows.slice(0, index).slice(-6).reverse();
    const context = candidates.find(row => typeof row.id === "string" && /^[1-9]\d{0,24}$/.test(row.id) &&
      typeof row.author === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(row.author) &&
      row.url === `https://x.com/${row.author}/status/${row.id}` && typeof row.text === "string" && !row.truncated &&
      Date.parse(row.createdAt) <= Date.parse(item.createdAt) && now - Date.parse(row.createdAt) <= 14 * day && publicContext(row.text));
    return context ? { ...base, isReply: true, replyContext: {
      id: context.id, author: context.author, text: context.text.slice(0, 6000), url: context.url,
      createdAt: context.createdAt, relation: "conversation-before", targetId: item.id
    } } : base;
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

  function read(signal, options) {
    return readJob ||= runRead(signal, options).finally(() => { readJob = undefined; });
  }
  async function runRead(signal, { authors = AUTHORS, contextCache = {}, retainedPosts = [], onCheckpoint } = {}) {
    if (!Array.isArray(authors) || !authors.length || authors.some(author => !AUTHORS.includes(author))) throw new Error('X_UNSUPPORTED_AUTHOR');
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
    const deadline = Date.now() + authors.length * 90000;
    const diagnostics = { posts: 0, contexts: 0, conversations: 0, conversationFailures: 0, pages: 0, stopReason: "unknown", timelines: [],
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
    async function bounded(promise, limit) {
      signal.throwIfAborted();
      let timer, abort;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("X_TIMEOUT")), Math.max(1, Math.min(limit, deadline - Date.now())));
          abort = () => reject(new Error("X_ABORTED"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        })]);
      } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
    }
    async function page(url) {
      currentStage = "navigation";
      signal.throwIfAborted();
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
        let settled = false;
        const finish = error => {
          if (settled) return; settled = true;
          clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated);
          signal.removeEventListener("abort", abort);
          error ? reject(error) : resolve();
        };
        const abort = () => finish(new Error("X_ABORTED"));
        const checkReady = () => chrome.tabs.get(tab.id).then(current => {
          if (settled) return;
          if (current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed ||
              (current.pendingUrl && !sameReaderPage(current.pendingUrl, currentUrl))) return finish(new Error("X_PAGE_UNAVAILABLE"));
          if (current.url?.startsWith("https://x.com/i/flow/login")) return finish(new Error("X_LOGIN_REQUIRED"));
          const requested = sameReaderPage(current.url, currentUrl);
          // tabs.update/create can return while the old document still says
          // complete. Its completion event must not certify the new page.
          if (requested && !current.pendingUrl && current.status === "complete") return finish();
          const previous = previousUrl && sameReaderPage(current.url, previousUrl);
          const initial = !previousUrl && (!current.url || current.url === "about:blank");
          if (!requested && !previous && !initial) finish(new Error("X_PAGE_UNAVAILABLE"));
        }, finish);
        const onUpdated = (id, change) => { if (id === tab.id && (change.status || change.url)) void checkReady(); };
        const timer = setTimeout(() => finish(new Error("X_TIMEOUT")), Math.max(1, Math.min(15000, deadline - Date.now())));
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
      const result = await bounded(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["src/x-reader.js"] }), TIMELINES.some(t => t.url === url) ? 32000 : 24000);
      signal.throwIfAborted();
      const afterRead = await chrome.tabs.get(tab.id);
      if (!sameReaderPage(afterRead.url, currentUrl) || (afterRead.pendingUrl && !sameReaderPage(afterRead.pendingUrl, currentUrl)) || afterRead.active || afterRead.pinned || afterRead.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
      return result?.find(frame => frame.frameId === 0)?.result;
    }
    const cache = Object.fromEntries(Object.entries(contextCache || {}).filter(([id, entry]) =>
      /^[1-9]\d{0,24}$/.test(id) && (entry?.checkedAt || entry?.queuedAt) > Date.now() - 7 * day));
    const collected = new Map(archivePosts(retainedPosts).filter(item => authors.includes(item.author.toLowerCase())).map(item => [item.id, item]));
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
        try { await onCheckpoint({ posts: archivePosts([...collected.values()]), contextCache: compactCache() }); }
        catch { diagnostics.checkpointError = true; }
      }
      signal.throwIfAborted();
    }
    try {
      let lastError;
      // X may expose a reply-only stream here; scan original posts separately
      // so a busy reply timeline cannot bury the latest reset announcement.
      for (const timeline of TIMELINES) {
        let bodyQuality = {};
        try {
          const result = await page(timeline.url);
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
            collected.set(item.id, { ...previous, ...item,
              ...(previous && !previous.truncated && item.truncated ? { text: previous.text, truncated: false } : {}),
              ...(previous?.replyContext && !item.replyContext ? { replyContext: previous.replyContext } : {}) });
          }
          const pages = Number(result?.pages) || 1;
          diagnostics.pages += pages;
          diagnostics.timelines.push({ author: timeline.author, kind: timeline.kind, ok: true, posts: rows.length, pages, expanded: Number(result?.expanded) || 0, stopReason: result?.stopReason || 'initial-load', ...bodyQuality });
          await checkpoint();
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
      const items = authors.flatMap(author => [...collected.values()].filter(item => item.author.toLowerCase() === author).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 160)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, authors.length * 160);
      if (!items.length) throw lastError || new Error("X_NO_PUBLIC_POSTS");
      diagnostics.posts = items.length;
      diagnostics.truncated = items.filter(item => item.truncated).length;
      diagnostics.stopReason = diagnostics.timelines.length === TIMELINES.length && diagnostics.timelines.every(t => t.ok) ? 'all-timelines' : 'partial';
      // Cache exact conversation results, including unrelated/no-parent results.
      // Otherwise the same three newest replies starve every older candidate.
      const pending = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index], entry = cache[item.id];
        if (!needsContext(item)) continue;
        const match = entry?.schema === CONTEXT_SCHEMA && entry.text === item.text && entry.truncated === item.truncated && entry.url === item.url && entry.createdAt === item.createdAt;
        // These short follow-ups can appear before X hydrates the parent.
        // An empty first read must not suppress their context retry for hours.
        const shortGrantReply = /\b(?:eod|end of (?:the )?day|confirmed.{0,20}landed)\b/i.test(item.text);
        const contextAge = shortGrantReply && !entry?.result?.rows?.some(row => row.id !== item.id &&
          (resetContext(row.text) || root.RadarSignals?.resetHeadline(row.text))) ? 5 * 60000 : 6 * 3600000;
        if (match && entry.result && entry.checkedAt > Date.now() - contextAge) {
          items[index] = conversationContext(item, entry.result);
          if (items[index].replyContext?.relation === 'conversation-before') diagnostics.contexts++;
        } else {
          cache[item.id] = { ...entry, queuedAt: entry?.queuedAt || Date.now() };
          pending.push(item);
        }
      }
      const age = item => cache[item.id]?.checkedAt || cache[item.id]?.queuedAt || 0;
      const priority = item => /\b(?:resets?|refill|refuel|eod|end of (?:the )?day|landed|limits?|quota)\b/i.test(item.text) ? 2 : item.truncated ? 1 : 0;
      const oldest = [...pending].sort((a, b) => age(a) - age(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      // Reserve one slot for the oldest pending attempt so a constant stream
      // of high-priority replies cannot starve less obvious clues forever.
      const candidates = [...pending].sort((a, b) => priority(b) - priority(a) || age(a) - age(b) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, pending.length > 3 ? 2 : 3);
      if (pending.length > 3) candidates.push(candidates.includes(oldest) ? pending.find(item => !candidates.includes(item)) : oldest);
      await checkpoint();
      let resolved = 0;
      for (const item of candidates) {
        if (deadline - Date.now() < 15000) { diagnostics.conversationFailures++; break; }
        cache[item.id] = { schema: CONTEXT_SCHEMA, text: item.text, truncated: item.truncated, url: item.url,
          createdAt: item.createdAt, queuedAt: cache[item.id]?.queuedAt || Date.now(), checkedAt: Date.now() };
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
          diagnostics.conversations++;
          resolved++;
          const enriched = conversationContext(item, conversation);
          // Cache only the target and the relevant preceding public post.
          const { replyContext: parent, ...target } = enriched;
          cache[item.id].result = { targetId: item.id, rows: parent ? [parent, target] : [target] };
          items[items.indexOf(item)] = enriched;
          collected.set(item.id, enriched);
          if (enriched.replyContext?.relation === "conversation-before") diagnostics.contexts++;
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
      return { items: linkQuotedContexts(items), diagnostics, contextCache: compactCache(), retainedPosts: archivePosts(items) };
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
