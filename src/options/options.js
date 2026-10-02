const form = document.getElementById("settingsForm");
const saveState = document.getElementById("saveState");
const msg = (key, substitutions, fallback) => RadarI18n.t(key, substitutions, fallback);
let saveTimer = null;
let accountChecking = false;
let loginOpened = false;

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
    "monitorSignals", "monitorAccount", "monitorChat", "syncChatHistory", "syncChatResetWithCodex", "notifyOfficialReset", "notifyCreditExpiry",
    "notifyAdvice", "notifyHints", "notifyScheduleChanges", "notifyAccountReset", "notifyBankedReset", "notifyRecoveryOnResume", "quietHoursEnabled", "monitorLeadSource", "monitorStatusSource",
    "monitorHistorySource", "monitorCommunitySource", "monitorDirectX", "notifyPublicOnResume"
  ]) control(key).checked = Boolean(value[key]);
  await RadarTheme.ready;
  setRadio("theme", RadarTheme.current());
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
    theme: RadarTheme.current(),
    monitorSignals: control("monitorSignals").checked,
    monitorAccount: control("monitorAccount").checked,
    monitorChat: control("monitorChat").checked,
    syncChatHistory: control("syncChatHistory").checked,
    syncChatResetWithCodex: control("syncChatResetWithCodex").checked,
    monitorLeadSource: control("monitorLeadSource").checked,
    monitorDirectX: control("monitorDirectX").checked,
    monitorStatusSource: control("monitorStatusSource").checked,
    monitorHistorySource: control("monitorHistorySource").checked,
    monitorCommunitySource: control("monitorCommunitySource").checked,
    pollMinutes: Number(control("pollMinutes").value),
    confidenceThreshold: radioValue("confidenceThreshold"),
    notifyOfficialReset: control("notifyOfficialReset").checked,
    notifyHints: control("notifyHints").checked,
    notifyScheduleChanges: control("notifyScheduleChanges").checked,
    notifyAccountReset: control("notifyAccountReset").checked,
    notifyBankedReset: control("notifyBankedReset").checked,
    notifyRecoveryOnResume: control("notifyRecoveryOnResume").checked,
    notifyPublicOnResume: control("notifyPublicOnResume").checked,
    notifyCreditExpiry: control("notifyCreditExpiry").checked,
    notifyAdvice: control("notifyAdvice").checked,
    quietHoursEnabled: control("quietHoursEnabled").checked,
    quietStart: control("quietStart").value,
    quietEnd: control("quietEnd").value,
    timezoneMode: radioValue("timezoneMode"),
    timezoneOverride: control("timezoneOverride").value
  });
}

async function save({ accountOff = false } = {}) {
  let settings = readSettings();
  if (settings.timezoneMode === "manual" && !RadarTime.isValidTimeZone(settings.timezoneOverride)) {
    if (!accountOff) {
      saveState.textContent = msg("invalidTimeZone", undefined, "Invalid time zone");
      saveState.style.color = "var(--danger)";
      return;
    }
    // A separate invalid field must never prevent the privacy switch from turning off.
    const stored = await chrome.storage.local.get("settings");
    settings = RadarSettings.sanitize({ ...stored.settings, monitorAccount: false });
  }
  saveState.textContent = msg("saving", undefined, "Saving…");
  saveState.style.color = "var(--muted)";
  const result = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  if (!result?.ok) {
    saveState.textContent = msg("retryAfterRefresh", undefined, "Refresh and try again");
    saveState.style.color = "var(--danger)";
    return false;
  }
  control("publicSourceText").textContent = settings.sourceUrl || msg("weightedPublicSources", String(RadarSources.enabled(settings).length), "$1 weighted public sources");
  saveState.textContent = msg("saved", undefined, "Saved");
  saveState.style.color = "var(--teal)";
  return true;
}

async function saveAppearance() {
  const picker = control("theme");
  const selected = radioValue("theme");
  const previous = RadarTheme.current();
  picker.disabled = true;
  RadarTheme.apply(selected);
  saveState.textContent = "테마 저장 중…";
  saveState.style.color = "var(--muted)";
  try {
    await RadarTheme.save(selected);
    saveState.textContent = "테마 저장됨";
    saveState.style.color = "var(--teal)";
  } catch {
    let saved = previous;
    try { saved = await RadarTheme.read(); } catch { /* Keep the confirmed theme. */ }
    RadarTheme.apply(saved);
    saveState.textContent = "테마를 저장하지 못했어요. 다시 선택해 주세요.";
    saveState.style.color = "var(--danger)";
  } finally {
    picker.disabled = false;
  }
}

