const $ = (id) => document.getElementById(id);
const msg = (key, substitutions, fallback) => RadarI18n.t(key, substitutions, fallback);
let displayedBadgeReceipt = null;
let themeSaving = false;
let savedTheme = "system";
let renderRevision = 0;

RadarI18n.apply();
RadarI18n.subscribe(() => render());
RadarI18n.ready.then(() => render());

function meterColor(remaining) {
  if (remaining < 25) return "var(--danger)";
  if (remaining < 60) return "var(--amber)";
  return "var(--teal)";
}

function accountPlaceholder(settings, accountState) {
  if (!settings.monitorAccount) return msg("accountFeatureOff", undefined, "Account features are off");
  if (accountState?.status === "signedOut") return msg("optionalSignInToShow", undefined, "Optional: sign in to show");
  if (accountState?.status === "error") return msg("personalDataUnavailable", undefined, "Personal data is temporarily unavailable");
  return msg("optionalSignInToShow", undefined, "Optional: sign in to show");
}

function renderWindow(kind, usage, settings, accountState) {
  const windowData = RadarUsage.findWindow(usage, kind);
  const prefix = kind === "fiveHour" ? "fiveHour" : "weekly";
  const bar = $(`${prefix}Bar`);
  const meta = $(`${prefix}Meta`);
  const value = $(`${prefix}Value`);
  const date = $(`${prefix}At`);
  const meter = bar.parentElement;
  $(`${prefix}Row`).dataset.empty = String(!windowData);
  if (!windowData) {
    bar.style.width = "0";
    value.textContent = "미확인";
    meta.textContent = settings.monitorAccount ? "조회된 정보가 없어요" : "계정 조회 꺼짐";
    date.textContent = "";
    date.title = "";
    meter.removeAttribute("aria-valuenow");
    meter.setAttribute("aria-valuetext", meta.textContent);
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  const unit = document.createElement("span");
  unit.className = "unit";
  unit.textContent = "%";
  value.replaceChildren(document.createTextNode(String(windowData.remainingPercent)), unit);
  bar.style.width = `${windowData.remainingPercent}%`;
  bar.style.background = meterColor(windowData.remainingPercent);
  meter.setAttribute("aria-valuenow", String(windowData.remainingPercent));
  meter.setAttribute("aria-valuetext", `${windowData.remainingPercent}% 남음`);
  const untilReset = RadarTime.relativeDuration(windowData.resetAt);
  const language = RadarI18n.catalogLanguage();
  meta.textContent = !windowData.resetAt ? "초기화 시각 확인 전" : language === 'en' ? `Resets ${untilReset}` :
    ['fr','es','it'].includes(language) ? `Reset ${untilReset}` : language === 'ja' ? `${untilReset}にリセット` : language === 'zh_CN' ? `${untilReset}重置` : `${untilReset} 초기화`;
  date.textContent = windowData.resetAt ? RadarTime.formatLocalized(new Date(windowData.resetAt), {
    timeZone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h12"
  }) : "";
  date.title = windowData.resetAt ? RadarTime.formatDateTime(windowData.resetAt, timeZone) : "";
}

function renderPinnedEvents(data, settings, entries) {
  const container = $("pinnedEvents");
  const expanded = new Set([...container.querySelectorAll('details[open]')].map(details => details.dataset.eventId));
  const scrollPositions = new Map([...container.querySelectorAll('details')].map(details => [details.dataset.eventId, details.querySelector('.event-related-list')?.scrollTop || 0]));
  const focused = document.activeElement;
  const focusedEvent = focused?.closest('details')?.dataset.eventId;
  const focusedKey = focused?.dataset.newsId;
  const events = RadarEvents.pinned(data.signalSnapshot, data.hintSnapshot, settings);
  container.hidden = !events.length;
  container.replaceChildren(...events.map(event => {
    const card = document.createElement('article'); card.className = 'pinned-event';
    const heading = document.createElement('div'); heading.className = 'pinned-event-heading';
    const name = document.createElement('strong'); name.textContent = event.name;
    const status = document.createElement('small'); status.textContent = event.officialOnly ? '공식 일정 · 고정' : event.startAt && Date.now() >= event.startAt ? '진행 중 · 고정' : '행사 예정 · 고정';
    heading.append(name, status);
    const dates = document.createElement('div'); dates.className = 'pinned-event-dates';
    for (const line of RadarEvents.describe(event)) {
      const text = document.createElement('p'); text.textContent = line; dates.append(text);
    }
    const links = document.createElement('div'); links.className = 'pinned-event-links';
    if (event.item) {
      const original = document.createElement('button'); original.type = 'button'; original.className = 'text-action news-link';
      original.textContent = '원문 보기 ↗'; original.dataset.newsId = event.item.source.id + ':' + event.item.id;
      original.disabled = !RadarSecurity.evidenceUrl(event.item);
      original.addEventListener('click', () => openNews(original.dataset.newsId, original)); links.append(original);
    }
    if (event.officialUrl) {
      const source = document.createElement('a'); source.className = 'text-action news-link'; source.href = event.officialUrl;
      source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = '공식 일정 ↗';
      source.title = '일정 확인: ' + event.checkedAt; links.append(source);
    }
    const content = document.createElement('div'); content.className = 'news-content'; content.append(heading, dates, links);
    const relatedIds = new Set((event.related || []).map(item => item.id));
    const related = entries.filter(news => news.topic === 'event' && relatedIds.has(news.item.id));
    if (related.length) {
      const details = document.createElement('details'); details.className = 'event-related'; details.dataset.eventId = event.id;
      details.open = expanded.has(event.id);
      const summary = document.createElement('summary');
      const label = document.createElement('b'); label.textContent = '관련 글 보기';
      const count = document.createElement('small'); count.textContent = String(related.length);
      const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '+';
      summary.append(label, count, arrow);
      const list = document.createElement('div'); list.className = 'event-related-list'; list.setAttribute('role', 'list');
      list.append(...related.map(news => createNewsRow(news, entries, true)));
      details.append(summary, list); content.append(details);
    }
    // Identity only for the public OpenAI calendar; no synthetic tweet is saved.
    const identity = event.item || { author: 'OpenAI', source: { id: 'codex-lead' } };
    card.append(RadarNewsAvatar.create(identity, entries), content); return card;
  }));
  for (const details of container.querySelectorAll('details')) details.querySelector('.event-related-list').scrollTop = scrollPositions.get(details.dataset.eventId) || 0;
  if (focusedEvent) {
    const details = [...container.querySelectorAll('details')].find(details => details.dataset.eventId === focusedEvent);
    const target = focusedKey ? [...(details?.querySelectorAll('button') || [])].find(button => button.dataset.newsId === focusedKey) : details?.querySelector('summary');
    target?.focus({ preventScroll: true });
  }
  return { cards: events.length, news: events.filter(event => !event.officialOnly).length };
}

function renderNews(data, settings) {
  const allEntries = RadarNews.list(data.signalSnapshot, data.hintSnapshot, settings);
  const pinnedCount = renderPinnedEvents(data, settings, allEntries);
  // Dated events live in one calendar card below the reset feed. Expired event
  // cards disappear; their recent tweets must not reappear as ordinary rows.
  const entries = allEntries.filter(news => news.topic !== 'event' || !news.event);
  const lead = data.signalSnapshot?.leadStatus;
  const timeZone = RadarTime.countryZone().zone;
  $("signalTitle").textContent = entries.length && entries[0].item.source?.id !== "codex-lead" ? "공개 리셋 소식" : "리셋·출시 소식";
  $("newsCount").textContent = entries.length || pinnedCount.news ? (entries.length + pinnedCount.news) + "건" : !settings.monitorSignals ? "꺼짐" : "";
  const scan = lead?.directScan;
  const both = scan?.timelines?.length === 6 && scan.timelines.every(t => t.ok);
  const freshness = !settings.monitorSignals || !settings.monitorLeadSource ? 'OpenAI · Tibo · VB 수집 꺼짐' : data.signalError ? '수집 오류 · 보관된 소식' :
    !settings.monitorDirectX ? (lead?.state === 'stale' ? '최신 글 수집을 확인해 주세요 · ' : '') + '답글 직접 확인 꺼짐 · 설정에서 연결' : !lead?.directOk ? 'X 수집 확인 필요 · 설정 확인' :
    !scan?.timelines || scan.timelines.length < 6 ? '이전 수집 기록 · 지금 확인을 눌러 주세요' : !both ? scan.timelines.filter(t => !t.ok).map(t => (RadarSignals.authorName(t) + ' ') + (t.kind === 'posts' ? '원글' : '답글') + ' 수집 실패').join(' · ') + ' · 설정 확인' : `원글·답글 ${scan.posts}개 확인` + (lead.latestPostAt ? ' · 최근 글 ' + RadarTime.formatLocalized(new Date(lead.latestPostAt), {
      timeZone, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12'
    }) : '');
  $("newsFreshness").textContent = freshness;
  if (settings.monitorSignals && settings.monitorLeadSource && settings.monitorDirectX && lead?.directOk && !data.signalError && both && lead.collectionVerified === false) {
    $("newsFreshness").textContent = scan.contextPending ? `답글 문맥 ${scan.contextPending}개 확인 대기 · 일부 수집` : '일부 수집 · 재확인 필요';
  }
  $("newsFreshness").title = (lead?.latestPostAt ? '최근 수집 글: ' + RadarTime.formatDateTime(lead.latestPostAt, timeZone) : '최근 수집 글 없음') +
    (data.signalSnapshot?.checkedAt ? ' / 조회: ' + RadarTime.formatDateTime(data.signalSnapshot.checkedAt, timeZone) : '') + ' · OpenAI · Tibo · VB의 리셋·출시·행사 관련 글을 표시합니다.';
  $("newsEmpty").hidden = Boolean(entries.length || pinnedCount.cards);
  $("newsEmpty").textContent = !settings.monitorSignals ? "소식 확인 꺼짐" :
    data.signalError ? "소식을 불러오지 못했어요" : lead && ["stale", "unavailable"].includes(lead.state) ? "최신 글 수집을 확인해 주세요" : "새 리셋·출시·행사 소식이 없어요";
  const list = $("newsList"), scrollTop = list.scrollTop;
  const focusedKey = document.activeElement?.dataset.newsId;
  list.hidden = !entries.length;
  list.replaceChildren(...entries.map(news => createNewsRow(news, allEntries)));
  list.scrollTop = scrollTop;
  if (focusedKey) [...list.querySelectorAll("button")].find(button => button.dataset.newsId === focusedKey)?.focus({ preventScroll: true });
  const status = freshness;
  $("newsCollection").textContent = status + (data.signalSnapshot?.checkedAt ? " · " + RadarTime.formatTime(data.signalSnapshot.checkedAt, timeZone) : " 대기 중");
}

function createNewsRow(news, entries, compact = false) {
    const timeZone = RadarTime.countryZone().zone;
    const row = document.createElement("article"); row.className = "news-item"; row.setAttribute("role", "listitem");
    const heading = document.createElement("div"); heading.className = "news-item-heading";
    const badge = document.createElement("span"); badge.className = "confidence" + (news.label === "Banked" ? " banked" : news.explicit ? "" : " candidate");
    badge.textContent = news.label; badge.title = news.caption;
    const timing = document.createElement("span"); timing.className = "news-timing";
    timing.textContent = news.timing || "일정 미정";
    timing.title = news.timingDetail + " 게시 " + RadarTime.formatDateTime(news.item.createdAt, timeZone) + " · 이미 지난 일정일 수 있습니다.";
    heading.append(badge, timing);
    const kind = document.createElement("span"); kind.className = "news-kind"; kind.textContent = (RadarSignals.isLead(news.item) ? RadarSignals.authorName(news.item) + " · " : "") + news.kindLabel;
    const quote = document.createElement("blockquote"); quote.className = "news-quote"; quote.textContent = news.item.text;
    const link = document.createElement("button"); link.type = "button"; link.className = "text-action news-link";
    link.dataset.newsId = news.key; link.textContent = "원문 보기 ↗";
    link.disabled = !RadarSecurity.evidenceUrl(news.item);
    link.setAttribute("aria-label", (globalThis.RadarUiCopy?.translate("원문 보기") || "원문 보기") + ": " + news.item.text.slice(0, 60));
    link.addEventListener("click", () => openNews(news.key, link));
    const avatar = RadarNewsAvatar.create(news.item, entries);
    const content = document.createElement('div'); content.className = 'news-content';
    if (compact) { kind.textContent = RadarSignals.authorName(news.item); content.append(kind, quote, link); }
    else content.append(heading, kind, quote, link);
    row.append(avatar, content); return row;
}

async function openNews(id, button) {
  button.disabled = true; button.dataset.state = "loading"; button.textContent = "여는 중…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "OPEN_NEWS", id });
    if (!result?.ok) throw new Error("Link unavailable");
    button.dataset.state = "success"; button.textContent = "원문 열림 ↗";
  } catch {
    button.dataset.state = "error"; button.textContent = "다시 열기 ↗";
    $("refreshStatus").textContent = "원문을 열지 못했어요. 다시 시도해 주세요.";
  } finally { button.disabled = false; }
}

