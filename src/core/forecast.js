(function initForecast(root) {
  const SLOT_HOURS = 6;
  const HORIZON_HOURS = 72;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function zonedParts(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second)
    };
  }

  function offsetAt(timestamp, timeZone) {
    const parts = zonedParts(timestamp, timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    return representedAsUtc - Math.floor(timestamp / 1000) * 1000;
  }

  function zonedTimestamp(parts, timeZone) {
    const wallClockAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0
    );
    let timestamp = wallClockAsUtc;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      timestamp = wallClockAsUtc - offsetAt(timestamp, timeZone);
    }
    return timestamp;
  }

  function addWallClockHours(parts, hours) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour + hours));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: 0,
      second: 0
    };
  }

  function slotBoundaries(now, timeZone, horizonHours = HORIZON_HOURS) {
    const current = zonedParts(now, timeZone);
    const first = {
      ...current,
      hour: Math.floor(current.hour / SLOT_HOURS) * SLOT_HOURS,
      minute: 0,
      second: 0
    };
    const count = Math.ceil(horizonHours / SLOT_HOURS);
    return Array.from({ length: count }, (_, index) => {
      const startParts = addWallClockHours(first, index * SLOT_HOURS);
      const endParts = addWallClockHours(first, (index + 1) * SLOT_HOURS);
      return {
        startAt: zonedTimestamp(startParts, timeZone),
        endAt: zonedTimestamp(endParts, timeZone)
      };
    });
  }

  function totalProbability(signal, now, sourceCount = 1) {
    if (!signal?.assessment?.actionable) return { probability: 8, basis: "baseline" };
    const eventAt = root.RadarTime?.parseTimestamp?.(signal.assessment.eventAt);
    if (!eventAt || eventAt < now - 12 * 60 * 60 * 1000) return { probability: 8, basis: "baseline" };
    const effectiveScore = clamp(
      Number(signal.assessment.weightedScore ?? signal.assessment.score) || 0,
      1,
      9
    );
    let probability;
    if (signal.assessment.confidence === "high") probability = 70 + effectiveScore * 2;
    else if (signal.assessment.confidence === "medium") probability = 45 + effectiveScore * 3;
    else probability = 18 + effectiveScore * 2;
    const corroborationBoost = Math.min(10, Math.max(0, sourceCount - 1) * 4);
    return {
      probability: Math.round(clamp(probability + corroborationBoost, 8, 94)),
      basis: signal.prediction?.kind === "milestone" ? "community-experience" : "public-signal"
    };
  }

  function distribute(total, slots, eventAt) {
    const sigmaMs = 7 * 60 * 60 * 1000;
    const weights = eventAt ? slots.map((slot) => {
      const midpoint = (slot.startAt + slot.endAt) / 2;
      const distance = midpoint - eventAt;
      return Math.exp(-(distance * distance) / (2 * sigmaMs * sigmaMs));
    }) : slots.map(() => 1);
    const sum = weights.reduce((value, weight) => value + weight, 0) || 1;
    const raw = weights.map((weight) => total * weight / sum);
    const allocated = raw.map(Math.floor);
    let remainder = total - allocated.reduce((value, probability) => value + probability, 0);
    const fractionalOrder = raw
      .map((value, index) => ({ index, fraction: value - allocated[index] }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < fractionalOrder.length && remainder > 0; index += 1, remainder -= 1) {
      allocated[fractionalOrder[index].index] += 1;
    }
    return slots.map((slot, index) => ({ ...slot, probability: allocated[index] }));
  }

  function build(options = {}) {
    const now = options.now ?? Date.now();
    const timeZone = root.RadarTime?.isValidTimeZone?.(options.timeZone) ? options.timeZone : "UTC";
    const suppliedSignals = Array.isArray(options.signals) ? options.signals : [options.signal].filter(Boolean);
    const activeSignals = root.RadarSignals?.isActive
      ? suppliedSignals.filter((signal) => root.RadarSignals.isActive(signal, { now }))
      : suppliedSignals;
    const activeSignal = [...activeSignals].sort((a, b) => {
      const bScore = b.assessment?.weightedScore ?? b.assessment?.score ?? 0;
      const aScore = a.assessment?.weightedScore ?? a.assessment?.score ?? 0;
      return bScore - aScore;
    })[0] || null;
    const primaryEventAt = root.RadarTime?.parseTimestamp?.(activeSignal?.assessment?.eventAt);
    const corroborating = activeSignals.filter((signal) => {
      const eventAt = root.RadarTime?.parseTimestamp?.(signal.assessment?.eventAt);
      return primaryEventAt && eventAt && Math.abs(eventAt - primaryEventAt) <= 18 * 60 * 60 * 1000;
    });
    const sourceCount = new Set(corroborating.map((signal) => signal.source?.id || signal.author || signal.id)).size;
    const total = totalProbability(activeSignal, now, sourceCount);
    const boundaries = slotBoundaries(now, timeZone, options.horizonHours || HORIZON_HOURS);
    const eventAt = root.RadarTime?.parseTimestamp?.(activeSignal?.assessment?.eventAt);
    return {
      generatedAt: now,
      horizonHours: options.horizonHours || HORIZON_HOURS,
      timeZone,
      totalProbability: total.probability,
      basis: total.basis,
      sourceCount,
      slots: distribute(total.probability, boundaries, eventAt)
    };
  }

  root.RadarForecast = Object.freeze({ build, slotBoundaries });
  if (typeof module !== "undefined") module.exports = root.RadarForecast;
})(globalThis);