form.addEventListener("input", (event) => {
  if (event.target.id === "syncChatHistory") {
    clearTimeout(saveTimer); saveTimer = null;
    return; // Dedicated handler saves only this consent switch.
  }
  if (event.target.id === "monitorChat") {
    clearTimeout(saveTimer); saveTimer = null;
    changeChatCounter();
    return;
  }
  if (event.target.id === "monitorDirectX") {
    clearTimeout(saveTimer); saveTimer = null;
    changeDirectX();
    return;
  }
  if (event.target.name === "theme") {
    saveAppearance();
    return;
  }
  if (event.target.name === "timezoneMode") renderTimezoneMode();
  clearTimeout(saveTimer);
  saveTimer = null;
  saveState.textContent = msg("saving", undefined, "Saving…");
  saveState.style.color = "var(--muted)";
  if (event.target.id === "monitorAccount" && !event.target.checked) {
    save({ accountOff: true }).catch(() => { saveState.textContent = msg("retryAfterRefresh"); });
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save().catch(() => { saveState.textContent = msg("retryAfterRefresh"); });
  }, 350);
});

const tabs = [...document.querySelectorAll(".nav-item")];
function selectSection(button) {
  for (const item of tabs) {
    const selected = item === button;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
    control(item.dataset.target).hidden = !selected;
  }
}
tabs.forEach((button, index) => {
  button.addEventListener("click", () => selectSection(button));
  button.addEventListener("keydown", (event) => {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
    if (!offset && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectSection(tabs[next]);
    tabs[next].focus();
  });
});

form.addEventListener("submit", event => event.preventDefault());

control("clearData").addEventListener("click", async () => {
  const confirmed = confirm(msg("clearDataConfirm", undefined, "Clear quota snapshots, signal history, and notification deduplication records? Settings will be kept."));
  if (!confirmed) return;
  const result = await chrome.runtime.sendMessage({ type: "CLEAR_LOCAL_DATA" });
  saveState.textContent = result?.ok ? msg("localDataCleared", undefined, "Local data cleared") : msg("retryAfterRefresh", undefined, "Refresh and try again");
});

// A popup theme change must also update this page's selected radio without
// replacing unrelated fields that the user may be editing.
RadarTheme.subscribe(theme => setRadio("theme", theme));
// Language changes refresh copy without replacing unsaved form fields.
RadarI18n.subscribe(() => {
  control("systemTimezoneLabel").textContent = msg("currentSystemTimeZone", RadarTime.systemTimeZone(), "Current system time zone: $1");
  renderAccountConnection(); renderPublicConnection(); renderChatConnection();
});

load();

async function renderAccountConnection() {
  const data = await chrome.storage.local.get(["settings", "accountSnapshot", "accountState", "accountError"]);
  const view = RadarAccount.view({ ...data, settings: RadarSettings.sanitize(data.settings) });
  control("checkAccount").disabled = accountChecking || !view.enabled;
  control("loginAccount").textContent = view.hasUsage && !view.needsCheck ? "ChatGPT 열기" : "ChatGPT 로그인";
  if (!accountChecking) control("accountConnectionState").textContent = !view.enabled
    ? "위의 내 잔여량 조회를 켜세요. 로그인은 같은 Chrome 프로필에서 진행합니다." : view.message;
}

control("loginAccount").addEventListener("click", async () => {
  const button = control("loginAccount");
  button.disabled = true;
  try {
    // Finish the user's pending switch choice before leaving this tab.
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await save();
    }
    const result = await chrome.runtime.sendMessage({ type: "OPEN_ACCOUNT_LOGIN" });
    if (!result?.ok) throw new Error("Could not open login");
    loginOpened = true;
    control("accountConnectionState").textContent = "ChatGPT에서 로그인한 뒤 이 탭으로 돌아와 연결 확인을 눌러 주세요.";
  } catch {
    control("accountConnectionState").textContent = "로그인 화면을 열지 못했어요. 확장을 새로고침한 뒤 다시 시도해 주세요.";
  } finally { button.disabled = false; }
});

