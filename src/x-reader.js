// Runs only in an extension-created public monitored-author timeline/conversation tab.
// Reads rendered posts, never cookies, credentials, private pages or page state.
(async function readPublicAuthorPage() {
  const author = /^\/(thsottiaux|reach_vb|openai)(?:\/|$)/i.exec(location.pathname)?.[1]?.toLowerCase();
  const timeline = author && ['/' + author, '/' + author + '/with_replies'].includes(location.pathname.toLowerCase());
  const targetId = /^\/(?:thsottiaux|reach_vb|openai)\/status\/([1-9]\d{0,24})$/i.exec(location.pathname)?.[1];
  const path = location.pathname;
  const allowed = () => location.origin === "https://x.com" && location.pathname === path;
  if (!allowed() || (!timeline && !targetId)) return { rows: [], stopReason: "wrong-page", pages: 0 };
  const deadline = Date.now() + (timeline ? 24000 : 9000); // Return collected rows before the worker deadline.
  const seen = new Map();
  const expanded = new Set();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function originalText(node) {
    if (!node) return "";
    // Translation add-ons may append custom elements to the original body.
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeName === "IMG") return node.getAttribute("alt") || "";
    if ((node.localName || "").includes("-")) return "";
    return Array.from(node.childNodes || []).map(originalText).join("");
  }

  function collect() {
    if (!allowed()) return [];
    const rows = [];
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      // Exclude identity/body inside a quoted post's role=link container.
      const own = element => element?.closest('article[data-testid="tweet"]') === article &&
        !element.closest('[role="link"]:not(a)');
      const time = Array.from(article.querySelectorAll("time")).find(own);
      const href = time?.closest("a")?.getAttribute("href") || "";
      const match = /^\/([a-zA-Z0-9_]{1,15})\/status\/([1-9]\d{0,24})\/?$/.exec(href);
      const body = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).find(own);
      if (!match || !time.getAttribute("datetime")) continue;
      const avatar = Array.from(article.querySelectorAll('[data-testid^="UserAvatar-Container-"] img')).find(image =>
        own(image) && image.closest('a')?.getAttribute('href')?.replace(/\/$/, '').toLowerCase() === '/' + match[1].toLowerCase());
      const avatarUrl = avatar?.getAttribute('src') || '';
      const previous = rows.at(-1);
      rows.push({ id: match[2], author: match[1], text: originalText(body).slice(0, 6000),
        avatarUrl, createdAt: time.getAttribute("datetime"), url: `https://x.com/${match[1]}/status/${match[2]}`,
        truncated: Array.from(article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')).some(own),
        adjacentId: previous?.id || "" });
      if (rows.length >= 160) break;
    }
    return rows;
  }

  async function expandOwnPosts() {
    if (!allowed()) return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const own = element => element?.closest('article[data-testid="tweet"]') === article && !element.closest('[role="link"]:not(a)');
      const time = Array.from(article.querySelectorAll('time')).find(own);
      const id = new RegExp('^/' + author + '/status/([1-9]\\d{0,24})/?$', 'i').exec(time?.closest('a')?.getAttribute('href') || '')?.[1];
      if (!id || expanded.has(id) || expanded.size >= 12 || Date.now() >= deadline) continue;
      const button = Array.from(article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')).find(own);
      // This exact inline body control expands text; never click menus, links,
      // quoted posts, reply composers or engagement buttons.
      if (button?.tagName !== 'BUTTON') continue;
      expanded.add(id); button.click();
      if (!allowed()) return;
    }
  }

  function remember(rows) {
    for (const row of rows) {
      if (seen.size >= 160 && !seen.has(row.id)) break;
      const previous = seen.get(row.id);
      seen.set(row.id, { ...previous, ...row, adjacentId: row.adjacentId || previous?.adjacentId || "",
        ...(previous && !previous.truncated && row.truncated ? { text: previous.text, truncated: false } : {}) });
    }
  }

  // Page completion does not imply hydrated posts. Wait for the requested row.
  for (let attempt = 0; attempt < 16 && Date.now() < deadline - 5000; attempt++) {
    if (!allowed()) return { rows: [], stopReason: "navigated", pages: 0 };
    const rows = collect();
    if (rows.some(row => targetId ? row.id === targetId && row.author.toLowerCase() === author : row.author.toLowerCase() === author)) break;
    await sleep(500);
  }
  remember(collect());
  await expandOwnPosts();
  await sleep(1000);
  if (targetId) {
    const rows = collect();
    const index = rows.findIndex(row => row.id === targetId && row.author.toLowerCase() === author);
    // Comments after the target cannot explain what it was replying to.
    return { rows: index < 0 ? [] : rows.slice(0, index + 1), targetId, pages: 1,
      stopReason: index < 0 ? "target-missing" : "conversation" };
  }

  let pages = 0, unchanged = 0, stopReason = "scan-limit";
  for (; pages < 24; pages++) {
    if (!allowed()) return { rows: [], stopReason: "navigated", pages };
    if (Date.now() >= deadline) { stopReason = "time-budget"; break; }
    const beforeExpansion = expanded.size;
    await expandOwnPosts();
    if (expanded.size > beforeExpansion) await sleep(250);
    const count = seen.size;
    const rows = collect();
    remember(rows); // Keep each viewport before X virtualizes it away.
    unchanged = seen.size === count ? unchanged + 1 : 0;
    const recentTibo = rows.filter(row => row.author.toLowerCase() === author).slice(-3);
    if (recentTibo.length === 3 && recentTibo.every(row => Date.now() - Date.parse(row.createdAt) > 7 * 86400000)) {
      stopReason = "seven-days"; break;
    }
    // X can leave an unchanged viewport while the next batch is loading.
    // Allow six attempts instead of treating a brief stall as the end.
    if (unchanged >= 6) { stopReason = "no-more-loaded"; break; }
    if (seen.size >= 160) { stopReason = "post-limit"; break; }
    window.scrollBy(0, Math.max(500, window.innerHeight * 0.85));
    await sleep(1000);
  }
  if (!allowed()) return { rows: [], stopReason: "navigated", pages };
  remember(collect());
  return { rows: [...seen.values()], pages: Math.min(pages + 1, 25), stopReason, expanded: expanded.size };
})();
