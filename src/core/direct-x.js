(function initDirectX(root) {
  const URL = "https://x.com/thsottiaux/with_replies";
  const POST_URL = "https://x.com/thsottiaux";
  const AUTHORS = ['thsottiaux', 'reach_vb', 'openai'];
  const trusted = author => AUTHORS.includes(String(author || '').toLowerCase());
  const PERMISSION = { permissions: ["scripting"], origins: ["https://x.com/*"] };
  const CLEANUP_ALARM = 'codex-reset-radar-x-tab-cleanup';
  const scanUrl = value => typeof value === 'string' && /^https:\/\/x\.com\/(?:thsottiaux|reach_vb|OpenAI)(?:\/with_replies|\/status\/[1-9]\d{0,24})?$/i.test(value);
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
  const owner = TabOwner.create({ key: 'directXScanTabV1', alarm: CLEANUP_ALARM, accepts: scanUrl, matches: ownedUrl, prefix: 'X' });
  let readJob;
  const day = 86400000;
  const resetContext = text => /\b(?:banked resets?|reset credits?|codex.{0,60}(?:reset|limits?|quota)|(?:reset|limits?|quota).{0,60}codex|(?:usage|weekly|rate) limits?.{0,40}reset)\b/i.test(text || "");
  const publicContext = text => resetContext(text) || /\b(?:dev\s?day|developer conference|codex|chatgpt|openai|sora|gpt[- ]?\d[\w.-]*)\b/i.test(text || "");
  const needsContext = item => item.truncated || /👀|🚀/.test(item.text) || /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|soon|next week|coming|dev\s?day|launch|release|keynote|stay tuned|👀|surprise|refill|refuel|button|reset)\b|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]\.?m\.?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(item.text);

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
    return items.map(item => {
      const quote = item.quotedPost;
      if (!quote) return item;
      const matches = items.filter(parent => parent.id !== item.id && !parent.truncated &&
        parent.author.toLowerCase() === quote.author && parent.createdAt === quote.createdAt &&
        parent.text === quote.text && Date.parse(parent.createdAt) <= Date.parse(item.createdAt));
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
      if (row.url !== `https://x.com/${row.author}/status/${row.id}` || typeof row.text !== "string") return [];
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
      row.url === `https://x.com/${row.author}/status/${row.id}` && typeof row.text === "string" &&
      Date.parse(row.createdAt) <= Date.parse(item.createdAt) && now - Date.parse(row.createdAt) <= 14 * day && publicContext(row.text));
    return context ? { ...base, isReply: true, replyContext: {
      id: context.id, author: context.author, text: context.text.slice(0, 6000), url: context.url,
      createdAt: context.createdAt, relation: "conversation-before", targetId: item.id
    } } : base;
  }

  function failureReason(error) {
    const message = String(error?.message || "");
    if (/PERMISSION/.test(message)) return "permission";
    if (/TAB_BLOCKED|TAB_CLEANUP_FAILED/.test(message)) return "tab-blocked";
    if (/LOGIN/.test(message)) return "login";
    if (/TIMEOUT/.test(message)) return "timeout";
    if (/NO_PUBLIC_POSTS/.test(message)) return "no-posts";
    return "page-unavailable";
  }

  function read(signal, options) {
    return readJob ||= runRead(signal, options).finally(() => { readJob = undefined; });
  }
  async function runRead(signal, { authors = AUTHORS, contextCache = {} } = {}) {
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
    const diagnostics = { posts: 0, contexts: 0, conversations: 0, conversationFailures: 0, pages: 0, stopReason: "unknown", timelines: [] };
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
      if (tab) {
        const current = await chrome.tabs.get(tab.id);
        if (current.url !== currentUrl || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
        currentUrl = url;
        await owner.navigate(tab.id, url, signal);
        signal.throwIfAborted();
      } else {
        currentUrl = url;
        tab = await owner.open(url, deadline + 30000);
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
        const onUpdated = (id, change) => { if (id === tab.id && change.status === "complete") finish(); };
        const timer = setTimeout(() => finish(new Error("X_TIMEOUT")), Math.max(1, Math.min(15000, deadline - Date.now())));
        chrome.tabs.onUpdated.addListener(onUpdated);
        signal.addEventListener("abort", abort, { once: true });
        chrome.tabs.get(tab.id).then(current => { if (current.status === "complete") finish(); }, finish);
        if (signal.aborted) abort();
      });
      signal.throwIfAborted();
      const current = await chrome.tabs.get(tab.id);
      if (current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
      if (current.url?.startsWith("https://x.com/i/flow/login")) throw new Error("X_LOGIN_REQUIRED");
      if (current.url !== url) throw new Error("X_PAGE_UNAVAILABLE");
      currentStage = "reading";
      const result = await bounded(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["src/x-reader.js"] }), TIMELINES.some(t => t.url === url) ? 32000 : 14000);
      signal.throwIfAborted();
      const afterRead = await chrome.tabs.get(tab.id);
      if (afterRead.url !== url || afterRead.active || afterRead.pinned || afterRead.windowId !== owner.tab?.windowId || owner.tab?.claimed) throw new Error("X_PAGE_UNAVAILABLE");
      return result?.find(frame => frame.frameId === 0)?.result;
    }
    try {
      const collected = new Map();
      let lastError;
      // X may expose a reply-only stream here; scan original posts separately
      // so a busy reply timeline cannot bury the latest reset announcement.
      for (const timeline of TIMELINES) {
        try {
          const result = await page(timeline.url);
          const rows = normalize(Array.isArray(result) ? result : result?.rows).filter(item => item.author.toLowerCase() === timeline.author);
          if (!rows.length) throw new Error('X_NO_PUBLIC_POSTS');
          for (const item of rows) {
            const previous = collected.get(item.id);
            collected.set(item.id, { ...previous, ...item,
              ...(previous && !previous.truncated && item.truncated ? { text: previous.text, truncated: false } : {}),
              ...(previous?.replyContext && !item.replyContext ? { replyContext: previous.replyContext } : {}) });
          }
          const pages = Number(result?.pages) || 1;
          diagnostics.pages += pages;
          diagnostics.timelines.push({ author: timeline.author, kind: timeline.kind, ok: true, posts: rows.length, pages, expanded: Number(result?.expanded) || 0, stopReason: result?.stopReason || 'initial-load' });
        } catch (error) {
          signal.throwIfAborted(); lastError = error;
          diagnostics.timelines.push({ author: timeline.author, kind: timeline.kind, ok: false, error: failureReason(error), stage: currentStage });
          // A failed tab creation/persistence is not a failed author timeline.
          // Retrying another timeline would open more tabs against the same
          // unavailable ownership store in this single scan.
          if (!tab) throw error;
          if (tab) {
            const current = await chrome.tabs.get(tab.id).catch(() => ({}));
            if (current.url !== currentUrl || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) break;
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
      const cache = Object.fromEntries(Object.entries(contextCache).filter(([, entry]) => entry?.checkedAt > Date.now() - 7 * day));
      const pending = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index], entry = cache[item.id];
        if (!needsContext(item)) continue;
        const match = entry && entry.text === item.text && entry.truncated === item.truncated && entry.url === item.url && entry.createdAt === item.createdAt;
        if (match && entry.result && entry.checkedAt > Date.now() - 6 * 3600000) {
          items[index] = conversationContext(item, entry.result);
          if (items[index].replyContext?.relation === 'conversation-before') diagnostics.contexts++;
        } else pending.push(item);
      }
      const candidates = pending.sort((a, b) => (cache[a.id]?.checkedAt || 0) - (cache[b.id]?.checkedAt || 0) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3);
      let resolved = 0;
      for (const item of candidates) {
        if (deadline - Date.now() < 15000) { diagnostics.conversationFailures++; break; }
        cache[item.id] = { text: item.text, truncated: item.truncated, url: item.url, createdAt: item.createdAt, checkedAt: Date.now() };
        try {
          const conversation = await page(item.url);
          if (conversation?.targetId !== item.id || !conversation.rows?.some(row => row.id === item.id && row.author?.toLowerCase() === item.author.toLowerCase()))
            throw new Error("X_NO_PUBLIC_POSTS");
          diagnostics.conversations++;
          resolved++;
          const enriched = conversationContext(item, conversation);
          // Cache only the target and the relevant preceding public post.
          const { replyContext: parent, ...target } = enriched;
          cache[item.id].result = { targetId: item.id, rows: parent ? [parent, target] : [target] };
          items[items.indexOf(item)] = enriched;
          if (enriched.replyContext?.relation === "conversation-before") diagnostics.contexts++;
        } catch (error) {
          signal.throwIfAborted();
          diagnostics.conversationFailures++;
          // A user's navigation or login wall must stop subsequent navigation.
          const current = await chrome.tabs.get(tab.id).catch(() => ({}));
          if (current.url !== currentUrl || current.active || current.pinned || current.windowId !== owner.tab?.windowId || owner.tab?.claimed) break;
        }
      }
      diagnostics.contextPending = pending.length - resolved;
      diagnostics.truncated = items.filter(item => item.truncated).length;
      return { items: linkQuotedContexts(items), diagnostics, contextCache: Object.fromEntries(Object.entries(cache)
        .sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 160)) };
    } finally {
      if (tab?.id !== undefined) await owner.cleanup({ force: true });
    }
  }

  root.RadarDirectX = Object.freeze({ normalize, conversationContext, linkQuotedContexts, failureReason, read, cleanup: owner.cleanup, resume: owner.resume, GUARD_KEY: owner.guardKey, CLEANUP_ALARM, PERMISSION, AUTHORS });
  if (typeof module !== "undefined") module.exports = root.RadarDirectX;
})(globalThis);
