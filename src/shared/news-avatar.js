(function initNewsAvatar(root) {
  const bundled = Object.freeze({
    thsottiaux: '../../assets/profiles/tibo.jpg',
    reach_vb: '../../assets/profiles/vb.jpg',
    openai: '../../assets/profiles/openai.jpg'
  });
  function create(item, entries = []) {
    const signals = root.RadarSignals;
    const avatar = document.createElement('span');
    avatar.className = 'news-avatar'; avatar.setAttribute('aria-hidden', 'true');
    const author = signals.authorName(item);
    const initial = author === 'OpenAI' ? 'AI' : author === 'Tibo' ? 'T' : author === 'VB' ? 'VB' : '·';
    const handle = String(item?.author || '').replace(/^@/, '').toLowerCase();
    const local = signals.isLead(item) ? bundled[handle] : null;
    const image = () => {
      const img = document.createElement('img');
      img.width = 24; img.height = 24; img.alt = ''; img.decoding = 'async';
      return img;
    };
    const base = local ? image() : null;
    const showBase = () => {
      avatar.replaceChildren(document.createTextNode(initial));
      if (base) avatar.append(base);
    };
    showBase();
    if (base) {
      base.addEventListener('error', () => base.remove(), { once: true });
      base.src = local;
    }
    const photo = signals.isLead(item) && (signals.avatarUrl(item.avatarUrl) ||
      entries.map(entry => entry.item).filter(other => signals.isLead(other) && signals.authorName(other) === author)
        .map(other => signals.avatarUrl(other.avatarUrl)).find(Boolean));
    if (photo) {
      // The bundled photo stays visible until the latest photo actually loads.
      const latest = image(); latest.referrerPolicy = 'no-referrer'; latest.crossOrigin = 'anonymous';
      latest.addEventListener('load', () => avatar.replaceChildren(latest), { once: true });
      latest.addEventListener('error', showBase, { once: true });
      latest.src = photo;
    }
    return avatar;
  }
  root.RadarNewsAvatar = Object.freeze({ create, bundled });
  if (typeof module !== 'undefined') module.exports = root.RadarNewsAvatar;
})(globalThis);