async function checkAccountConnection() {
  if (accountChecking) return;
  accountChecking = true;
  control("checkAccount").disabled = true;
  control("accountConnectionState").textContent = "계정 연결 확인 중…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_ACCOUNT" });
    control("accountConnectionState").textContent = RadarAccount.refreshMessage(result);
  } catch {
    control("accountConnectionState").textContent = "연결하지 못했어요. 확장을 새로고침해 주세요.";
  } finally {
    accountChecking = false;
    const { settings } = await chrome.storage.local.get("settings");
    control("checkAccount").disabled = !RadarSettings.sanitize(settings).monitorAccount;
  }
}
control("checkAccount").addEventListener("click", checkAccountConnection);
window.addEventListener("focus", () => {
  if (loginOpened) { loginOpened = false; checkAccountConnection(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["settings", "accountState", "accountSnapshot", "accountError"].some(key => key in changes)) renderAccountConnection();
});
renderAccountConnection();

async function changeDirectX() {
  const checkbox = control("monitorDirectX");
  checkbox.disabled = true;
  try {
    // Request optional access only in response to the user's toggle gesture.
    if (checkbox.checked && !await chrome.permissions.request({ permissions: ["scripting"], origins: ["https://x.com/*"] })) {
      checkbox.checked = false;
      control("publicConnectionState").textContent = "권한이 허용되지 않아 직접 확인을 켜지 않았습니다.";
      return;
    }
    if (!await save()) throw new Error("Settings not saved");
    control("publicConnectionState").textContent = checkbox.checked ? "직접 확인을 켰습니다. 공개 소식 확인을 눌러 주세요." : "직접 확인을 중지했습니다. 기존 공개 후보는 보관 기간 동안 유지됩니다.";
  } catch {
    const { settings } = await chrome.storage.local.get("settings").catch(() => ({}));
    checkbox.checked = RadarSettings.sanitize(settings).monitorDirectX;
    control("publicConnectionState").textContent = "권한 또는 설정을 저장하지 못했습니다. 확장을 새로고침하고 다시 시도해 주세요.";
  } finally { checkbox.disabled = false; }
}

async function renderPublicConnection() {
  const data = await chrome.storage.local.get(["settings", "signalSnapshot", "signalError"]);
  const settings = RadarSettings.sanitize(data.settings);
  const lead = data.signalSnapshot?.leadStatus;
  const status = control("publicConnectionState");
  if (!settings.monitorSignals || !settings.monitorLeadSource) {
    status.textContent = "OpenAI · Tibo · VB 공개 소식 감시가 꺼져 있습니다.";
  } else if (!settings.monitorDirectX) {
    status.textContent = "답글 직접 확인 꺼짐 · 공개 피드만 사용 중입니다. 답글 누락을 줄이려면 위의 X 글·답글 직접 확인을 켜 주세요.";
  } else if (lead?.directOk && !data.signalError) {
    const scan = lead.directScan;
    const reasons = { timeout: '시간 초과', 'no-posts': '본문 미검출', permission: '권한 없음', login: '로그인 필요', 'page-unavailable': '페이지 접근 실패' };
    const stages = { navigation: '페이지 열기', loading: '페이지 로딩', reading: '본문 읽기' };
    const timelineStatus = scan?.timelines?.map(t => `${RadarSignals.authorName(t)} ${t.kind === 'posts' ? '원글' : '답글'} ${t.ok ? t.posts + '개' + (['time-budget', 'scan-limit', 'post-limit'].includes(t.stopReason) ? ' (범위 일부)' : '') : (reasons[t.error] || '수집 실패') + (stages[t.stage] ? ' / ' + stages[t.stage] : '')}`).join(' · ');
    status.textContent = scan
      ? `최근 확인: ${timelineStatus || '이전 수집 방식 · 다시 확인해 주세요'} · 중복 제외 ${scan.posts}개 · 대화 ${scan.conversations}개${scan.conversationFailures ? " · 일부 대화 확인 실패" : ""}${scan.truncated ? ' · 본문 일부 생략 ' + scan.truncated + '개' : ''}. 최근 읽은 글: ${lead.latestPostAt ? RadarTime.formatDateTime(lead.latestPostAt, RadarTime.resolveTimeZone(settings)) : '미확인'}. 전체 글 수집을 보장하지 않으며 리셋 관련 소식만 팝업에 표시합니다.`
      : "이전 수집 기록입니다. 공개 소식 확인을 눌러 새 답글 수집 결과를 확인하세요.";
    if (scan?.contextPending) status.textContent += ` 답글 문맥 ${scan.contextPending}개는 다음 조회에서 이어서 확인합니다.`;
  } else {
    const reason = { permission: "X 직접 확인 권한이 없습니다. 위 설정을 껐다 켜 권한을 허용해 주세요.", login: "X 로그인이 필요합니다. 같은 Chrome에서 X에 로그인한 뒤 다시 확인해 주세요.", timeout: "X 글 로딩 시간이 초과됐습니다. 잠시 후 다시 확인해 주세요.", "no-posts": "X에서 Tibo의 글을 읽지 못했습니다. X 로그인·접속 상태를 확인해 주세요.", "page-unavailable": "X 페이지에 접근하지 못했습니다. X 로그인·접속 상태를 확인해 주세요." };
    status.textContent = reason[lead?.directError] || "아직 답글 직접 수집을 확인하지 못했습니다. 공개 소식 확인을 눌러 주세요.";
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["signalSnapshot", "signalError", "settings"].some(key => key in changes) && !control("checkPublic").disabled) renderPublicConnection();
});
renderPublicConnection();

