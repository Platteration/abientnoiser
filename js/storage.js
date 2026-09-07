/* Saved mixes (localStorage), autosave, import/export, share codes. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const KEY = 'ambientnoiser.mixes.v1';
  const AUTO = 'ambientnoiser.autosave.v1';
  const PREFS = 'ambientnoiser.prefs.v1';

  function read(key, fallback) {
    try { const raw = root.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Per-movement overrides: { "3": { mood, keyRoot, mode, minutes } }. */
  function cleanEdits(edits) {
    const out = {};
    if (!edits || typeof edits !== 'object') return out;
    for (const key of Object.keys(edits)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i > 400) continue;
      const e = edits[key] || {};
      const clean = {};
      if (AN.MOODS[e.mood]) clean.mood = e.mood;
      if (AN.theory.MODES[e.mode]) clean.mode = e.mode;
      if (Number.isInteger(Number(e.keyRoot))) clean.keyRoot = ((Number(e.keyRoot) % 12) + 12) % 12;
      const mins = Number(e.minutes);
      if (Number.isFinite(mins) && mins > 0) clean.minutes = Math.min(60, Math.max(0.5, Math.round(mins * 2) / 2));
      if (Object.keys(clean).length) out[i] = clean;
    }
    return out;
  }

  function cleanSettings(s) {
    const style = AN.STYLES[s.style] ? s.style : 'ambient';
    const levels = {};
    for (const l of AN.MUSIC_LAYERS.concat(AN.AMBIENCE_LAYERS)) {
      const v = Number(s.levels && s.levels[l.id]);
      levels[l.id] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
    return {
      seed: String(s.seed || AN.randomSeed()).slice(0, 64),
      style,
      daypart: AN.DAYPARTS[s.daypart] ? s.daypart : (s.daypart === 'auto' ? 'auto' : null),
      durationMin: Math.min(240, Math.max(5, Number(s.durationMin) || 60)),
      sectionMin: Math.min(15, Math.max(1, Number(s.sectionMin) || 4)),
      levels,
      volume: Math.min(1, Math.max(0, Number.isFinite(Number(s.volume)) ? Number(s.volume) : 0.8)),
      edits: cleanEdits(s.edits),
    };
  }

  const storage = {
    list() { const l = read(KEY, []); return Array.isArray(l) ? l : []; },
    save(name, settings) {
      const mixes = this.list();
      const mix = { id: uid(), name: String(name || 'Untitled').slice(0, 60), createdAt: Date.now(), settings: cleanSettings(settings) };
      mixes.unshift(mix);
      write(KEY, mixes);
      return mix;
    },
    rename(id, name) {
      const mixes = this.list().map((m) => (m.id === id ? Object.assign({}, m, { name: String(name).slice(0, 60) }) : m));
      write(KEY, mixes);
    },
    remove(id) { write(KEY, this.list().filter((m) => m.id !== id)); },
    get(id) { return this.list().find((m) => m.id === id) || null; },
    exportAll() { return JSON.stringify({ app: 'ambientnoiser', version: 1, mixes: this.list() }, null, 2); },
    importJSON(text) {
      const data = JSON.parse(text);
      const incoming = Array.isArray(data) ? data : Array.isArray(data.mixes) ? data.mixes : null;
      if (!incoming) throw new Error('Not a mix library file');
      const mixes = this.list();
      let added = 0;
      for (const m of incoming) {
        if (!m || !m.settings) continue;
        mixes.push({ id: uid(), name: String(m.name || 'Imported').slice(0, 60), createdAt: Number(m.createdAt) || Date.now(), settings: cleanSettings(m.settings) });
        added++;
      }
      write(KEY, mixes);
      return added;
    },
    autosave(settings) { write(AUTO, cleanSettings(settings)); },
    prefs() { const p = read(PREFS, {}); return (p && typeof p === 'object') ? p : {}; },
    setPref(key, value) { const p = this.prefs(); p[key] = value; write(PREFS, p); },
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
  };

  AN.storage = storage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