function renderChat(data, settings) {
  const view = RadarChatCounter.view({ ...data, settings });
  const count = view.count;
  const needsTier = ['pro', 'business', 'unknown'].includes(view.family);
  $("chatCountValue").hidden = !view.connected || !view.meters.length;
  $("chatCountValue").textContent = "추정";
  renderChatMeters(view);
  $("chatCountBreakdown").textContent = !view.connected ? "계정 연결 후 요금제와 사용 모델을 확인합니다." :
    `${settings.syncChatHistory ? '기록 집계' : 'Chrome 관측'} · Astra ${count.astra}회 + Sol Pro ${count.sol}회` + (!view.plan && needsTier ? " · 한도 기준 선택 필요" : "");
  $("enableChatCounter").hidden = Boolean(view.connected && (view.plan || !needsTier) && !data.chatCounterError);
  $("enableChatCounter").textContent = !settings.monitorChat ? "계정 연결" : !view.connected ? "연결 확인" : "요금제 확인";
  $("enableChatCounter").dataset.action = !settings.monitorChat || data.chatCounterError ? "enable" : "connect";
  const allowance = count.limit ? (view.plan === "businessStandard" ? "공유 월 " : "공유 주 ") + count.limit + "회" : ['enterprise', 'edu'].includes(view.family) ? "워크스페이스별 한도" : view.plan ? "고정 잔여 횟수 미공개" : needsTier ? "한도 확인 전" : "고정 잔여 횟수 미공개";
  $("chatOtherModels").hidden = !view.connected;
  $("chatOtherModels").textContent = `최근 7일 · Sol 일반 ${view.modelCounts.solStandard}회 · Luna ${view.modelCounts.luna}회`;
  $("chatOtherModels").title = '일반 Sol·Luna는 Astra·Sol Pro 한도에서 차감하지 않습니다. 모델이 명확한 기록만 집계합니다.';
  $("chatCountNote").textContent = view.connected ? `${view.label} · ${allowance}` : "현재 로그인 계정 자동 확인 · 임의 한도 적용 없음";
  $("chatResetNote").hidden = !view.connected || !view.codexReset;
  $("chatResetNote").textContent = view.codexReset ?
    "Codex 연동 초기화 · " + RadarTime.formatDateTime(view.codexReset.effectiveAt, RadarTime.resolveTimeZone(settings)) + " 기준" :
    settings.syncChatResetWithCodex ? settings.monitorAccount ? "Codex 리셋 확인 시 카운터 함께 초기화" : "리셋 연동 대기 · 설정에서 내 잔여량 조회를 켜세요" : "Codex 리셋 연동 꺼짐";
  $("chatResetNote").title = "로컬 카운터 동기화입니다. Chat 서버의 실제 리셋·잔여량을 확인한 값은 아닙니다.";
  $("chatCountStatus").textContent = view.planCheck?.status === 'running' ? '요금제 확인 중…' :
    view.connected && needsTier && ['timeout', 'error', 'stopped', 'failed'].includes(view.planCheck?.status) ?
      view.plan ? '자동 확인 실패 · 기존 기준으로 표시 중' : '자동 확인 실패 · 위에서 요금제를 선택해 주세요.' :
      view.connected && view.plan && !view.meters.length ? msg('chatQuotaUnknown') : '';
}

