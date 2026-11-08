(function initModelRelease(root) {
  // Only confirmed, named OpenAI model launches from the monitored accounts.
  // A model mention or an upcoming release alone is not a launch.
  function detect(item) {
    if (!item || item.retracted || item.truncated || item.source?.id !== 'codex-lead' || typeof item.text !== 'string' || item.text.length > 6000) return null;
    const author = String(item.author || '').replace(/^@/, '').toLowerCase();
    if (!['openai', 'thsottiaux', 'reach_vb'].includes(author) || !/^[1-9]\d{0,24}$/.test(String(item.id || ''))) return null;
    if (root.RadarSecurity?.evidenceUrl(item)?.toLowerCase() !== `https://x.com/${author}/status/${item.id}`) return null;
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at)) return null;
    const clauses = item.text.replace(/[’‘]/g, "'").split(/(?<=[!?;])\s+|\n+/);
    for (const clause of clauses) {
      const model = clause.match(/\b(?:GPT[- ](?:\d[\w.-]*|oss[- ]?\d[\w.-]*)|o[1-9][\w.-]*)\b/i);
      if (!model) continue;
      if (!/\b(?:introducing|introduce|launch(?:ed|ing|es)?|releas(?:e|ed|ing)|ship(?:ped|ping|s)?|rolling out|rolls out|available now|now available|out now|unveil(?:ed|ing)?|announc(?:e|ed|ing))\b/i.test(clause)) continue;
      if (/\b(?:not|never|no longer|rumou?rs?|speculat(?:e|ion)|maybe|might|could|would|if|expected|upcoming|coming soon|next year|next month|will|won't|cancel(?:led|ed))\b|\?/i.test(clause)) continue;
      if (/\bo[1-9]/i.test(model[0]) && !/\b(?:openai|model|reasoning|introducing)\b/i.test(clause) && author !== 'openai') continue;
      return { model: model[0].replace(/\.$/, ''), publishedAt: at };
    }
    return null;
  }
  function merge(previous, items) {
    const saved = new Map((Array.isArray(previous) ? previous : []).filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
    for (const item of items || []) {
      const old = saved.get(item?.id);
      if (old && !item.truncated && root.RadarSecurity?.evidenceUrl(item) === old.url && item.text !== old.text && !detect(item)) {
        saved.set(item.id, { ...old, retracted: true });
      }
      if (!detect(item)) continue;
      const author = String(item.author).replace(/^@/, '').toLowerCase();
      saved.set(item.id, { id: item.id, author, text: item.text, createdAt: new Date(item.createdAt).toISOString(),
        url: `https://x.com/${author}/status/${item.id}`, source: { id: 'codex-lead', label: author, kind: 'x-page', weight: 1 } });
    }
    return [...saved.values()];
  }
  root.RadarModelRelease = Object.freeze({ detect, merge });
  if (typeof module !== 'undefined') module.exports = root.RadarModelRelease;
})(globalThis);
