(function initTabOwner(root) {
  function create({ key, alarm, accepts, matches, prefix }) {
    const chrome = root.chrome;
    const guardKey = key + 'GuardV1';
    let tab, inUse = false, creating = false, restoring = false, creationJob, operations = Promise.resolve();
    const selectedDuringCreate = new Set(), selectedDuringRestore = new Set();
    const error = name => new Error(prefix + '_' + name);
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
                await chrome.storage.local.set({ [guardKey]: { blocked: true, reason: 'session-lost' } });
                await chrome.alarms.clear(alarm);
                return false;
              }
              tab = value;
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
            await chrome.storage.local.set({ [guardKey]: { blocked: true, reason: 'tab-open' } });
            await chrome.storage.session.set({ [key]: tab });
            await watch(Date.now() + 60000);
            return false;
          }
          await chrome.tabs.remove(tab.id);
          await forget(); return true;
        } catch {
          try { await chrome.storage.local.set({ [guardKey]: { blocked: true, reason: 'cleanup-failed' } }); } catch { /* Existing records still fence creation. */ }
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
        await chrome.storage.local.set({ [guardKey]: { blocked: false, reason: 'creating' } });
        created = await chrome.tabs.create({ url, active: false });
        tab = { id: created.id, windowId: created.windowId, startedAt: Date.now(), expiresAt, urls: [url], claimed: Boolean(created.active) || selectedDuringCreate.has(created.id) };
        inUse = true;
        await operation(async () => {
          await watch(tab.expiresAt);
          await chrome.storage.session.set({ [key]: tab });
        });
        return created;
      } catch (cause) {
        // Creation may have succeeded even though persisting its ID failed.
        // Keep cleanup inside this method so a rejected caller cannot lose it.
        if (created?.id !== undefined) await cleanup({ force: true });
        else await chrome.storage.local.set({ [guardKey]: { blocked: true, reason: 'creation-unconfirmed' } }).catch(() => {});
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
        await chrome.storage.session.set({ [key]: tab });
        signal?.throwIfAborted();
        if (tab.claimed) throw error('PAGE_UNAVAILABLE');
        return chrome.tabs.update(id, { url });
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
    return Object.freeze({ cleanup, open, navigate, resume, guardKey, get tab() { return tab; } });
  }
  root.RadarTabOwner = Object.freeze({ create });
  if (typeof module !== 'undefined') module.exports = root.RadarTabOwner;
})(globalThis);