function renderChatMeters(view) {
  const grid = $("chatMeters");
  grid.replaceChildren();
  grid.hidden = !view.connected || !view.meters.length;
  grid.dataset.paired = String(view.meters.length > 1);
  for (const meter of view.meters) {
    const card = document.createElement('div'); card.className = 'chat-meter-card';
    const head = document.createElement('div'); head.className = 'chat-meter-heading';
    const name = document.createElement('span'); name.textContent = meter.label;
    const period = document.createElement('small'); period.textContent = meter.days === 1 ? '일간' : meter.days === 7 ? '주간' : '월간';
    head.append(name, period);
    const values = document.createElement('div'); values.className = 'chat-meter-values';
    const number = document.createElement('strong'); number.textContent = meter.percent;
    const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = '%'; number.append(unit);
    const left = document.createElement('span'); left.className = 'chat-meter-left'; left.textContent = meter.remaining + ' / ' + meter.limit + '회 남음';
    values.append(number, left);
    const bar = document.createElement('div'); bar.className = 'meter'; bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', meter.label + ' · 추정 잔여'); bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(meter.limit)); bar.setAttribute('aria-valuenow', String(meter.remaining));
    const fill = document.createElement('span'); fill.style.width = meter.percent + '%'; bar.append(fill);
    card.dataset.level = meter.percent === 0 ? 'empty' : meter.percent <= 20 ? 'low' : 'normal';
    card.append(head, values, bar); grid.append(card);
  }
  const controls = $("chatPlanControls"), select = $("chatPlanChoice");
  controls.hidden = !view.connected;
  if (controls.dataset.account !== view.accountKey) { controls.open = !view.plan; controls.dataset.account = view.accountKey || ''; }
  if (!view.plan) controls.open = true;
  const family = view.family;
  if (select.dataset.family !== family) {
    select.replaceChildren();
    const options = [['auto', '자동 확인'], ...Object.entries(RadarChatCounter.PLANS).filter(([, policy]) => !policy.retired).map(([id, policy]) => [id, policy.label])];
    for (const [value, label] of options) {
      const option = document.createElement('option'); option.value = value; option.textContent = label;
      option.disabled = value !== 'auto' && RadarChatCounter.PLANS[value].family !== family;
      select.append(option);
    }
    select.dataset.family = family;
  }
  select.dataset.account = view.accountKey || '';
  select.dataset.saved = view.plan || 'auto';
  if (!select.disabled) select.value = select.dataset.saved;
  $("chatPlanSource").textContent = view.planSource === 'selected' ? '직접 선택 기준 · 변경' :
    view.planSource === 'cached' ? '최근 확인 기준 · 재확인 필요' : view.plan ? '요금제 자동 확인 · 변경' : '한도 기준 선택';
  controls.dataset.state = view.plan ? 'success' : view.planCheck?.status === 'running' ? 'loading' : 'default';
  grid.title = '계정 기록 기반 추정입니다. 삭제·임시 대화와 공식 초기화 시각 차이로 실제 잔여량과 다를 수 있습니다.';
}

