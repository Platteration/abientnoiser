/* Saved mixes (localStorage), autosave, import/export, share codes. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const KEY = 'ambientnoiser.mixes.v1';
  const AUTO = 'ambientnoiser.autosave.v1';
  const PREFS = 'ambientnoiser.prefs.v1';
  /** A ceiling on the library, enforced where it is written. Every entry is rebuilt as
   *  its own list item on every render, so an imported file of tens of thousands of
   *  mixes costs the visitor on every load, fills the localStorage quota so their own
   *  saves start failing, and can only be undone one confirm() at a time. */
  const MAX_MIXES = 500;

  function read(key, fallback) {
    try { const raw = root.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Whitelist lookup by own property only. `TABLE[key]` is truthy for every name
   *  inherited from Object.prototype ('constructor', '__proto__', 'toString'), so a
   *  bare lookup lets a share link smuggle one of those through as a valid id. */
  const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

  /** Per-movement overrides: { "3": { mood, keyRoot, mode, minutes } }. */
  function cleanEdits(edits) {
    const out = {};
    if (!edits || typeof edits !== 'object') return out;
    for (const key of Object.keys(edits)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i > 400) continue;
      const e = edits[key] || {};
      const clean = {};
      if (has(AN.MOODS, e.mood)) clean.mood = e.mood;
      if (has(AN.theory.MODES, e.mode)) clean.mode = e.mode;
      if (Number.isInteger(Number(e.keyRoot))) clean.keyRoot = ((Number(e.keyRoot) % 12) + 12) % 12;
      const mins = Number(e.minutes);
      if (Number.isFinite(mins) && mins > 0) clean.minutes = Math.min(60, Math.max(0.5, Math.round(mins * 2) / 2));
      if (Object.keys(clean).length) out[i] = clean;
    }
    return out;
  }

  function cleanSettings(s) {
    const style = has(AN.STYLES, s.style) ? s.style : 'ambient';
    const levels = {};
    for (const l of AN.MUSIC_LAYERS.concat(AN.AMBIENCE_LAYERS)) {
      const v = Number(s.levels && s.levels[l.id]);
      levels[l.id] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
    return {
      seed: String(s.seed || AN.randomSeed()).slice(0, 64),
      style,
      daypart: has(AN.DAYPARTS, s.daypart) ? s.daypart : (s.daypart === 'auto' ? 'auto' : null),
      durationMin: Math.min(240, Math.max(5, Number(s.durationMin) || 60)),
      sectionMin: Math.min(15, Math.max(1, Number(s.sectionMin) || 4)),
      levels,
      volume: Math.min(1, Math.max(0, Number.isFinite(Number(s.volume)) ? Number(s.volume) : 0.8)),
      edits: cleanEdits(s.edits),
    };
  }

  const storage = {
    list() { const l = read(KEY, []); return Array.isArray(l) ? l : []; },
    /** @returns the saved mix, or null if this browser refused to store it. */
    save(name, settings) {
      const mixes = this.list();
      const mix = { id: uid(), name: String(name || 'Untitled').slice(0, 60), createdAt: Date.now(), settings: cleanSettings(settings) };
      mixes.unshift(mix);
      if (mixes.length > MAX_MIXES) mixes.length = MAX_MIXES;   // newest first, so this drops the oldest
      return write(KEY, mixes) ? mix : null;
    },
    /** @returns false if this browser refused the write, like every other writer here. */
    rename(id, name) {
      const mixes = this.list().map((m) => (m.id === id ? Object.assign({}, m, { name: String(name).slice(0, 60) }) : m));
      return write(KEY, mixes);
    },
    remove(id) { return write(KEY, this.list().filter((m) => m.id !== id)); },
    /** Empty the library in one go — the only way back from a library someone filled. */
    clear() { return write(KEY, []); },
    get(id) { return this.list().find((m) => m.id === id) || null; },
    exportAll() { return JSON.stringify({ app: 'ambientnoiser', version: 1, mixes: this.list() }, null, 2); },
    /** @returns { added, skipped, full } — throws if the browser refused to store the result. */
    importJSON(text) {
      const data = JSON.parse(text);
      const incoming = Array.isArray(data) ? data : Array.isArray(data.mixes) ? data.mixes : null;
      if (!incoming) throw new Error('Not a mix library file');
      const mixes = this.list();
      const seen = new Set(mixes.map((m) => m && m.id));
      let added = 0, skipped = 0, full = 0;
      for (const m of incoming) {
        if (!m || !m.settings) continue;
        // Keep an exported id so importing a backup restores the library rather than
        // appending a second copy of every mix; only a genuinely new mix gets one.
        const id = typeof m.id === 'string' && m.id && m.id.length <= 40 ? m.id : uid();
        if (seen.has(id)) { skipped++; continue; }
        if (mixes.length >= MAX_MIXES) { full++; continue; }   // a file cannot grow the library past the ceiling
        seen.add(id);
        mixes.push({ id, name: String(m.name || 'Imported').slice(0, 60), createdAt: Number(m.createdAt) || Date.now(), settings: cleanSettings(m.settings) });
        added++;
      }
      if (!write(KEY, mixes)) throw new Error('this browser refused to store the library (out of space, or storage is blocked)');
      return { added, skipped, full };
    },
    autosave(settings) { return write(AUTO, cleanSettings(settings)); },
    prefs() { const p = read(PREFS, {}); return (p && typeof p === 'object') ? p : {}; },
    setPref(key, value) { const p = this.prefs(); p[key] = value; return write(PREFS, p); },
    loadAutosave() { const s = read(AUTO, null); return s ? cleanSettings(s) : null; },
    encodeShare(settings) {
      const s = cleanSettings(settings);
      const json = JSON.stringify(s);
      const b64 = root.btoa(unescape(encodeURIComponent(json)));
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decodeShare(code) {
      try {
        const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(escape(root.atob(b64)));
        return cleanSettings(JSON.parse(json));
      } catch { return null; }
    },
    cleanSettings,
    MAX_MIXES,
  };

  AN.storage = storage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
