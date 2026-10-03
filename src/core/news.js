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

  function schedule(item) {
    const target = root.RadarTime.countryZone();
    const text = String(item.text || '').replace(/[’‘]/g, "'");
    const raw = timing(text);
    const clocks = [...text.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/ig)];
    const clocks24 = clocks.length ? [] : [...text.replace(/\b(?:UTC|GMT)\s*[+-]\d{1,2}(?::?\d{2})?\b/ig, '')
      .matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/g)];
    if (!clocks.length && !clocks24.length) {
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
    if (/\b(?:not|never|won't|will not)\b/i.test(text) || /\b(?:until|between|from|before|after|by)\b/i.test(clockClause))
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
    return { text: `${zone.label} ${dateLabel(wall, showYear)} ${clockLabel(wall)}\n${target.label} ${dateLabel(local, showYear)} ${clockLabel(local)}${note}`,
      detail, instant: instants[0], assumedZone: Boolean(zone.assumed), dateInferred: calendarDay.inferred };
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
        [/\bthis week\b/i, '이번 주'], [/\bnext hour\b/i, '한 시간 이내'], [/\bsoon\b/i, '곧']];
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

  function list(signalSnapshot, hintSnapshot, settings) {
    if (!settings.monitorSignals) return [];
    const active = (signalSnapshot?.activeSignals || [signalSnapshot?.signal].filter(Boolean)).filter(item =>
      root.RadarSignals.isActive(item) && (item.source?.id !== 'codex-lead' || settings.monitorLeadSource));
    const hints = settings.monitorLeadSource ? root.RadarSignals.hintCandidates(hintSnapshot?.items || [], { limit: 100 }) : [];
    const reports = settings.monitorLeadSource ? root.RadarSignals.reports(signalSnapshot?.reports || []) : [];
    const events = settings.monitorLeadSource ? root.RadarEvents?.groups(hintSnapshot?.events || [], [...(hintSnapshot?.items || []), ...active, ...reports]) || [] : [];
    const tibo = [...events.filter(event => event.status !== 'cancelled').flatMap(event => event.related), ...active.filter(item => settings.monitorLeadSource && item.source?.id === 'codex-lead'), ...hints, ...reports];
    const unique = new Map([...active, ...tibo].map(item => [String(item.source?.id || '') + ':' + item.id, item]));
    const priority = news => news.topic === 'event' ? 2 : news.topic === 'launch' ? 1 : 0;
    return [...unique.entries()].map(([key, item]) => describe(item, key)).sort((a, b) => priority(a) - priority(b) ||
      root.RadarTime.parseTimestamp(b.item.createdAt) - root.RadarTime.parseTimestamp(a.item.createdAt));
  }

  function describe(item, key) {
    const target = root.RadarTime.countryZone();
    const explicit = /\breset(?:s|ting)?\b/i.test(item.text);
    const timed = ['product-time', 'schedule-time'].includes(item.assessment?.rule);
    const reset = explicit || item.assessment?.report || item.assessment?.candidate && !item.assessment.topic && !timed;
    const event = reset ? null : root.RadarEvents?.resolve(item);
    const topic = reset ? null : item.assessment?.topic || (event ? 'event' : null);
    const time = event && event.status !== 'cancelled' ? { text: root.RadarEvents.describe(event).join('\n'), detail: event.officialUrl ? '공식 행사 일정 · 리셋 실행 시각이 아닙니다.' : '게시물의 행사 일정 · 리셋 실행 시각이 아닙니다.' } : schedule(item);
    const report = item.assessment?.report;
    const kind = root.RadarSignals.resetKind(item);
    const kindLabel = report === 'reset-update' ? item.assessment.updateStatus === 'resolved' ? '리셋 반영 수정 안내' : '리셋 반영 조사·보완' :
      topic && !explicit ? '리셋 미확인' : { banked: 'Banked reset · 리셋권', ordinary: '일반 리셋', both: '일반 + Banked reset', unknown: '리셋 종류 미확인' }[kind];
    return { key, item, event, label: report === 'credit-grant' ? 'Banked' : report === 'reset-update' ? '리셋 후속' : report ? 'reset 완료' : explicit ? 'reset' : topic === 'event' || event ? '행사' : topic === 'launch' ? '출시' : '후보', explicit, kind, kindLabel, topic,
      timing: report ? english() ? `${report === 'credit-grant' ? 'Credit grant' : report === 'reset-update' ? 'Reset update' : 'Reset complete'} · ${target.label} · Posted ${root.RadarTime.formatDateTime(item.createdAt, target.zone, locale())}` : `${report === 'credit-grant' ? '지급 안내' : report === 'reset-update' ? '후속 안내' : '완료 공지'} · ${target.label} ${root.RadarTime.formatDateTime(item.createdAt, target.zone, locale())} 게시` : time.text,
      timingDetail: report ? '표시 시각은 게시 시각입니다. 실제 지급·계정 반영 시각은 별도 확인이 필요합니다.' : time.detail,
      caption: topic && !explicit ? item.assessment?.reason || '행사 일정 · 리셋 미확인' : report ? item.assessment.reason : explicit ? 'reset 직접 언급 · 실행 확정과는 다릅니다' : timed ? item.assessment.reason : '간접 표현 · 리셋 미확정' };
  }
  function select(signalSnapshot, hintSnapshot, settings) {
    return list(signalSnapshot, hintSnapshot, settings)[0] || null;
  }
  root.RadarNews = Object.freeze({ timing, schedule, eventWindow, list, select });
  if (typeof module !== 'undefined') module.exports = root.RadarNews;
})(globalThis);