$("chatPlanChoice").addEventListener('change', async () => {
  const select = $("chatPlanChoice"), controls = $("chatPlanControls");
  const previous = select.dataset.saved || 'auto';
  let failureText = '저장하지 못했어요. 계정을 확인하고 다시 선택해 주세요.';
  select.removeAttribute('aria-invalid');
  select.disabled = true; controls.dataset.state = 'loading';
  if (select.value === 'auto') $("chatCountStatus").textContent = '요금제 확인 중…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'SET_CHAT_PLAN_CHOICE', plan: select.value, accountKey: select.dataset.account });
    if (result?.code === 'plan-check-failed') failureText = result.preserved ? '자동 확인을 완료하지 못했어요. 기존 기준을 유지합니다.' : '자동 확인 실패 · 위에서 요금제를 선택해 주세요.';
    if (!result?.ok) throw new Error('Account changed');
    $("chatCountStatus").textContent = '저장했습니다.';
    controls.open = false;
    await render();
    controls.dataset.state = 'success';
    controls.querySelector('summary').focus();
  } catch {
    select.value = previous;
    select.setAttribute('aria-invalid', 'true');
    controls.dataset.state = 'error';
    $("chatCountStatus").textContent = failureText;
  } finally {
    select.disabled = false;
    select.value = select.dataset.saved || previous;
  }
});

