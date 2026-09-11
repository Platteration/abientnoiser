/* Saved mixes (localStorage), autosave, import/export, share codes. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const KEY = 'ambientnoiser.mixes.v1';
  const AUTO = 'ambientnoiser.autosave.v1';
  const PREFS = 'ambientnoiser.prefs.v1';
  /** A ceiling on the library, enforced where it is written. Every entry is rebuilt as
   *  its own list item on every render, so an imported file of tens of thousands of
   *  mixes costs the visitor on every load, fills the localStorage quota so their own
   *  saves start failing, and can only be undone one confirm() at a time.
   *  It bounds what a file may *add*; nothing truncates a library that is already
   *  bigger, because the excess is the visitor's own work. */
  const MAX_MIXES = 500;
  /** And a ceiling on the bytes, because the count alone does not bound them: a record
   *  carrying a full set of movement edits serialises to fifty times a plain one, so a
   *  couple of hundred of them still fill the ~5 MB localStorage budget and every later
   *  save fails. 500 mixes of ordinary size are about 180 KB, so this is roomy. */
  const MAX_BYTES = 1500000;
  /** The longest piece (240 min) cut into the shortest movements (1 min) — the same
   *  clamps cleanSettings applies below — so this is every movement the app can make,
   *  and an edit keyed past the last one is not something the UI can produce. */
  const MAX_DURATION_MIN = 240;
  const MIN_SECTION_MIN = 1;
  const MAX_MOVEMENTS = MAX_DURATION_MIN / MIN_SECTION_MIN;

  function read(key, fallback) {
    try { const raw = root.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Whitelist lookup by own property only, and by a string only. `TABLE[key]` is truthy
   *  for every name inherited from Object.prototype ('constructor', '__proto__',
   *  'toString'), so a bare lookup lets a share link smuggle one of those through as a
   *  valid id — and a non-string key is converted to one, which *throws* for an object
   *  whose toString is not callable. Everything here was parsed from JSON someone else
   *  may have written. */
  const has = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);

  /** The same reason: String({ toString: 'x' }) and Number(the same) both throw, and a
   *  throw on the way out of storage is what takes a page down. Only a primitive is a
   *  name or a number; anything else is absent. */
  const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);

  /** Per-movement overrides: { "3": { mood, keyRoot, mode, minutes } }. */
  function cleanEdits(edits) {
    const out = {};
    if (!edits || typeof edits !== 'object') return out;
    for (const key of Object.keys(edits)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= MAX_MOVEMENTS) continue;
      const e = edits[key] || {};
      const clean = {};
      if (has(AN.MOODS, e.mood)) clean.mood = e.mood;
      if (has(AN.theory.MODES, e.mode)) clean.mode = e.mode;
      if (Number.isInteger(num(e.keyRoot))) clean.keyRoot = ((num(e.keyRoot) % 12) + 12) % 12;
      const mins = num(e.minutes);
      if (Number.isFinite(mins) && mins > 0) clean.minutes = Math.min(60, Math.max(0.5, Math.round(mins * 2) / 2));
      if (Object.keys(clean).length) out[i] = clean;
    }
    return out;
  }

  function cleanSettings(s) {
    const style = has(AN.STYLES, s.style) ? s.style : 'ambient';
    const levels = {};
    for (const l of AN.MUSIC_LAYERS.concat(AN.AMBIENCE_LAYERS)) {
      const v = num(s.levels && s.levels[l.id]);
      levels[l.id] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    }
    return {
      seed: (str(s.seed) || AN.randomSeed()).slice(0, 64),
      style,
      daypart: has(AN.DAYPARTS, s.daypart) ? s.daypart : (s.daypart === 'auto' ? 'auto' : null),
      durationMin: Math.min(MAX_DURATION_MIN, Math.max(5, num(s.durationMin) || 60)),
      sectionMin: Math.min(15, Math.max(MIN_SECTION_MIN, num(s.sectionMin) || 4)),
      levels,
      volume: Math.min(1, Math.max(0, Number.isFinite(num(s.volume)) ? num(s.volume) : 0.8)),
      edits: cleanEdits(s.edits),
    };
  }

  /** One stored record, made safe to render — or null when it cannot be. What comes
   *  back out of storage is not necessarily what this app put in: a GitHub Pages
   *  project site keys localStorage by *origin*, so every other app the account
   *  publishes can write this key, and cleanSettings on the way in says nothing about
   *  what comes back out. renderLibrary() reaches straight into `m.settings.levels`. */
  function readMix(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    if (!m.settings || typeof m.settings !== 'object') return null;
    if (typeof m.id !== 'string' || !m.id) return null;   // the id is how load, queue and delete find it
    return {
      id: m.id.slice(0, 40),
      name: (str(m.name) || 'Untitled').slice(0, 60),
      createdAt: num(m.createdAt) || 0,
      settings: cleanSettings(m.settings),
    };
  }

  const storage = {
    /** Validated on the way *out*, not only on the way in: a record this app did not
     *  write is dropped rather than handed to a renderer. */
    list() {
      const l = read(KEY, []);
      if (!Array.isArray(l)) return [];
      const out = [];
      for (const m of l) { const mix = readMix(m); if (mix) out.push(mix); }
      return out;
    },
    /** @returns the saved mix, or null if this browser refused to store it.
     *  @throws at the ceiling, with a message the caller shows as it is. A full library
     *  refuses the new mix rather than dropping the oldest: truncating here would
     *  delete the visitor's own work on a routine press of Save, with nothing to undo
     *  it, and the ceiling exists to stop a *file* someone else wrote. Refusing is
     *  recoverable — they can delete a mix they no longer want. */
    save(name, settings) {
      const mixes = this.list();
      if (mixes.length >= MAX_MIXES) throw new Error(`Library is full — ${mixes.length} of ${MAX_MIXES} mixes saved. Delete one to make room.`);
      const mix = { id: uid(), name: (str(name) || 'Untitled').slice(0, 60), createdAt: Date.now(), settings: cleanSettings(settings) };
      mixes.unshift(mix);   // newest first
      return write(KEY, mixes) ? mix : null;
    },
    /** @returns false if this browser refused the write, like every other writer here. */
    rename(id, name) {
      const mixes = this.list().map((m) => (m.id === id ? Object.assign({}, m, { name: (str(name) || 'Untitled').slice(0, 60) }) : m));
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
      let bytes = JSON.stringify(mixes).length;
      let added = 0, skipped = 0, full = 0;
      for (const m of incoming) {
        if (!m || !m.settings) continue;
        // Keep an exported id so importing a backup restores the library rather than
        // appending a second copy of every mix; only a genuinely new mix gets one.
        const id = typeof m.id === 'string' && m.id && m.id.length <= 40 ? m.id : uid();
        if (seen.has(id)) { skipped++; continue; }
        if (mixes.length >= MAX_MIXES) { full++; continue; }   // a file cannot grow the library past the ceiling
        const entry = { id, name: (str(m.name) || 'Imported').slice(0, 60), createdAt: num(m.createdAt) || Date.now(), settings: cleanSettings(m.settings) };
        // ...nor past the size budget, which the count alone does not bound. Only the
        // entries this file is adding are ever refused: a library already over budget
        // is the visitor's own and stays whole.
        const size = JSON.stringify(entry).length + 1;
        if (bytes + size > MAX_BYTES) { full++; continue; }
        bytes += size;
        seen.add(id);
        mixes.push(entry);
        added++;
      }
      if (!write(KEY, mixes)) throw new Error('this browser refused to store the library (out of space, or storage is blocked)');
      return { added, skipped, full };
    },
    autosave(settings) { return write(AUTO, cleanSettings(settings)); },
    /** Preferences are stored data too, and the same origin sharing applies. Keep the
     *  scalars and the id lists; anything else — an object whose toString is not
     *  callable, say — is dropped rather than handed to buildSelect, which stringifies
     *  what it is given, before bind() has wired a single control. */
    prefs() {
      const p = read(PREFS, {});
      const out = {};
      if (!p || typeof p !== 'object') return out;
      for (const key of Object.keys(p)) {
        const v = p[key];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
        else if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === 'string');
      }
      return out;
    },
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
    MAX_BYTES,
  };

  AN.storage = storage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
