(function initNews(root) {
  const DAY_MS = 86400000;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const KOREAN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const locale = () => root.RadarI18n?.uiLanguage?.() || 'ko-KR';
  const english = () => locale().startsWith('en');
  // Public profile lists San Francisco. This is a fallback assumption, not live location.
  // https://www.linkedin.com/in/thibault-sottiaux-27195366 (checked 2026-09-22)
  const TIBO_ZONE = { zone: 'America/Los_Angeles', label: '미 서부', assumed: true };
  const ZONES = { PT: 'America/Los_Angeles', ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver' };
  const OFFSETS = { UTC: 0, GMT: 0, KST: 540, JST: 540, PST: -480, PDT: -420,
    EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, CET: 60, CEST: 120, BST: 60 };

  function sourceZone(text, item) {
    const named = /\b(?:UTC|GMT)(?:\s*[+-]\d{1,2}(?::?\d{2})?)?\b|\b(?:KST|JST|PST|PDT|PT|EST|EDT|ET|CST|CDT|CT|MST|MDT|MT|CET|CEST|BST)\b/ig;
    const matches = [...text.matchAll(named)];
    const labels = [...new Set(matches.map(match => match[0].toUpperCase().replace(/\s/g, '')))];
    // A range commonly repeats its zone at both ends. Reject competing zones,
    // not an unambiguous repetition such as "10am PT to 7pm PT".
    if (labels.length > 1) return null;
    if (matches.length) {
      if (matches.some(match => /^(?:[+:\-]\s*\d|\.\d|\d)/.test(text.slice(match.index + match[0].length).trimStart()))) return null;
      const label = labels[0];
      if (ZONES[label]) return { zone: ZONES[label], label };
      const numeric = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(label);
      if (numeric) {
        const hours = Number(numeric[2]), minutes = Number(numeric[3] || 0);
        if (hours > 14 || minutes > 59 || (hours === 14 && minutes)) return null;
        return { offset: (hours * 60 + minutes) * (numeric[1] === '+' ? 1 : -1), label };
      }
      // CST is also used in China; do not silently treat it as US Central.
      return label === 'CST' ? null : { offset: OFFSETS[label], label };
    }
    const iana = /\b(?:America|Europe|Asia|Australia|Pacific|Africa)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/.exec(text)?.[0];
    if (iana) return root.RadarTime.isValidTimeZone(iana) ? { zone: iana, label: iana } : null;
    const regional = /\b(Pacific|Eastern|Central|Mountain)(?:\s+(standard|daylight))?\s+time\b/i.exec(text);
    if (regional) {
      const label = { pacific: 'PT', eastern: 'ET', central: 'CT', mountain: 'MT' }[regional[1].toLowerCase()];
      if (regional[2]) {
        const fixed = label[0] + (/standard/i.test(regional[2]) ? 'S' : 'D') + 'T';
        return { offset: OFFSETS[fixed], label: fixed };
      }
      return { zone: ZONES[label], label };
    }
    // An unrecognised zone/location must not be replaced by the US fallback.
    if (/\b(?:[A-Z]{2,5}|[A-Za-z]+\s+time)\s*(?:[.,!]|$)/.test(text.replace(/\b(?:AM|PM|OK|GPT|API)\b/g, '')) ||
        /\b(?:IST|JST|HKT|SGT|AEST|AEDT|NZST|NZDT|London|Tokyo|Seoul|Sydney)\b/i.test(text)) return null;
    return item.source?.id === 'codex-lead' && /^@?thsottiaux$/i.test(item.author || '') ? TIBO_ZONE : null;
  }

  function parts(at, zone) {
    if (zone.offset !== undefined) {
      const date = new Date(at + zone.offset * 60000);
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
    }
    const values = new Intl.DateTimeFormat('en-US', { timeZone: zone.zone, year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(at));
    return Object.fromEntries(values.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  }
  const wallEpoch = p => Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0);
  function wallInstants(wall, zone) {
    const epoch = wallEpoch(wall);
    if (zone.offset !== undefined) return [epoch - zone.offset * 60000];
    // Round-trip both sides of a DST transition: gaps yield none, overlaps yield two.
    const offsets = new Set([-2, 0, 2].map(days => {
      const sample = epoch + days * DAY_MS;
      return wallEpoch(parts(sample, zone)) - sample;
    }));
    return [...offsets].map(offset => epoch - offset).filter(at => wallEpoch(parts(at, zone)) === epoch).sort((a, b) => a - b);
  }
  function calendar(text, anchor) {
    const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
    const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/.exec(text);
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthPattern = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
    const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?(?:,?\\s+(20\\d{2}))?\\b`, 'i').exec(text);
    const month = new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'i').exec(text) ||
      (dayFirst && [dayFirst[0], dayFirst[2], dayFirst[1], dayFirst[3]]);
    if (iso || slash || month) {
      const year = iso?.[1] || slash?.[3] || month?.[3];
      if (!year && !anchor) return null;
      const result = { year: Number(year || anchor.year), month: iso ? Number(iso[2]) : slash ? Number(slash[1]) : monthNames.indexOf(month[1].slice(0, 3).toLowerCase()) + 1,
        day: Number(iso?.[3] || slash?.[2] || month?.[2]), inferred: !year };
      // Resolve an omitted year to the nearest calendar date to publication.
      if (!year && wallEpoch(result) - wallEpoch(anchor) < -183 * DAY_MS) result.year++;
      if (!year && wallEpoch(result) - wallEpoch(anchor) > 183 * DAY_MS) result.year--;
      const date = new Date(wallEpoch(result));
      return date.getUTCMonth() + 1 === result.month && date.getUTCDate() === result.day ? result : null;
    }
    if (!anchor) return null;
    const day = /\b(?:(next|this|last)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
    let delta;
    if (day) {
      const weekday = new Date(wallEpoch(anchor)).getUTCDay();
      delta = (WEEKDAYS.indexOf(day[2].toLowerCase()) - weekday + 7) % 7;
      if (day[1]?.toLowerCase() === 'last') delta = delta ? delta - 7 : -7;
      else if (day[1]?.toLowerCase() === 'next' && !delta) delta = 7;
      else if (day[1]?.toLowerCase() === 'this') delta = (WEEKDAYS.indexOf(day[2].toLowerCase()) + 6) % 7 - (weekday + 6) % 7;
    } else if (/\btomorrow\b/i.test(text)) delta = 1;
    else if (/\byesterday\b/i.test(text)) delta = -1;
    else if (/\b(?:today|tonight|this evening)\b/i.test(text)) delta = 0;
    if (delta === undefined) return null;
    return { ...parts(wallEpoch({ ...anchor, hour: 0, minute: 0 }) + delta * DAY_MS, { offset: 0 }), inferred: true };
  }
  const clockLabel = p => root.RadarTime.formatTime(wallEpoch(p), 'UTC', locale());
  const dateLabel = (p, year) => locale() !== 'ko-KR' ? new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short', ...(year ? {year: 'numeric'} : {}) }).format(new Date(wallEpoch(p))) : `${year ? p.year + '년 ' : ''}${p.month}/${p.day}(${KOREAN_DAYS[new Date(wallEpoch(p)).getUTCDay()]})`;

  // "By midnight PST": the next midnight closing the source-zone calendar date
  // of the actual post createdAt ("tomorrow" shifts that date first). This is
  // a deadline boundary, never an execution instant. Requires exactly one
  // explicit zone; negation, extra clocks/dates/zones or questions reject.
  function midnightDeadline(text, item, target) {
    const value = String(text || '').trim();
    const match = /^(?:(?:lands|landing|arriving|coming|rolling out)(?:\s+(?:sometime|later))?\s+)?(?:(today|tonight|tomorrow)\s+)?(?:by|before)\s+midnight(?:\s+(tonight|tomorrow))?\s+(PST|PDT|PT|UTC|GMT|KST)[.!]*$/i.exec(value);
    if (!match || (match[1] && match[2])) return null;
    const label = match[3].toUpperCase();
    // Reuse the shared zone resolver (literal PST = UTC−8, PT = IANA with DST).
    const resolved = sourceZone(value, item);
    if (!resolved || resolved.assumed || String(resolved.label).toUpperCase() !== label) return null;
    const useZone = resolved;
    const publication = root.RadarTime.parseTimestamp(item.createdAt);
    if (publication === null || publication === undefined || !Number.isFinite(publication)) return null;
    const anchor = parts(publication, useZone);
    if (!anchor) return null;
    const shift = /tomorrow/i.test(match[1] || match[2] || '') ? 1 : 0;
    const day = parts(wallEpoch({ ...anchor, hour: 0, minute: 0 }) + shift * DAY_MS, { offset: 0 });
    const next = parts(wallEpoch({ ...day, hour: 0, minute: 0 }) + DAY_MS, { offset: 0 });
    const instants = wallInstants(next, useZone);
    if (instants.length !== 1) return null;
    const local = parts(instants[0], target);
    const showYear = day.year !== local.year || day.year !== anchor.year;
    const ko = locale() === 'ko-KR';
    return {
      text: ko ? `${label} ${dateLabel(day, showYear)} 자정까지\n${target.label} ${dateLabel(local, showYear)} ${clockLabel(local)} 전 · 기한` :
        `${label} ${dateLabel(day, showYear)} · By midnight\n${target.label} ${dateLabel(local, showYear)} · Before ${clockLabel(local)} · Deadline`,
      detail: (ko ? '자정은 게시 시각 기준 원문 시간대 달력일이 끝나는 경계로 환산한 기한이며 정확한 실행 시각이 아닙니다. ' :
        'Midnight is shown as the source-zone calendar-day boundary after publication, not an exact execution time. ') +
        (label === 'PST' ? (ko ? '원문 PST(UTC−8)를 그대로 적용했습니다.' : 'Literal PST (UTC−8) is preserved.') : `${label} → ${target.label} (${target.zone}).`),
      deadlineAt: instants[0], assumedZone: false, dateInferred: true
    };
  }

  function endOfDayDeadline(text, item, target) {
    const matches = [...text.matchAll(/\b(?:by|before)\s+(?:EOD|(?:the\s+)?end\s+of\s+(?:the\s+)?day)\b/ig)];
    if (matches.length !== 1) return null;
    if (/\d{1,2}:\d{2}/.test(text.replace(/\b(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?\b/ig, ''))) return null;
    const clause = text.split(/(?<=[.!?;])\s+|\n/).find(part => part.includes(matches[0][0])) || '';
    // A feedback deadline in another sentence is not a reset deadline. Keep
    // business-day language and competing dates conservative rather than
    // manufacturing either an execution time or a business closing hour.
    if (!/\b(?:resets?|launch|release|ship|rollout|landing)\b/i.test(clause) ||
        /\b(?:no|not|never|won't|will not|maybe|might|could|if|cancelled|canceled|business|working|next week|after|until|between)\b|\?/i.test(text)) return null;
    const dates = [...text.matchAll(/\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b|\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?(?:,?\s+20\d{2})?\b|\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tonight|tomorrow|yesterday|this evening)\b/ig)];
    if (dates.length > 1) return null;
    const ko = locale() === 'ko-KR';
    const unresolved = reason => ({ text: ko ? 'EOD 기한 · 날짜·시간대 미정' : 'EOD deadline · Date/time zone unconfirmed', detail: reason });
    const zone = sourceZone(text.replace(/\bEOD\b/ig, ''), item);
    if (!zone) return unresolved('하루 종료 기한은 있으나 시간대를 확정할 수 없어 변환하지 않았습니다.');
    const publication = root.RadarTime.parseTimestamp(item.createdAt);
    const anchor = publication === null ? null : parts(publication, zone);
    const day = dates.length ? calendar(text, anchor) : anchor && { ...anchor, inferred: true };
    if (!day) return unresolved('하루 종료 기한은 있으나 게시일 또는 원문 날짜를 확인할 수 없어 변환하지 않았습니다.');
    const tomorrow = parts(wallEpoch({ ...day, hour: 0, minute: 0 }) + DAY_MS, { offset: 0 });
    const instants = wallInstants(tomorrow, zone);
    if (instants.length !== 1) return unresolved('해당 날짜의 종료 경계를 하나의 시각으로 확정할 수 없습니다.');
    const local = parts(instants[0], target);
    const showYear = day.year !== local.year || (anchor && day.year !== anchor.year);
    const assumed = zone.assumed ? (ko ? ' · 시간대 추정' : ' · Assumed zone') : '';
    return {
      text: ko ? `${zone.label} ${dateLabel(day, showYear)} 하루 종료까지\n${target.label} ${dateLabel(local, showYear)} ${clockLabel(local)} 전 · 기한${assumed}` :
        `${zone.label} ${dateLabel(day, showYear)} · By end of day\n${target.label} ${dateLabel(local, showYear)} · Before ${clockLabel(local)} · Deadline${assumed}`,
      detail: (ko ? 'EOD는 해당 달력일이 끝나는 경계로 환산한 기한이며 정확한 리셋·출시 실행 시각이나 실행 확정이 아닙니다. ' :
        'EOD is shown as the calendar-day boundary, not an exact or confirmed reset/release execution time. ') +
        (day.inferred ? (ko ? '날짜·연도는 원문 시간대의 게시일 기준입니다. ' : 'Date/year is anchored to publication in the source zone. ') : '') +
        (zone.assumed ? (ko ? '시간대는 Tibo의 공개 활동 지역 미 서부로 추정했습니다. ' : 'The source zone is assumed from Tibo’s public US Pacific location. ') : '') +
        (zone.label === 'PST' ? (ko ? '원문 PST(UTC−8)를 그대로 적용했으며 서머타임 PT로 바꾸지 않았습니다.' : 'Literal PST (UTC−8) is preserved, not daylight-saving PT.') : `${zone.label} → ${target.label} (${target.zone}).`),
      deadlineAt: instants[0], assumedZone: Boolean(zone.assumed), dateInferred: Boolean(day.inferred)
    };
  }

  function todayResetWindow(text, item, target) {
    try {
      const Signals = root.RadarSignals;
      const Time = root.RadarTime;
      if (!item || !target || !Signals || !Time) return null;
      if (typeof Signals.isResetForecast !== 'function' || typeof Signals.classify !== 'function') return null;
      if (item.source?.id !== 'codex-lead') return null;
      const author = String(item.author || item.handle || item.username || '').trim().replace(/^@/, '');
      if (author.toLowerCase() !== 'thsottiaux') return null;
      if (item.truncated || item.isTruncated) return null;
      if (item.assessment?.report) return null;
      const url = String(item.url || '').trim();
      const m = /^https:\/\/x\.com\/thsottiaux\/status\/(\d+)$/.exec(url);
      if (!m) return null;
      const ownId = typeof item.id === 'string' ? item.id : '';
      if (!/^[1-9]\d{0,24}$/.test(ownId) || ownId !== m[1]) return null;
      const publication = Time.parseTimestamp(item.createdAt);
      if (typeof publication !== 'number' || !Number.isFinite(publication)) return null;
      const body = String(item.text != null ? item.text : (text || ''));
      if (!body.trim() || body.includes('?')) return null;
      if (Signals.isResetForecast(item) !== true) return null;
      const clauses = body.split(/[.!;\n]+/).map(s => s.trim()).filter(Boolean);
      const hit = clauses.some(clause => {
        if (!/\btoday\b/i.test(clause) || !/\breset/i.test(clause)) return false;
        const c = Signals.classify({ ...item, text: clause }, { now: publication });
        return !!(c && c.actionable === true);
      });
      if (!hit) return null;
      const zone = sourceZone(text, item);
      if (!zone || (zone.zone == null && !Number.isFinite(zone.offset))) return null;
      const p = parts(publication, zone);
      if (!p) return null;
      const midnight = wallEpoch({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }) + DAY_MS;
      const next = parts(midnight, { offset: 0 });
      const cands = wallInstants({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0 }, zone);
      if (!Array.isArray(cands) || cands.length !== 1) return null;
      const at = cands[0];
      if (!Number.isFinite(at) || at <= publication) return null;
      const tp = parts(at, target);
      const pp = parts(publication, target);
      const showYear = tp.year !== pp.year;
      const ko = /^ko/i.test(String(locale() || ''));
      const when = `${target.label} ${dateLabel(tp, showYear)} ${clockLabel(tp)}`;
      const assumed = !!zone.assumed;
      let line2;
      let source;
      let detail;
      if (ko) {
        source = `원문 기준: ${zone.label} 오늘 자정`;
        line2 = `${when}까지 · 오늘 중 추정 · ${assumed ? '미 서부 시간 가정' : `${zone.label} 기준`}`;
        detail = `'오늘' 언급을 게시 시점의 ${zone.label}${assumed ? '(가정)' : ''} 날짜 기준으로 해석한 추정 마감입니다. 정확한 시각이나 보장이 아니며, 작성자의 현재 위치를 뜻하지도 않습니다.`;
      } else {
        source = `Source: end of today, ${zone.label}`;
        line2 = `by ${when} · est. sometime today · ${assumed ? 'US West time assumed' : `${zone.label} basis`}`;
        detail = `Estimated from "today" using the posting date in ${zone.label}${assumed ? ' (assumed)' : ''}. Not an exact time or a guarantee, and not the author's current location.`;
      }
      return {
        deadlineAt: at,
        deadlineType: 'today-window',
        estimatedWindow: true,
        assumedZone: assumed,
        dateInferred: true,
        text: `${source}\n${line2}`,
        detail
      };
    } catch (e) {
      return null;
    }
  }

  function rawSchedule(item) {
    const target = root.RadarTime.countryZone();
    const text = String(item.text || '').replace(/[’‘]/g, "'");
    const raw = timing(text);
    const clocks = [...text.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/ig)];
    const clocks24 = clocks.length ? [] : [...text.replace(/\b(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?\b/ig, '')
      .matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/g)];
    if (!clocks.length && !clocks24.length) {
      const midnight = midnightDeadline(text, item, target);
      if (midnight) return midnight;
      const deadline = endOfDayDeadline(text, item, target);
      if (deadline) return deadline;
      const resetWindow = todayResetWindow(text, item, target);
      if (resetWindow) return resetWindow;
      const zone = sourceZone(text, item);
      const dayOnly = raw && !raw.includes('아님') && /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tonight|tomorrow)\b/i.test(text);
      return { text: dayOnly && zone ? `${raw} · ${zone.label}${zone.assumed ? ' 추정' : ''}\n${target.label} ${locale() === 'ko-KR' ? '시각 미정' : 'Time unconfirmed'}` : raw,
        detail: '원문에 정확한 시각이 없어 선택한 국가의 날짜·시각을 계산하지 않았습니다.' + (zone?.assumed ? ' 시간대는 공개 프로필의 샌프란시스코를 가정합니다.' : '') };
    }
    const unresolved = reason => ({ text: (raw || '시간 언급') + `\n${target.label} ${locale() === 'ko-KR' ? '날짜·시각 미정' : 'Date/time unconfirmed'}`, detail: reason });
    if (clocks.length + clocks24.length !== 1) return unresolved('여러 시각이 언급되어 자동 변환하지 않았습니다.');
    if ([...text.matchAll(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tomorrow|yesterday)\b/ig)].length > 1 ||
        /\bnext week\b/i.test(text)) return unresolved('여러 날짜 또는 다음 주 범위가 언급되어 단일 날짜를 선택하지 않았습니다.');
    // Range/deadline words in an unrelated later sentence (for example a
    // performance explanation "after the load spike") do not qualify this
    // clock. Keep whole-post negation and competing date/time checks intact.
    const clockClause = text.split(/(?<=[.!?;])\s+|\n/).find(part => part.includes((clocks[0] || clocks24[0])[0])) || text;
    const signals = root.RadarSignals || (typeof require === 'function' ? require('./signals') : null);
    const clockDeadline = signals?.clockDeadline(text) === true;
    if (/\b(?:not|never|won't|will not)\b/i.test(text) || (clockDeadline ? /\b(?:until|between|from|after)\b/i : /\b(?:until|between|from|before|after|by)\b/i).test(clockClause))
      return unresolved('부정·시간 범위·마감 표현은 단일 예정 시각으로 변환하지 않습니다.');
    const zone = sourceZone(text, item);
    if (!zone) return unresolved('시간대를 확정할 수 없어 자동 변환하지 않았습니다.');
    const at = root.RadarTime.parseTimestamp(item.createdAt);
    const anchor = at === null ? null : parts(at, zone);
    const calendarDay = calendar(text, anchor);
    const hour = clocks.length ? Number(clocks[0][1]) % 12 + (/^p/i.test(clocks[0][3]) ? 12 : 0) : Number(clocks24[0][1]);
    const minute = Number((clocks[0] || clocks24[0])[2] || 0);
    if (!calendarDay) return unresolved('날짜를 해석할 수 없어 선택한 국가의 날짜·시각을 확정하지 않았습니다.');
    const wall = { ...calendarDay, hour, minute };
    const instants = wallInstants(wall, zone);
    if (instants.length !== 1) return unresolved(instants.length ? '서머타임 종료로 같은 시각이 두 번 존재합니다.' : '서머타임 시작으로 존재하지 않는 현지 시각입니다.');
    const local = parts(instants[0], target);
    const showYear = wall.year !== local.year || (anchor && wall.year !== anchor.year);
    const note = zone.assumed ? ' · 추정' : calendarDay.inferred ? ' · 날짜 추정' : '';
    const detail = [zone.assumed ? '시간대 미표기: Tibo의 공개 활동 지역 샌프란시스코(America/Los_Angeles)를 가정했습니다. 실제 체류지는 다를 수 있습니다.' : `원문 시간대 ${zone.label} 기준입니다.`,
      calendarDay.inferred ? '날짜·연도는 게시 시점을 기준으로 해석했습니다. 요일은 게시일 이후 가장 가까운 날(next 동일 요일은 다음 주), this는 게시 주를 가정합니다.' : '원문 날짜 기준입니다.',
      `서머타임을 반영한 ${target.label} 시간(${target.zone})이며, 출시·리셋 확정을 뜻하지 않습니다.`].join(' ');
    if (clockDeadline) {
      const ko = locale() === 'ko-KR';
      const inclusive = /\bby\b/i.test(signals.timingStatement(text));
      const suffix = ko ? inclusive ? '까지 · 기한' : ' 이전 · 기한' : inclusive ? ' by · deadline' : ' before · deadline';
      const deadlineNote = calendarDay.inferred && !zone.assumed && /\b(?:today|tonight|tomorrow)\b/i.test(text)
        ? (ko ? ' · 게시일 기준' : ' · Based on publication') : note;
      return {
        text: `${zone.label} ${dateLabel(wall, showYear)} ${clockLabel(wall)}${suffix}\n${target.label} ${dateLabel(local, showYear)} ${clockLabel(local)}${suffix}${deadlineNote}`,
        detail: `${detail} ${ko ? '실행 시각이 아니라 마감 기한입니다.' : 'This is a deadline, not an execution time.'}`,
        deadlineAt: instants[0],
        deadlineType: inclusive ? 'by' : 'before',
        assumedZone: Boolean(zone.assumed),
        dateInferred: calendarDay.inferred,
      };
    }
    return { text: `${zone.label} ${dateLabel(wall, showYear)} ${clockLabel(wall)}\n${target.label} ${dateLabel(local, showYear)} ${clockLabel(local)}${note}`,
      detail, instant: instants[0], assumedZone: Boolean(zone.assumed), dateInferred: calendarDay.inferred };
  }

  function schedule(item) {
    if (root.RadarSignals?.resetMetaphor(item) && !root.RadarSignals.classify(item, { now: Date.parse(item.createdAt) }).actionable)
      return { text: english() ? 'Reset time unverified' : '리셋 시각 미확인', detail: english() ? 'An ambiguous metaphor does not confirm a reset schedule.' : '모호한 은유만으로 리셋 일정을 확정하지 않습니다.' };
    const value = rawSchedule(item);
    if (!root.RadarSignals?.inferredTimingContext(item)) return value;
    const suffix = english() ? ' · Follow-up context' : ' · 후속 글 기준';
    return { ...value, text: value.text + suffix, association: 'inferred',
      detail: value.detail + (english() ? ' Subject inferred from a unique reset announcement by the same author within 15 minutes; direct reply relationship unconfirmed.' :
        ' 같은 작성자가 15분 이내 올린 유일한 리셋 공지와 문맥을 연결했습니다. 직접 답글 관계는 미확인입니다.') };
  }

  function timing(text) {
    const input = String(text || '').replace(/[’‘]/g, "'");
    const days = { monday: '월요일', tuesday: '화요일', wednesday: '수요일', thursday: '목요일', friday: '금요일', saturday: '토요일', sunday: '일요일' };
    const day = /\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(input);
    const clock = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(input);
    const clock24 = !clock && /\b([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/.exec(input);
    const hour = clock ? `${/^p/i.test(clock[3]) ? '오후' : '오전'} ${Number(clock[1])}:${clock[2] || '00'}` :
      clock24 ? `${Number(clock24[1]) >= 12 ? '오후' : '오전'} ${Number(clock24[1]) % 12 || 12}:${clock24[2]}` : '';
    const zone = /\b(?:UTC|GMT)(?:[+-]\d{1,2}(?::\d{2})?)?\b|\b(?:KST|PST|PDT|PT|EST|EDT|ET)\b/i.exec(input)?.[0]?.toUpperCase();
    let label = day ? `${day[1]?.toLowerCase() === 'next' ? '다음 ' : day[1] ? '이번 ' : ''}${days[day[2].toLowerCase()]}` : '';
    if (!label) label = /\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b/i.exec(input)?.[0] || '';
    if (!label) label = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?(?:,?\s+20\d{2})?\b/i.exec(input)?.[0] || '';
    if (!label) {
      const patterns = [[/\bnot today\b/i, '오늘은 아님'], [/\bnot tonight\b/i, '오늘 밤은 아님'],
        [/\btomorrow morning\b/i, '내일 아침'], [/\btomorrow\b/i, '내일'], [/\btonight\b/i, '오늘 밤'],
        [/\blater today\b/i, '오늘 중'], [/\bthis evening\b/i, '오늘 저녁'], [/\bnext week\b/i, '다음 주'],
        [/\bthis week\b/i, '이번 주'], [/\bnext hour\b/i, '한 시간 이내'], [/\bsoon\b/i, '곧'], [/\btoday\b/i, '오늘']];
      label = patterns.find(([pattern]) => pattern.test(input))?.[1] || '';
    }
    const untilDay = day && new RegExp(`\\bnot until\\s+(?:next\\s+|this\\s+)?${day[2]}\\b`, 'i').test(input);
    const negatedDay = day && new RegExp(`\\b(?:not|won't|will not)\\s+(?:on\\s+)?(?:next\\s+|this\\s+)?${day[2]}\\b`, 'i').test(input);
    if (untilDay) label += ' 전에는 아님';
    else if (negatedDay) label += '은 아님';
    return [label, hour && [hour, zone].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  }

  // Event retention is independent of reset predictions. An unknown ending is
  // a labelled display deadline, never a claimed event end or reset moment.
  function eventWindow(item) {
    const text = String(item.text || '');
    const zone = sourceZone(text, item);
    const publication = root.RadarTime.parseTimestamp(item.createdAt);
    const anchor = publication === null ? null : parts(publication, zone || { offset: 0 });
    const date = calendar(text, anchor);
    if (!date) return null;
    const explicitDates = [...text.matchAll(/\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b|\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\.?(?:,?\s+20\d{2})?\b/gi)];
    const dateRange = /\b(to|through|until)\b|[–—]/i.test(text);
    let endDate = dateRange && explicitDates.length === 2 ? calendar(explicitDates[1][0], date) : date;
    const shortRange = /\b([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:,?\s+(20\d{2}))?\b/.exec(text);
    if (shortRange) endDate = calendar(`${shortRange[1]} ${shortRange[3]}, ${shortRange[4] || date.year}`, date);
    if (!endDate || wallEpoch(endDate) < wallEpoch(date) || wallEpoch(endDate) - wallEpoch(date) > 31 * DAY_MS) return null;
    const clockText = text.replace(/\b(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?\b/gi, match => ' '.repeat(match.length));
    const clocks = [...clockText.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b|\b([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/gi)];
    const hourMinute = match => match[1] ? { hour: Number(match[1]) % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0), minute: Number(match[2] || 0) } : { hour: Number(match[4]), minute: Number(match[5]) };
    const single = wall => { const values = zone ? wallInstants(wall, zone) : []; return values.length === 1 ? values[0] : null; };
    const between = clocks.length === 2 ? text.slice(clocks[0].index + clocks[0][0].length, clocks[1].index) : '';
    const range = clocks.length === 2 && /\b(?:to|until|through|ends?|ending)\b|[-–—]/i.test(between);
    const endOnly = clocks.length === 1 && /\b(?:ends?|ending|until)\s+(?:at\s+)?$/i.test(text.slice(0, clocks[0].index));
    const startAt = clocks.length === 1 && !endOnly || range ? single({ ...date, ...hourMinute(clocks[0]) }) : null;
    const endAt = range ? single({ ...endDate, ...hourMinute(clocks[1]) }) : endOnly ? single({ ...endDate, ...hourMinute(clocks[0]) }) : null;
    if (range && (!startAt || !endAt || endAt <= startAt)) return null;
    const tomorrow = parts(wallEpoch(endDate) + DAY_MS, { offset: 0 });
    // Without a timezone, keep through the last possible local event day (UTC-12).
    const fallbackEnd = wallInstants({ ...tomorrow, hour: 0, minute: 0 }, zone || { offset: -720 })[0];
    return { date, endDate, startAt, endAt, until: endAt || fallbackEnd, zone,
      dateText: dateLabel(date) + (wallEpoch(endDate) !== wallEpoch(date) ? ' – ' + dateLabel(endDate) : ''),
      explicitDate: Boolean(explicitDates.length || shortRange) };
  }

  function timingReplies(items, now = Date.now()) {
    const canonical = item => item && /^https:\/\/x\.com\/(?:thsottiaux|reach_vb|openai)\/status\/[1-9]\d{0,24}$/i.test(item.url || '') &&
      item.url === `https://x.com/${item.author}/status/${item.id}`;
    const current = new Map((items || []).filter(item => item?.id).map(item => [item.id, item]));
    const evidence = [...current.values()];
    for (const item of current.values()) if (root.RadarSignals.inferredTimingContext(item) && !current.has(item.replyContext.id))
      evidence.push({ ...item.replyContext, source: item.source });
    return root.RadarSignals.linkTimingFollowUps(evidence).filter(item => current.has(item.id)).flatMap(item => {
      const at = root.RadarTime.parseTimestamp(item.createdAt), parent = item.replyContext;
      const inferred = root.RadarSignals.inferredTimingContext(item);
      const before = root.RadarTime.parseTimestamp(parent?.createdAt);
      const knownParent = current.get(parent?.id);
      if (knownParent && (knownParent.text !== parent.text || knownParent.url !== parent.url ||
        root.RadarTime.parseTimestamp(knownParent.createdAt) !== before)) return [];
      if (!canonical(item) || !canonical(parent) || item.id === parent.id || !Number.isFinite(before) || before >= at || at - before > 7 * DAY_MS ||
          !Number.isFinite(at) || at > now + 300000 || now - at > 7 * DAY_MS || item.truncated || parent.truncated ||
          (!inferred && parent.relation !== 'conversation-before') || parent.targetId !== item.id || parent.author?.toLowerCase() !== item.author?.toLowerCase() ||
          !root.RadarSignals.resetAnchor({ ...parent, source: item.source })) return [];
      const assessment = root.RadarSignals.classify(item, { now: at });
      const time = schedule(item);
      return (assessment.actionable || inferred) && (Number.isFinite(time.deadlineAt) || Number.isFinite(time.instant)) ? [{ ...item,
        assessment: inferred ? { actionable: false, candidate: true, confidence: 'medium', rule: 'reset-timing-follow-up', timingLink: 'inferred',
          eventAt: null, reason: '직전 리셋 공지의 후속 일정 문맥 · 직접 답글 관계 미확인' } : assessment }] : [];
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
  }
  function list(signalSnapshot, hintSnapshot, settings) {
    if (!settings.monitorSignals) return [];
    const active = (signalSnapshot?.activeSignals || [signalSnapshot?.signal].filter(Boolean)).filter(item =>
      root.RadarSignals.isActive(item) && (item.source?.id !== 'codex-lead' || settings.monitorLeadSource));
    const hints = settings.monitorLeadSource ? root.RadarSignals.hintCandidates(hintSnapshot?.items || [], { limit: 100 }) : [];
    const reports = settings.monitorLeadSource ? root.RadarSignals.reports(signalSnapshot?.reports || []) : [];
    const events = settings.monitorLeadSource ? root.RadarEvents?.groups(hintSnapshot?.events || [], [...(hintSnapshot?.items || []), ...active, ...reports]) || [] : [];
    const tibo = [...events.filter(event => event.status !== 'cancelled').flatMap(event => event.related), ...active.filter(item => settings.monitorLeadSource && item.source?.id === 'codex-lead'), ...hints, ...reports];
    const unique = new Map([...active, ...tibo].map(item => [String(item.source?.id || '') + ':' + item.id, item]));
    const archived = new Set();
    // Display rows may carry a prefixed id or shared URL (?s=20). Match them to a reply's
    // canonical parent by public X status identity only; never rewrite id/key/url.
    const xStatus = value => {
      try {
        const url = new URL(String(value || ''));
        const path = /^\/(thsottiaux|reach_vb|openai)\/status\/([1-9]\d{0,24})\/?$/i.exec(url.pathname);
        return url.protocol === 'https:' && url.hostname === 'x.com' && !url.port && !url.username && !url.password && path ?
          { author: path[1].toLowerCase(), id: path[2] } : null;
      } catch (_) { return null; }
    };
    // Explicit monitored handle/alias normalization; unknown authors yield '' and never match.
    const authorAliases = new Map([['tibo', 'thsottiaux'], ['thsottiaux', 'thsottiaux'], ['vb', 'reach_vb'],
      ['reach_vb', 'reach_vb'], ['openai', 'openai']]);
    const authorKey = value => typeof value === 'string' ?
      authorAliases.get(value.trim().replace(/^@/, '').toLowerCase()) || '' : '';
    // Visible feed ids may carry arbitrary prefixes, so they are not identity. The trusted
    // canonical URL plus a matching candidate author is the status identity.
    const sameStatus = (item, id) => {
      const own = xStatus(item?.url);
      return !!own && own.id === id.id && own.author === id.author;
    };
    const canonicalParent = (candidates, ctx, sourceId, parent) => {
      const id = xStatus(ctx?.url), at = root.RadarTime.parseTimestamp(ctx?.createdAt);
      if (!id || sourceId !== 'codex-lead' || String(ctx.id) !== id.id || authorKey(ctx.author) !== id.author ||
          !Number.isFinite(at)) return false;
      const group = candidates.filter(item => item?.source?.id === 'codex-lead' && sameStatus(item, id));
      if (!group.length || (parent && !group.includes(parent))) return false;
      const first = group[0], time = root.RadarTime.parseTimestamp(first.createdAt);
      // Disagreeing visible variants (e.g. stale pre-edit copy) make the association ambiguous.
      if (!group.every(item => item.text === first.text && root.RadarTime.parseTimestamp(item.createdAt) === time &&
          authorKey(item.author) === id.author)) return false;
      return typeof first.text === 'string' && first.text === ctx.text && time === at && authorKey(first.author) === authorKey(ctx.author);
    };
    // Visible candidates only, captured before archived replies are inserted.
    const visibleItems = [...unique.values()];
    if (settings.monitorLeadSource) for (const item of timingReplies(signalSnapshot?.timingReplies)) {
      const key = item.source.id + ':' + item.id, parent = unique.get(item.source.id + ':' + item.replyContext.id);
      // codex-lead always goes through the ambiguity-guarded canonical match (no raw id fast path).
      if (!unique.has(key) && (item.source.id === 'codex-lead' ? canonicalParent(visibleItems, item.replyContext, item.source.id) :
          parent?.text === item.replyContext.text && parent.url === item.replyContext.url &&
          root.RadarTime.parseTimestamp(parent.createdAt) === root.RadarTime.parseTimestamp(item.replyContext.createdAt))) {
        unique.set(key, item); archived.add(key);
      }
    }
    const priority = news => news.topic === 'event' ? 2 : news.topic === 'launch' ? 1 : 0;
    const scope = root.RadarResetScope || (typeof require === 'function' ? require('./reset-scope') : null);
    const rows = [...unique.entries()].filter(([,item]) => scope?.allows(item, settings) === true).map(([key, item]) => ({ ...describe(item, key), archivedTiming: archived.has(key) })).sort((a, b) => priority(a) - priority(b) ||
      root.RadarTime.parseTimestamp(b.item.createdAt) - root.RadarTime.parseTimestamp(a.item.createdAt));
    const schedules = new Map(rows.map(row => [row.key, schedule(row.item)]));
    return rows.map(row => {
      const own = schedules.get(row.key);
      const current = { ...row, timingSchedule: own };
      if (row.item.assessment?.report || (own.deadlineAt && !own.estimatedWindow) || own.instant) return current;
      let times = rows.filter(child => (child.item.source?.id === 'codex-lead' ?
        child.item !== row.item && canonicalParent(visibleItems, child.item.replyContext, child.item.source.id, row.item) :
        child.item.replyContext?.id === row.item.id && child.item.replyContext.text === row.item.text &&
        child.item.replyContext.url === row.item.url && root.RadarTime.parseTimestamp(child.item.replyContext.createdAt) === row.publishedAt) &&
        (root.RadarSignals.classify(child.item, { now: root.RadarTime.parseTimestamp(child.item.createdAt) }).actionable || root.RadarSignals.inferredTimingContext(child.item)))
        .map(child => ({ child, time: schedules.get(child.key) })).filter(({ time }) => time.deadlineAt || time.instant);
      const exact = times.filter(({ time }) => !time.estimatedWindow);
      if (exact.length) times = exact;
      else if (own.deadlineAt) return current;
      const distinct = new Set(times.map(({ time }) => `${time.deadlineAt ? time.deadlineType || 'deadline' : 'instant'}:${time.deadlineAt || time.instant}`));
      if (distinct.size !== 1) return current;
      const { child, time } = times[0];
      return { ...current, timing: time.text, timingSchedule: time, timingDetail: time.detail + (time.association === 'inferred' ? '' : ' · 확인된 같은 작성자의 일정 답글 기준'), timingSourceKey: child.key };
    });
  }

  function describe(item, key) {
    const target = root.RadarTime.countryZone();
    const inferredReset = root.RadarSignals.isInferredReset(item);
    const discussion = ['reset-poll', 'reset-choice', 'reset-short'].includes(item.assessment?.rule);
    const semantic = item.assessment?.rule === 'semantic-reset';
    const review = semantic || item.assessment?.rule === 'reset-review';
    const semanticLabel = english() ? ({ forecast: 'AI forecast', completed: 'AI completion clue', uncertain: 'AI review' })[item.assessment?.semanticCategory] :
      ({ forecast: 'AI 예고', completed: 'AI 완료 암시', uncertain: 'AI 검토' })[item.assessment?.semanticCategory];
    const tr = (key, fallback) => root.RadarI18n?.t?.(key, undefined, fallback) || fallback;
    const explicit = !inferredReset && !discussion && !review && (/\breset(?:s|ting)?\b/i.test(item.text) ||
      item.assessment?.actionable === true && root.RadarSignals.classify(item, {
        now: root.RadarTime.parseTimestamp(item.createdAt) ?? Date.now()
      }).actionable);
    const timed = ['product-time', 'schedule-time'].includes(item.assessment?.rule);
    const reset = explicit || item.assessment?.report || item.assessment?.candidate && !item.assessment.topic && !timed;
    const event = reset ? null : root.RadarEvents?.resolve(item);
    const topic = reset ? null : item.assessment?.topic || (event ? 'event' : null);
    const time = event && event.status !== 'cancelled' ? { text: root.RadarEvents.describe(event).join('\n'), detail: event.officialUrl ? '공식 행사 일정 · 리셋 실행 시각이 아닙니다.' : '게시물의 행사 일정 · 리셋 실행 시각이 아닙니다.' } : schedule(item);
    const report = item.assessment?.report;
    const inferred = item.assessment?.completionLink === 'inferred';
    const reportTiming = inferred ? root.RadarI18n?.t?.('newsInferredLink', undefined, '연결 추정') || '연결 추정' :
      english() ? report === 'credit-grant' ? 'Credit grant' : report === 'reset-update' ? 'Reset update' : 'Reset complete' :
        report === 'credit-grant' ? '지급 안내' : report === 'reset-update' ? '후속 안내' : '완료 공지';
    const publishedAt = root.RadarTime.parseTimestamp(item.createdAt);
    const published = Number.isFinite(publishedAt) ? root.RadarTime.formatLocalized(new Date(publishedAt), {
      timeZone: target.zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12'
    }, locale()) : '';
    const publishedText = published ? root.RadarI18n?.t?.('newsPublished', [target.label, published], `게시 · ${target.label} · ${published}`) ||
      `게시 · ${target.label} · ${published}` : root.RadarI18n?.t?.('newsPublicationUnknown', undefined, '게시 시각 미확인') || '게시 시각 미확인';
    const kind = root.RadarSignals.resetKind(item);
    const kindLabel = review ? tr('newsResetReviewContext', '원문 확인 필요 · 리셋 실행·종류·시각·내 계정 반영 미확정') : discussion ? '리셋 설문·암시 · 실행 미확정' : inferred ? root.RadarI18n?.t?.('newsInferredContext', undefined, '앞선 예고와 연결 추정 · 5시간·주간 대상 미확인') || '앞선 예고와 연결 추정 · 5시간·주간 대상 미확인' : report === 'reset-update' ? item.assessment.updateStatus === 'resolved' ? '리셋 반영 수정 안내' : '리셋 반영 조사·보완' :
      topic && !explicit ? '리셋 미확인' : { banked: 'Banked reset · 리셋권', ordinary: '일반 리셋', both: '일반 + Banked reset', unknown: '리셋 종류 미확인' }[kind];
    return { key, item, event, publishedAt, publishedText, label: inferredReset ? (english() ? 'Reset inferred' : '리셋 추정') : root.RadarSignals.isResetForecast(item) && !explicit ? (english() ? 'Reset forecast' : '리셋 예고') : semantic ? semanticLabel || 'AI 검토' : review ? tr('newsResetReview', '검토 후보') : discussion ? item.assessment.rule === 'reset-poll' ? '리셋 설문' : '리셋 암시' : inferred ? root.RadarI18n?.t?.('newsInferredCompletion', undefined, '완료 표현') || '완료 표현' : report === 'credit-grant' ? 'Banked' : report === 'reset-update' ? '리셋 후속' : report ? 'reset 완료' : explicit ? 'reset' : topic === 'event' || event ? '행사' : topic === 'launch' ? '출시' : '후보', explicit, kind, kindLabel, topic,
      timing: report ? reportTiming : time.text,
      timingDetail: report ? '표시 시각은 게시 시각입니다. 실제 지급·계정 반영 시각은 별도 확인이 필요합니다.' : time.detail,
      caption: semantic ? `${kindLabel} · ${item.assessment.evidence}` : review ? kindLabel : topic && !explicit ? item.assessment?.reason || '행사 일정 · 리셋 미확인' : report ? item.assessment.reason : explicit ? 'reset 직접 언급 · 실행 확정과는 다릅니다' : timed ? item.assessment.reason : '간접 표현 · 리셋 미확정' };
  }
  function select(signalSnapshot, hintSnapshot, settings) {
    return list(signalSnapshot, hintSnapshot, settings)[0] || null;
  }
  root.RadarNews = Object.freeze({ timing, schedule, eventWindow, timingReplies, list, select, describe });
  if (typeof module !== 'undefined') module.exports = root.RadarNews;
})(globalThis);