function forecastDate(value, timeZone) {
  return new Intl.DateTimeFormat(RadarI18n.uiLanguage(), {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).format(new Date(value));
}

function renderForecast(signals, settings) {
  const timeZone = RadarTime.resolveTimeZone(settings);
  const slotClock = value => RadarTime.formatTime(value, timeZone);
  const forecast = RadarForecast.build({ signals, timeZone });
  const highlighted = [...forecast.slots]
    .sort((a, b) => b.probability - a.probability || a.startAt - b.startAt)
    .slice(0, 1)
    .sort((a, b) => a.startAt - b.startAt);
  $("forecastPanel").hidden = forecast.basis === "baseline";
  $("forecastSummary").textContent = forecast.basis === "community-experience" ? "커뮤니티 기록 기준" : "공개 글 기준";
  $("forecastSummary").title = msg("forecastDisclaimer", undefined, "Heuristic probability, not an OpenAI plan or promise");
  $("forecastSlots").replaceChildren(...(forecast.basis === "baseline" ? [] : highlighted).map((slot) => {
    const item = document.createElement("div");
    item.className = "forecast-slot";
    const label = document.createElement("span");
    const start = slotClock(slot.startAt);
    const end = slotClock(slot.endAt);
    label.textContent = `${forecastDate(slot.startAt, timeZone)}\n${start}–${end}`;
    item.title = `${RadarTime.formatDateTime(slot.startAt, timeZone)} – ${RadarTime.formatDateTime(slot.endAt, timeZone)}`;
    item.append(label);
    return item;
  }));
}

function renderCredits(credits, settings, accountState) {
  if (!credits) {
    $("creditsCount").textContent = "--";
    $("creditsExpiry").textContent = accountPlaceholder(settings, accountState);
    return;
  }
  $("creditsCount").textContent = String(credits.availableCount);
  const nearest = RadarUsage.nearestExpiry(credits);
  if (!nearest) {
    $("creditsExpiry").textContent = credits.availableCount
      ? msg("someCreditsNoExpiry", undefined, "Some reset credits have no expiry time")
      : msg("noResetCredits", undefined, "No reset credits available");
    return;
  }
  const timeZone = RadarTime.resolveTimeZone(settings);
  $("creditsExpiry").textContent = msg('creditsExpiryPrefix') + " · " + RadarTime.formatLocalized(new Date(nearest), {
    timeZone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h12"
  });
}

function renderBankedArrival(unread) {
  const notice = unread.notice;
  $("bankedArrival").hidden = !notice;
  if (!notice) return;
  $("bankedArrival").dataset.kind = notice.kind;
  $("bankedArrival").setAttribute('aria-label', notice.kind === 'inventory' ? msg('bankedInventoryTitle', String(notice.count))
    : msg(notice.kind === 'public' ? 'badgeUnreadReset' : 'bankedNoticeLabel'));
  $("viewBankedCredits").textContent = msg(notice.kind === 'public' ? 'badgeReview' : 'bankedViewCredits');
  const country = RadarI18n.country();
  const at = Number.isFinite(notice.observedAt) ? country.timeLabel + " " + RadarTime.formatDateTime(notice.observedAt, country.timeZone) : '';
  if (notice.kind === 'grant') {
    $("bankedArrivalTitle").textContent = msg("bankedArrivalTitle", String(notice.added), "Banked reset +$1");
    $("bankedArrivalMeta").textContent = typeof notice.count === "number"
      ? msg("bankedArrivalMeta", [String(notice.count), at], "$1 available · detected $2")
      : msg("bankedArrivalObserved", at, "Detected $1 · refresh to check available credits");
  } else if (notice.kind === 'inventory') {
    $("bankedArrivalTitle").textContent = msg('bankedInventoryTitle', String(notice.count));
    $("bankedArrivalMeta").textContent = msg('bankedInventoryMeta') + (at ? ' · ' + at : '');
  } else {
    $("bankedArrivalTitle").textContent = msg('badgeNewsTitle', String(notice.total));
    $("bankedArrivalMeta").textContent = msg('badgeNewsMeta');
  }
}

function renderUnreadBadges(unread) {
  displayedBadgeReceipt = unread.receipt;
  const banked = unread.bankedItems.length > 0;
  for (const [id, visible, label] of [
    ['weeklyUnread', unread.hasUnread, msg('badgeUnreadReset', undefined, '확인하지 않은 리셋 소식 · +로 확인')],
    ['newsUnread', unread.hasUnread, msg('badgeUnreadReset', undefined, '확인하지 않은 리셋 소식 · +로 확인')],
    ['creditsUnread', unread.hasUnread, msg(banked ? 'badgeUnreadBanked' : 'badgeUnreadReset')],
    ['bankedArrivalUnread', unread.notice?.unread, msg(banked ? 'badgeUnreadBanked' : 'badgeUnreadReset')]
  ]) {
    $(id).hidden = !visible;
    $(id).title = label;
    $(id).setAttribute('aria-label', label);
  }
}

function renderAdvice(advice) {
  const value = advice || {
    tier: "guest",
    title: msg("adviceGuestTitle", undefined, "Public signal radar is running"),
    message: msg("adviceGuestMessage", undefined, "Monitor public reset signals without signing in. Sign in only to add personal quota and reset-credit advice."),
    detail: msg("basicMode", undefined, "Basic mode")
  };
  $("advicePanel").dataset.tier = value.tier;
  $("advicePanel").hidden = value.tier === "guest";
  $("adviceMessage").textContent = value.title;
}

function renderSchedule(snapshot, settings) {
  const change = settings.monitorSignals && settings.monitorLeadSource ? RadarSchedule.changes(snapshot)[0] : null;
  $("schedulePanel").hidden = !change;
  if (!change) return;
  $("scheduleTitle").textContent = change.label;
  $("scheduleAssociation").textContent = { edit: "같은 글 수정", reference: "답글·인용 연결", inferred: "연결 추정" }[change.association];
  $("scheduleMeta").textContent = RadarTime.formatDateTime(change.post.createdAt, RadarTime.resolveTimeZone(settings));
  $("scheduleQuote").textContent = change.post.text.slice(0, 400);
  $("schedulePrevious").textContent = RadarTime.formatDateTime(change.previous.createdAt, RadarTime.resolveTimeZone(settings)) + " · " + change.previous.text.slice(0, 400);
  $("scheduleCaution").textContent = "이전 시간 예상과 재알림은 중단했습니다. 새 시각은 원문을 확인하세요." +
    (change.association === "inferred" ? " 같은 일정인지의 연결은 추정입니다." : "") +
    (change.kind === "hint" ? " 은유 후보이며 리셋 확정은 아닙니다." : "");
  $("viewScheduleOriginal").disabled = !RadarSecurity.evidenceUrl(change.previous);
  $("viewScheduleUpdate").disabled = !RadarSecurity.evidenceUrl(change.post);
}

async function render() {
  const revision = ++renderRevision;
  const data = await chrome.storage.local.get([
    "settings",
    "accountSnapshot",
    "creditGrantState",
    "publicAlertState",
    "signalSnapshot",
    "hintSnapshot",
    "scheduleSnapshot",
    "adviceSnapshot",
    "lastCheckedAt",
    "accountState",
    "accountError",
    "signalError",
    "notificationDelivery", "chatAccount", "chatCounters", "chatCounterError"
  ]);
  if (revision !== renderRevision) return;
  const settings = RadarSettings.sanitize(data.settings);
  const connection = RadarAccount.view({ ...data, settings });
  $("connectAccount").hidden = connection.hasUsage && !connection.needsCheck;
  $("connectAccount").textContent = connection.action;
  $("accountNotice").hidden = connection.hasUsage && !connection.needsCheck;
  $("accountNotice").textContent = connection.message;
  renderNews(data, settings);
  renderChat(data, settings);
  renderSchedule(data.scheduleSnapshot, settings);
  renderForecast(settings.monitorSignals ? data.signalSnapshot?.activeSignals || [data.signalSnapshot?.signal].filter(Boolean) : [], settings);
  renderWindow("fiveHour", settings.monitorAccount ? data.accountSnapshot?.usage : null, settings, data.accountState);
  renderWindow("weekly", settings.monitorAccount ? data.accountSnapshot?.usage : null, settings, data.accountState);
  renderCredits(settings.monitorAccount ? data.accountSnapshot?.credits : null, settings, data.accountState);
  const unread = RadarBadge.view(data, settings);
  renderBankedArrival(unread);
  renderUnreadBadges(unread);
  renderAdvice(RadarAdvice.make({
    usage: settings.monitorAccount ? data.accountSnapshot?.usage : null,
    credits: settings.monitorAccount ? data.accountSnapshot?.credits : null,
    signal: settings.monitorSignals && RadarSignals.isActive(data.signalSnapshot?.signal) ? data.signalSnapshot.signal : null
  }));
  const radarHasError = Boolean(data.signalError);
  const enabled = settings.monitorSignals || settings.monitorAccount;
  $("healthDot").className = `health-dot ${!enabled ? "" : radarHasError ? "warn" : data.lastCheckedAt ? "ok" : ""}`;
  $("healthDot").title = !enabled ? "조회 꺼짐" : radarHasError
    ? msg("publicSignalsUnavailable", undefined, "Public signals are temporarily unavailable")
    : data.accountState?.status === "signedOut"
      ? msg("basicModeHealthy", undefined, "Basic mode: public monitoring is healthy")
      : msg("monitoringHealthy", undefined, "Monitoring is healthy");
  $("notificationState").textContent = (settings.monitorSignals && (settings.notifyOfficialReset || (settings.monitorLeadSource && settings.notifyHints))) || (settings.monitorAccount && (settings.notifyAccountReset || settings.notifyBankedReset || settings.notifyCreditExpiry || settings.notifyAdvice))
    ? msg("notificationsOn", undefined, "Notifications on")
    : msg("notificationsOff", undefined, "Notifications off");
  if (data.notificationDelivery?.status === "failed") {
    $("notificationState").textContent = "최근 알림 전달 실패 · 설정에서 확인";
    $("healthDot").className = "health-dot warn";
    $("healthDot").title = "설정 → 알림 → 테스트 알림에서 확인하세요.";
  }
  $("lastChecked").textContent = data.lastCheckedAt
    ? msg("checkedAt", RadarTime.formatTime(data.lastCheckedAt, RadarTime.resolveTimeZone(settings)), "Checked $1")
    : msg("notCheckedYet", undefined, "Not checked yet");
}

$("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
async function acknowledgeDisplayedBadges() {
  if (!displayedBadgeReceipt ||
    !displayedBadgeReceipt.public.length && !displayedBadgeReceipt.banked.length) return;
  const receipt = displayedBadgeReceipt;
  const failureText = msg('badgeReadFailed', undefined, '확인 상태를 저장하지 못했어요. 다시 펼쳐주세요.');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ACK_VISIBLE_BADGES', receipt });
    if (!result?.ok) throw new Error('Badge acknowledgement failed');
    await render();
    if ($('refreshStatus').textContent === failureText) $('refreshStatus').textContent = '';
  } catch {
    $("refreshStatus").textContent = failureText;
  }
}
$("moreDetails").addEventListener("toggle", async () => {
  if ($("moreDetails").open) await acknowledgeDisplayedBadges();
});
$("viewBankedCredits").addEventListener("click", async () => {
  const alreadyOpen = $("moreDetails").open;
  $("moreDetails").open = true;
  $("moreDetails").querySelector("summary").focus();
  $("moreDetails").scrollIntoView({ block: "nearest" });
  // An open details element emits no new toggle event. A later arrival or a
  // failed acknowledgement must still be reviewable through the banner.
  if (alreadyOpen) await acknowledgeDisplayedBadges();
});
RadarTheme.subscribe(theme => {
  if (!themeSaving) {
    savedTheme = theme;
    $("popupTheme").value = theme;
  }
});
RadarTheme.ready.then(() => { $("popupTheme").disabled = false; });
$("popupTheme").addEventListener("change", async () => {
  const picker = $("popupTheme");
  const status = $("themeStatus");
  const selected = picker.value;
  themeSaving = true;
  picker.disabled = true;
  picker.dataset.state = "loading";
  status.dataset.state = "loading";
  status.textContent = "테마 저장 중…";
  RadarTheme.apply(selected);
  try {
    savedTheme = await RadarTheme.save(selected);
    picker.dataset.state = "success";
    status.dataset.state = "success";
    status.textContent = "테마를 저장했습니다.";
  } catch {
    try {
      savedTheme = await RadarTheme.read();
    } catch { /* Fall back to the last confirmed selection. */ }
    picker.dataset.state = "error";
    status.dataset.state = "error";
    status.textContent = "테마를 저장하지 못했어요. 다시 선택해 주세요.";
  } finally {
    themeSaving = false;
    picker.disabled = false;
    picker.value = savedTheme;
    RadarTheme.apply(savedTheme);
  }
});
$("connectAccount").addEventListener("click", async () => {
  const button = $("connectAccount");
  button.disabled = true;
  try {
    const { settings } = await chrome.storage.local.get("settings");
    if (!RadarSettings.sanitize(settings).monitorAccount) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/welcome/welcome.html") });
    } else {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_ACCOUNT_LOGIN" });
      if (!result?.ok) throw new Error("Could not open login");
      $("refreshStatus").textContent = "ChatGPT에서 로그인한 뒤 확장을 다시 열거나 지금 확인을 눌러 주세요.";
    }
  } catch {
    $("refreshStatus").textContent = "로그인 화면을 열지 못했어요. chrome://extensions/에서 확장을 새로고침해 주세요.";
  } finally { button.disabled = false; }
});
$("enableChatCounter").addEventListener("click", async () => {
  const button = $("enableChatCounter"); button.disabled = true;
  $("chatCountStatus").textContent = "연결 중…";
  try {
    const enable = button.dataset.action === "enable";
    if (enable && !await chrome.permissions.request({ permissions: ["scripting"] })) {
      $("chatCountStatus").textContent = "계정을 연결하려면 ChatGPT 화면 접근 권한을 허용해 주세요."; return;
    }
    const result = await chrome.runtime.sendMessage({ type: enable ? "ENABLE_CHAT_COUNTER" : "OPEN_CHAT_CONNECTION" });
    if (!result?.ok) throw new Error("Enable failed");
    await render();
    $("chatCountStatus").textContent = "ChatGPT의 현재 구독 화면에서 요금제를 자동 확인합니다. 로그인 후 확장을 다시 열어 주세요.";
  } catch { $("chatCountStatus").textContent = "연결하지 못했어요. 확장을 새로고침하고 다시 시도해 주세요."; }
  finally { button.disabled = false; }
});
$("viewScheduleOriginal").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_SCHEDULE_ORIGINAL" }));
$("viewScheduleUpdate").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_SCHEDULE_UPDATE" }));
$("refreshButton").addEventListener("click", async () => {
  const button = $("refreshButton");
  button.classList.add("busy");
  button.disabled = true;
  $("refreshStatus").textContent = "잔여량·소식·요금제·기록 확인 중…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_NOW" });
    await render();
    $("refreshStatus").textContent = result?.signals?.leadVerified === false && result?.account?.ok
      ? "잔여량은 확인했지만 최신 Tibo 글 수집은 확인하지 못했어요." : RadarAccount.refreshMessage(result);
    if (result?.chatPlan?.ok === false) $("refreshStatus").textContent += ' 요금제 확인은 완료하지 못했어요.';
    if (result?.chatHistory?.ok === false) $("refreshStatus").textContent += ' Chat 기록 동기화는 다시 확인해 주세요.';
  } catch {
    $("refreshStatus").textContent = "연결하지 못했어요. 확장을 새로고침해 주세요.";
  } finally {
    button.classList.remove("busy");
    button.disabled = false;
  }
});