control("checkPublic").addEventListener("click", async () => {
  const button = control("checkPublic"); button.disabled = true;
  control("publicConnectionState").textContent = "OpenAI · Tibo · VB 글·답글과 대화 문맥 확인 중… 직접 확인은 최대 270초 걸릴 수 있어요.";
  try {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; await save(); }
    await chrome.runtime.sendMessage({ type: "REFRESH_SIGNALS" });
    await renderPublicConnection();
  } catch { control("publicConnectionState").textContent = "조회에 실패했습니다. 확장을 새로고침하고 다시 시도해 주세요."; }
  finally { button.disabled = false; }
});

async function changeChatCounter() {
  const checkbox = control("monitorChat"), status = control("chatCounterSettingStatus");
  const desired = checkbox.checked;
  checkbox.disabled = true; status.textContent = "저장 중…";
  try {
    if (desired && !await chrome.permissions.request({ permissions: ["scripting"] })) {
      checkbox.checked = false; status.textContent = "권한을 허용해야 카운트할 수 있습니다."; return;
    }
    // Save just this switch so an unrelated invalid timezone cannot prevent turning it off.
    const stored = await chrome.storage.local.get("settings");
    const result = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: RadarSettings.sanitize({ ...stored.settings, monitorChat: desired }) });
    if (!result?.ok) throw new Error("Save failed");
    status.textContent = desired ? "ChatGPT 현재 구독 화면에서 요금제를 확인합니다. 로그인 후 이 설정으로 돌아오세요." : "계정 연결 해제 · 기록 삭제됨";
  } catch { checkbox.checked = !desired; status.textContent = "저장하지 못했습니다. 확장을 새로고침한 뒤 다시 시도해 주세요."; }
  finally { checkbox.disabled = false; }
}

async function renderChatConnection() {
  const data = await chrome.storage.local.get(["settings", "chatAccount", "chatCounters"]);
  const view = RadarChatCounter.view(data);
  control("checkChatPlan").disabled = !data.settings?.monitorChat;
  if (control("monitorChat").disabled) return;
  control("monitorChat").checked = Boolean(data.settings?.monitorChat);
  control("chatCounterSettingStatus").textContent = !data.settings?.monitorChat ? "계정 연결 꺼짐" :
    view.connected ? view.label + (view.planSource === "selected" ? " · 직접 선택 기준" : view.planSource === "cached" ? " · 최근 확인 기준 · 재확인 필요" : view.plan ? " · 자동 확인됨" : " · 요금제 다시 확인을 눌러 주세요.") : "ChatGPT 로그인과 계정 연결 확인이 필요합니다.";
}
control("checkChatPlan").addEventListener("click", async () => {
  control("checkChatPlan").disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_CHAT_CONNECTION" });
    if (!result?.ok) throw new Error("Connection unavailable");
    control("chatCounterSettingStatus").textContent = "열린 ChatGPT 현재 구독 화면에서 자동 확인합니다.";
  } catch { control("chatCounterSettingStatus").textContent = "계정을 확인하지 못했습니다. 다시 연결해 주세요."; }
  finally { control("checkChatPlan").disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ["chatAccount", "chatCounters", "settings"].some(key => key in changes)) renderChatConnection();
});
renderChatConnection();
