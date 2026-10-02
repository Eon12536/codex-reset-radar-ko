(function initTheme(root) {
  const media = root.matchMedia?.("(prefers-color-scheme: dark)");
  let preference = "system";
  let revision = 0;
  let appearanceRevision = 0;
  let legacyRevision = 0;
  let storedAppearance;
  let legacyTheme = "system";
  const listeners = new Set();
  const valid = value => ["system", "light", "dark"].includes(value);
  function normalize(value) {
    return valid(value) ? value : "system";
  }
  function resolve(value, systemDark = Boolean(media?.matches)) {
    const mode = normalize(value);
    return mode === "system" ? (systemDark ? "dark" : "light") : mode;
  }
  function paint() {
    const theme = resolve(preference);
    root.document?.documentElement?.setAttribute("data-theme", theme);
    return theme;
  }
  function setPreference(value) {
    preference = normalize(value);
    const resolved = paint();
    for (const listener of listeners) listener(preference);
    return resolved;
  }
  function apply(value) {
    revision += 1;
    return setPreference(value);
  }
  function current() { return preference; }
  function fromStorage(data) {
    return valid(data?.appearanceTheme) ? data.appearanceTheme : normalize(data?.settings?.theme);
  }
  async function read() {
    return fromStorage(await root.chrome.storage.local.get(["appearanceTheme", "settings"]));
  }
  async function save(value) {
    if (!valid(value)) throw new TypeError("Unsupported theme");
    // Appearance is independent of worker versions, account polling and full
    // settings writes. Never rewrite account consent from a UI snapshot.
    await root.chrome.storage.local.set({ appearanceTheme: value });
    storedAppearance = value;
    appearanceRevision += 1;
    apply(value);
    return value;
  }
  function subscribe(listener) {
    listeners.add(listener);
    listener(preference);
    return () => listeners.delete(listener);
  }

  let ready = Promise.resolve();
  if (root.document) {

  // Runs in the head: a system preference is available before the first paint.
  apply("system");
  media?.addEventListener("change", () => { if (preference === "system") paint(); });
  root.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || (!changes.appearanceTheme && !changes.settings)) return;
    if (changes.appearanceTheme) { storedAppearance = changes.appearanceTheme.newValue; appearanceRevision += 1; }
    if (changes.settings) { legacyTheme = normalize(changes.settings.newValue?.theme); legacyRevision += 1; }
    setPreference(valid(storedAppearance) ? storedAppearance : legacyTheme);
  });
  const initialRevision = revision;
  const initialAppearanceRevision = appearanceRevision;
  const initialLegacyRevision = legacyRevision;
  ready = root.chrome?.storage?.local?.get(["appearanceTheme", "settings"]).then(data => {
    // A delayed initial read must not undo a newer selection/storage change.
    if (appearanceRevision === initialAppearanceRevision) storedAppearance = data.appearanceTheme;
    if (legacyRevision === initialLegacyRevision) legacyTheme = normalize(data.settings?.theme);
    if (revision === initialRevision) setPreference(valid(storedAppearance) ? storedAppearance : legacyTheme);
  }).catch(() => { /* Keep the system theme when storage is unavailable. */ });
  }
  root.RadarTheme = Object.freeze({ normalize, resolve, apply, current, read, save, subscribe, ready });
  if (typeof module !== "undefined") module.exports = root.RadarTheme;
})(globalThis);
