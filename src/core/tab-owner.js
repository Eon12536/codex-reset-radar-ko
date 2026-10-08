(function initTabOwner(root) {
  function create({ key, alarm, accepts, matches, prefix, recovery }) {
    const chrome = root.chrome;
    const guardKey = key + 'GuardV1';
    let tab, inUse = false, creating = false, restoring = false, creationJob, operations = Promise.resolve();
    const selectedDuringCreate = new Set(), selectedDuringRestore = new Set();
    const error = name => new Error(prefix + '_' + name);
    const tokenValid = token => typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token);
    function marked(url, token = tab?.token) {
      if (!recovery || !tokenValid(token)) return url;
      const value = new URL(url);
      value.hash = recovery.marker + '=' + token;
      return value.href;
    }
    async function persistGuard(blocked, reason) {
      const previous = recovery ? (await chrome.storage.local.get(guardKey))[guardKey] : null;
      await chrome.storage.local.set({ [guardKey]: { ...previous, blocked, reason,
        ...(recovery && tokenValid(tab?.token) ? { lease: tab } : {}) } });
    }
    async function recoverLease(guard) {
      if (!recovery || !chrome.tabs.query || !await chrome.permissions.contains(recovery.permission)) return null;
      const lease = valid(guard?.lease) && tokenValid(guard.lease.token) ? guard.lease : null;
      const pending = guard?.pending;
      const attempt = pending && tokenValid(pending.token) && accepts(pending.url) &&
        Number.isFinite(pending.startedAt) && Number.isFinite(pending.expiresAt) &&
        pending.expiresAt > pending.startedAt && pending.expiresAt - pending.startedAt <= 300000 ? pending : null;
      const urls = lease?.urls || (attempt ? [attempt.url] : recovery.urls);
      // Redirects can leave an owned reader on X's login/home page. Query
      // those public destinations too before proving the reader is absent.
      const candidates = await chrome.tabs.query({ url: [...new Set([...urls, ...recovery.urls])] });
      if (lease && !candidates.some(current => current.id === lease.id)) {
        try {
          const previous = await chrome.tabs.get(lease.id);
          if (previous.url === 'about:blank') candidates.push(previous);
        } catch (cause) {
          if (!/No tab with id|Invalid tab ID/i.test(String(cause?.message))) throw cause;
        }
      }
      if (lease || attempt) {
        const token = (lease || attempt).token;
        const owned = candidates.filter(current => {
          try { return new URL(current.url).hash === '#' + recovery.marker + '=' + token && matches(current.url, urls); }
          catch { return false; }
        });
        if (owned.length === 1) {
          const current = owned[0];
          return { ...(lease || { startedAt: attempt.startedAt, expiresAt: attempt.expiresAt, urls, claimed: false }),
            id: current.id, windowId: current.windowId, token,
            claimed: Boolean(lease?.claimed || current.active || current.pinned) };
        }
        // A create interrupted before its ID was stored can still complete.
        // Keep its durable marker fenced for a minute before proving absence.
        if (attempt && Date.now() - attempt.startedAt < 60000) {
          await watch(attempt.startedAt + 60000);
          return null;
        }
      }
      // Prove absence; never delete or adopt an unmarked user tab. Legacy
      // fences can recover automatically only when no possible reader remains.
      return candidates.length === 0 ? false : null;
    }
    function operation(action) {
      const result = operations.then(action);
      operations = result.catch(() => {});
      return result;
    }
    function valid(value) {
      return value && Number.isInteger(value.id) && value.id >= 0 && Number.isInteger(value.windowId) && value.windowId >= 0 &&
        Number.isFinite(value.startedAt) && Number.isFinite(value.expiresAt) && value.startedAt > 0 &&
        value.expiresAt > value.startedAt && value.expiresAt - value.startedAt <= 300000 &&
        typeof value.claimed === 'boolean' && Array.isArray(value.urls) && value.urls.length > 0 && value.urls.length <= 12 && value.urls.every(accepts);
    }
    async function watch(when) {
      await chrome.alarms.create(alarm, { when: Math.max(Date.now() + 60000, when) });
    }
    async function forget() {
      // Clear the durable fence first, only after the tab is known to be gone.
      // If interrupted between removals, the surviving session record is safe
      // to recover; the reverse order could strand a fence after every scan.
      await chrome.storage.local.remove(guardKey);
      await chrome.storage.session.remove(key);
      tab = undefined; inUse = false;
      await chrome.alarms.clear(alarm);
    }
    function cleanup({ force = false, recover = false } = {}) {
      return operation(async () => {
        try {
          if (force || recover) inUse = false;
          if (!tab) {
            restoring = true;
            try {
              const value = (await chrome.storage.session.get(key))[key];
              const guard = (await chrome.storage.local.get(guardKey))[guardKey];
              if (!value && !guard) { await chrome.alarms.clear(alarm); return true; }
              // Reload/update/browser restart clears storage.session. Tab IDs
              // from another browser session must never authorize deletion.
              if (!valid(value)) {
                const recovered = await recoverLease(guard);
                if (recovered === false) { await forget(); return true; }
                if (recovered) {
                  tab = recovered;
                  await chrome.storage.session.set({ [key]: tab });
                } else {
                  // Retain the durable proof if an active/pending reader has
                  // not yet been resolved; later cleanup can retry safely.
                  await chrome.storage.local.set({ [guardKey]: { ...guard, blocked: true, reason: 'session-lost' } });
                  await watch(Date.now() + 60000);
                  return false;
                }
              } else {
                tab = value;
              }
              if (selectedDuringRestore.has(tab.id)) tab.claimed = true;
            } finally { restoring = false; selectedDuringRestore.clear(); }
          }
          if (!force && !(recover && !inUse) && Date.now() < tab.expiresAt) {
            await watch(tab.expiresAt); return false;
          }
          let current;
          try { current = await chrome.tabs.get(tab.id); }
          catch (cause) {
            if (!/No tab with id|Invalid tab ID/i.test(String(cause?.message))) throw cause;
            await forget(); return true;
          }
          // Preserve user/ambiguous tabs AND the ownership record. Forgetting
          // that record previously allowed every retry to leave one more tab.
          if (tab.claimed || current.active || current.pinned || current.windowId !== tab.windowId || !matches(current.url, tab.urls)) {
            inUse = false;
            tab.claimed = true;
            await persistGuard(true, 'tab-open');
            await chrome.storage.session.set({ [key]: tab });
            await watch(Date.now() + 60000);
            return false;
          }
          await chrome.tabs.remove(tab.id);
          await forget(); return true;
        } catch {
          try { await persistGuard(true, 'cleanup-failed'); } catch { /* Existing records still fence creation. */ }
          try { await watch(Date.now() + 60000); } catch { /* The next caller retries. */ }
          throw error('TAB_CLEANUP_FAILED');
        }
      });
    }
    chrome?.tabs?.onActivated?.addListener(({ tabId }) => {
      if (creating) selectedDuringCreate.add(tabId);
      if (restoring) selectedDuringRestore.add(tabId);
      if (tab?.id === tabId) tab.claimed = true;
      void operation(async () => {
        const value = tab || (await chrome.storage.session.get(key))[key];
        if (valid(value) && value.id === tabId) {
          value.claimed = true; tab = value;
          await persistGuard(true, 'tab-open');
          await chrome.storage.session.set({ [key]: value });
        }
      }).catch(() => {});
    });
    async function runCreate(url, expiresAt) {
      if (!accepts(url)) throw error('UNSUPPORTED_PAGE');
      if (!await cleanup({ force: true })) throw error('TAB_BLOCKED');
      let created;
      creating = true;
      try {
        // Persist BEFORE calling Chrome: termination during tabs.create can
        // otherwise lose the ID while still leaving the real tab open.
        const token = recovery ? root.crypto.randomUUID() : null;
        const startedAt = Date.now();
        await chrome.storage.local.set({ [guardKey]: { blocked: false, reason: 'creating',
          ...(token ? { pending: { token, url, startedAt, expiresAt } } : {}) } });
        created = await chrome.tabs.create({ url: marked(url, token), active: false });
        tab = { id: created.id, windowId: created.windowId, startedAt, expiresAt, urls: [url],
          ...(token ? { token } : {}), claimed: Boolean(created.active) || selectedDuringCreate.has(created.id) };
        inUse = true;
        await operation(async () => {
          await watch(tab.expiresAt);
          if (token) await persistGuard(false, 'owned');
          await chrome.storage.session.set({ [key]: tab });
        });
        return created;
      } catch (cause) {
        // Creation may have succeeded even though persisting its ID failed.
        // Keep cleanup inside this method so a rejected caller cannot lose it.
        if (created?.id !== undefined) await cleanup({ force: true });
        else {
          const guard = (await chrome.storage.local.get(guardKey))[guardKey];
          await chrome.storage.local.set({ [guardKey]: { ...guard, blocked: true, reason: 'creation-unconfirmed' } }).catch(() => {});
        }
        throw cause;
      } finally { creating = false; selectedDuringCreate.clear(); }
    }
    function open(url, expiresAt) {
      return creationJob ||= runCreate(url, expiresAt).finally(() => { creationJob = undefined; });
    }
    function navigate(id, url, signal) {
      return operation(async () => {
        if (!accepts(url) || tab?.id !== id || tab.claimed) throw error('PAGE_UNAVAILABLE');
        if (!tab.urls.includes(url)) tab.urls.push(url);
        if (recovery) await persistGuard(false, 'owned');
        await chrome.storage.session.set({ [key]: tab });
        signal?.throwIfAborted();
        if (tab.claimed) throw error('PAGE_UNAVAILABLE');
        return chrome.tabs.update(id, { url: marked(url) });
      });
    }
    async function resume() {
      // Only an explicit options-page confirmation may release a lost-session
      // fence. A tab still tracked in this session must actually be closed.
      return operation(async () => {
        if (creating || creationJob || inUse) return false;
        const value = tab || (await chrome.storage.session.get(key))[key];
        if (valid(value)) {
          try { await chrome.tabs.get(value.id); return false; }
          catch (cause) { if (!/No tab with id|Invalid tab ID/i.test(String(cause?.message))) throw cause; }
        }
        await forget();
        return true;
      });
    }
    return Object.freeze({ cleanup, open, navigate, resume, guardKey, url: marked, get tab() { return tab; } });
  }
  root.RadarTabOwner = Object.freeze({ create });
  if (typeof module !== 'undefined') module.exports = root.RadarTabOwner;
})(globalThis);