chrome.storage.onChanged.addListener(render);
render();

(async () => {
  try {
    await chrome.runtime.sendMessage({ type: "REFRESH_CHAT_ACCOUNT" });
    await render();
  } catch { $("chatCountStatus").textContent = "계정 연결을 확인하지 못했어요. 다시 연결해 주세요."; }
})();

// Reopening after web sign-in retries only the account read, without enabling
// monitoring or waiting for the next periodic public-feed check.
(async () => {
  const data = await chrome.storage.local.get(["settings", "accountSnapshot", "accountState", "accountError"]);
  const settings = RadarSettings.sanitize(data.settings);
  if (!settings.monitorAccount || (!RadarAccount.view({ ...data, settings }).needsCheck &&
      Date.now() - (data.accountSnapshot?.updatedAt || 0) < 60000)) return;
  const button = $("refreshButton");
  button.disabled = true;
  $("refreshStatus").textContent = "계정 연결 확인 중…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "REFRESH_ACCOUNT" });
    await render();
    $("refreshStatus").textContent = result?.ok ? "" : RadarAccount.refreshMessage(result);
  } catch {
    $("refreshStatus").textContent = "연결하지 못했어요. 확장을 새로고침해 주세요.";
  } finally { button.disabled = false; }
})();

// The popup can be the first interaction after sleep; account-only refresh
// must not leave public posts stale until the next long polling interval.
(async () => {
  const data = await chrome.storage.local.get(["settings", "signalSnapshot"]);
  if (!RadarSettings.sanitize(data.settings).monitorSignals || Date.now() - (data.signalSnapshot?.checkedAt || 0) < 60000) return;
  try { await chrome.runtime.sendMessage({ type: "REFRESH_SIGNALS" }); await render(); } catch { /* The worker records source health. */ }
})();

// Refresh time-bound banners while the popup remains open; this does not fetch.
setInterval(() => render(), 30000);
