(function initTabOwner(root) {
  function create({ key, alarm, accepts, matches, prefix }) {
    const chrome = root.chrome;
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
      await chrome.storage.session.remove(key);
      tab = undefined; inUse = false;
      await chrome.alarms.clear(alarm);
    }
    function cleanup({ force = false, recover = false } = {}) {
      return operation(async () => {
        try {
          if (!tab) {
            restoring = true;
            try {
              const value = (await chrome.storage.session.get(key))[key];
              if (!value) { await chrome.alarms.clear(alarm); return true; }
              if (!valid(value)) { await forget(); return true; }
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
          // A selected, pinned, moved or independently navigated tab belongs
          // to the user. Never find or remove arbitrary tabs with a similar URL.
          if (!tab.claimed && !current.active && !current.pinned && current.windowId === tab.windowId && matches(current.url, tab.urls))
            await chrome.tabs.remove(tab.id);
          await forget(); return true;
        } catch {
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
      await cleanup({ force: true });
      let created;
      creating = true;
      try {
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
    return Object.freeze({ cleanup, open, navigate, get tab() { return tab; } });
  }
  root.RadarTabOwner = Object.freeze({ create });
  if (typeof module !== 'undefined') module.exports = root.RadarTabOwner;
})(globalThis);
