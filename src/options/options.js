const form = document.getElementById("settingsForm");
const saveState = document.getElementById("saveState");
const msg = (key, substitutions, fallback) => RadarI18n.t(key, substitutions, fallback);
let saveTimer = null;

RadarI18n.apply();

function control(id) {
  return document.getElementById(id);
}

function setRadio(name, value) {
  const target = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (target) target.checked = true;
}

function radioValue(name) {
  return form.querySelector(`input[name="${name}"]:checked`)?.value;
}

function renderTimezoneMode() {
  const manual = radioValue("timezoneMode") === "manual";
  control("timezoneOverrideRow").classList.toggle("hidden", !manual);
}

async function load() {
  const { settings } = await chrome.storage.local.get("settings");
  const value = RadarSettings.sanitize(settings);
  for (const key of [
    "monitorSignals", "monitorAccount", "notifyOfficialReset", "notifyCreditExpiry",
    "notifyAdvice", "quietHoursEnabled", "monitorLeadSource", "monitorStatusSource",
    "monitorHistorySource", "monitorCommunitySource"
  ]) control(key).checked = Boolean(value[key]);
  for (const key of ["pollMinutes", "timezoneOverride", "quietStart", "quietEnd"]) {
    control(key).value = value[key];
  }
  setRadio("confidenceThreshold", value.confidenceThreshold);
  setRadio("timezoneMode", value.timezoneMode);
  control("systemTimezoneLabel").textContent = msg("currentSystemTimeZone", RadarTime.systemTimeZone(), "Current system time zone: $1");
  control("publicSourceText").textContent = value.sourceUrl || msg("weightedPublicSources", String(RadarSources.enabled(value).length), "$1 weighted public sources");
  renderTimezoneMode();
}

function readSettings() {
  return RadarSettings.sanitize({
    monitorSignals: control("monitorSignals").checked,
    monitorAccount: control("monitorAccount").checked,
    monitorLeadSource: control("monitorLeadSource").checked,
    monitorStatusSource: control("monitorStatusSource").checked,
    monitorHistorySource: control("monitorHistorySource").checked,
    monitorCommunitySource: control("monitorCommunitySource").checked,
    pollMinutes: Number(control("pollMinutes").value),
    confidenceThreshold: radioValue("confidenceThreshold"),
    notifyOfficialReset: control("notifyOfficialReset").checked,
    notifyCreditExpiry: control("notifyCreditExpiry").checked,
    notifyAdvice: control("notifyAdvice").checked,
    quietHoursEnabled: control("quietHoursEnabled").checked,
    quietStart: control("quietStart").value,
    quietEnd: control("quietEnd").value,
    timezoneMode: radioValue("timezoneMode"),
    timezoneOverride: control("timezoneOverride").value
  });
}

async function save() {
  const settings = readSettings();
  if (settings.timezoneMode === "manual" && !RadarTime.isValidTimeZone(settings.timezoneOverride)) {
    saveState.textContent = msg("invalidTimeZone", undefined, "Invalid time zone");
    saveState.style.color = "var(--danger)";
    return;
  }
  saveState.textContent = msg("saving", undefined, "Saving…");
  saveState.style.color = "var(--muted)";
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  control("publicSourceText").textContent = settings.sourceUrl || msg("weightedPublicSources", String(RadarSources.enabled(settings).length), "$1 weighted public sources");
  saveState.textContent = msg("saved", undefined, "Saved");
  saveState.style.color = "var(--teal)";
}

form.addEventListener("input", (event) => {
  if (event.target.name === "timezoneMode") renderTimezoneMode();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    control(button.dataset.target).scrollIntoView({ behavior: "smooth" });
  });
});

control("clearData").addEventListener("click", async () => {
  const confirmed = confirm(msg("clearDataConfirm", undefined, "Clear quota snapshots, signal history, and notification deduplication records? Settings will be kept."));
  if (!confirmed) return;
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ settings: RadarSettings.sanitize(settings) });
  await chrome.storage.session.clear();
  saveState.textContent = msg("localDataCleared", undefined, "Local data cleared");
});

load();
