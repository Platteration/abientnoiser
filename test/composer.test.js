const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/prng.js');
require('../js/theory.js');
require('../js/composer.js');
require('../js/storage.js');
const AN = globalThis.AN;

test('rng is deterministic and key-sensitive', () => {
  const a = AN.rng('seed-1', 'x'), b = AN.rng('seed-1', 'x'), c = AN.rng('seed-2', 'x');
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  const seqC = Array.from({ length: 5 }, () => c.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('rng helpers stay in range', () => {
  const r = AN.rng('range');
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 7);
    assert.ok(v >= 3 && v <= 7);
  }
  assert.equal(r.poisson(0), 0);
  const w = r.weighted([['a', 0], ['b', 1]]);
  assert.equal(w, 'b');
});

test('diatonic chords have the expected qualities', () => {
  const T = AN.theory;
  assert.deepEqual(T.chordTones('major', 0, 3), [0, 4, 7]);
  assert.deepEqual(T.chordTones('major', 1, 4), [2, 5, 9, 12]);
  assert.equal(T.chordName(0, 'major', 0, 4), 'Cmaj7');
  assert.equal(T.chordName(0, 'major', 1, 4), 'Dm7');
  assert.equal(T.chordName(0, 'major', 4, 4), 'G7');
  assert.equal(T.chordName(0, 'major', 6, 4), 'Bm7b5');
  assert.equal(T.chordName(9, 'minor', 0, 3), 'Am');
  const voiced = T.voiceChord([0, 4, 7], 60, 66);
  assert.deepEqual(voiced, [60, 64, 67]);
  for (const m of voiced) assert.ok(m >= 60 && m < 72);
  assert.equal(T.rootInRange(7, 60, 36), 43);
});

test('compose produces a contiguous, reproducible plan', () => {
  const settings = { seed: 'amber-rain-123', style: 'lofi', durationMin: 60, sectionMin: 4 };
  const p1 = AN.compose(settings), p2 = AN.compose(settings);
  assert.deepEqual(p1, p2);
  assert.equal(p1.duration, 3600);
  assert.equal(p1.sections[0].start, 0);
  assert.equal(p1.sections[p1.sections.length - 1].end, 3600);
  for (let i = 1; i < p1.sections.length; i++) {
    assert.equal(p1.sections[i].start, p1.sections[i - 1].end);
    assert.ok(p1.sections[i].length > 60);
    assert.notEqual(p1.sections[i].moodId, p1.sections[i - 1].moodId, 'moods should change between sections');
  }
  assert.ok(p1.sections.length >= 12 && p1.sections.length <= 18);
  for (const s of p1.sections) {
    assert.ok(s.tempo >= 64 && s.tempo <= 94);
    assert.ok(AN.theory.MODES[s.mode]);
    assert.equal(s.chordNames.length, s.progression.length);
    assert.ok(s.name.length > 3);
  }
});

test('different seeds produce different plans, other styles compose too', () => {
  const a = AN.compose({ seed: 'one', style: 'ambient', durationMin: 30, sectionMin: 3 });
  const b = AN.compose({ seed: 'two', style: 'ambient', durationMin: 30, sectionMin: 3 });
  assert.notDeepEqual(a.sections.map((s) => s.moodId), b.sections.map((s) => s.moodId));
  for (const style of Object.keys(AN.STYLES)) {
    const p = AN.compose({ seed: 'x', style, durationMin: 45, sectionMin: 5 });
    assert.equal(p.style, style);
    assert.equal(p.duration, 45 * 60);
  }
  const fallback = AN.compose({ seed: 'x', style: 'nope', durationMin: 10, sectionMin: 2 });
  assert.equal(fallback.style, 'ambient');
});

test('sectionAt wraps and finds the right section', () => {
  const p = AN.compose({ seed: 'wrap', style: 'focus', durationMin: 20, sectionMin: 4 });
  assert.equal(AN.sectionAt(p, 0).index, 0);
  assert.equal(AN.sectionAt(p, p.duration).index, 0);
  assert.equal(AN.sectionAt(p, -1).index, p.sections.length - 1);
  const s = p.sections[2];
  assert.equal(AN.sectionAt(p, s.start).index, 2);
  assert.equal(AN.sectionAt(p, s.end - 0.001).index, 2);
  assert.equal(AN.formatTime(3725), '1:02:05');
  assert.equal(AN.formatTime(65), '1:05');
});

// A share link picks the ids. 'constructor', '__proto__' and 'toString' are truthy on
// every plain lookup table, so a whitelist that only tests for truth let them through:
// compose then built a movement whose mode was Object.prototype.toString.
test('inherited property names are not valid ids', () => {
  const hostile = {
    seed: 'proto', style: 'constructor', daypart: 'constructor', durationMin: 20, sectionMin: 2,
    levels: {}, volume: 0.5,
    edits: { 0: { mood: 'constructor', mode: 'constructor' }, 1: { mode: '__proto__' }, 2: { mood: 'toString' } },
  };

  const clean = AN.storage.cleanSettings(hostile);
  assert.equal(clean.style, 'ambient');
  assert.equal(clean.daypart, null);
  assert.deepEqual(clean.edits, {}, 'no inherited name survives as a mood or a mode');

  // and again straight from the link, since compose is reached before cleanSettings
  const plan = AN.compose(hostile);
  assert.equal(plan.style, 'ambient');
  for (const s of plan.sections) {
    assert.ok(Object.hasOwn(AN.theory.MODES, s.mode), `mode ${s.mode} is a real mode`);
    assert.ok(Object.hasOwn(AN.MOODS, s.moodId), `mood ${s.moodId} is a real mood`);
    assert.ok(AN.theory.scaleNotes(s.keyRoot, s.mode, 48, 72).length > 0);
    for (const name of s.chordNames) assert.ok(!name.includes('undefined'), `chord ${name} is named`);
  }

  // a real id still works, including one that shares a name with nothing
  const edited = AN.compose(Object.assign({}, hostile, { edits: { 0: { mode: 'dorian', mood: 'glow' } } }));
  assert.equal(edited.sections[0].mode, 'dorian');
  assert.equal(edited.sections[0].moodId, 'glow');
});

test('defaultSettings falls back for an inherited style name', () => {
  const s = AN.defaultSettings('constructor');
  assert.equal(s.style, 'ambient');
  assert.ok(Object.keys(s.levels).length > 0, 'levels come from a real style');
});

const MIXES_KEY = 'ambientnoiser.mixes.v1';

/** A localStorage stand-in: node has none, and these tests are about what the storage
 *  module does with what it finds in one. */
function withStorage(stored, fn) {
  const store = new Map();
  if (stored !== undefined) store.set(MIXES_KEY, JSON.stringify(stored));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  try { return fn(store); } finally { delete globalThis.localStorage; }
}

const plainMix = (i) => ({ id: `x${i}`, name: 'm', createdAt: 1, settings: { seed: 's', style: 'ambient' } });

// A library file is untrusted input like a share link: whoever hands the visitor a
// .json controls how many mixes are in it. Every one is rebuilt as its own list item
// on every render and takes a confirm() each to remove, so the list is bounded where
// it is written — in the import loop and in save() — not where it is drawn.
test('the library is bounded where it is written, and can be emptied', () => {
  withStorage(undefined, () => {
    const mixes = [];
    for (let i = 0; i < 1200; i++) mixes.push(plainMix(i));
    const res = AN.storage.importJSON(JSON.stringify({ app: 'ambientnoiser', version: 1, mixes }));
    assert.equal(AN.storage.list().length, 500, 'an imported file cannot grow the library past the ceiling');
    assert.equal(res.added, 500);
    assert.equal(res.full, 700, 'and what it left out is reported rather than silently dropped');

    assert.ok(AN.storage.clear(), 'a library that did get filled can be emptied in one go');
    assert.equal(AN.storage.list().length, 0);
  });
});

// save() shares the ceiling with the import loop, but not the remedy: the entries at
// the tail of a full library are the visitor's own mixes, and dropping one to make room
// for a new one deletes their work on a routine press of Save with nothing to undo it.
// Refusing costs them one mix they can save again; truncating costs them one they had.
test('a full library refuses a new save rather than deleting the oldest mix', () => {
  withStorage(undefined, () => {
    const mixes = [];
    for (let i = 0; i < 500; i++) mixes.push(plainMix(i));
    AN.storage.importJSON(JSON.stringify({ mixes }));
    assert.equal(AN.storage.list().length, 500);

    assert.throws(() => AN.storage.save('newest', { seed: 's', style: 'ambient' }),
      /full/i, 'the save is refused, with a message the UI can show as it is');
    const after = AN.storage.list();
    assert.equal(after.length, 500, 'and the library is exactly as it was');
    assert.ok(after.some((m) => m.id === 'x499'), 'the oldest mix is still there');
    assert.ok(!after.some((m) => m.name === 'newest'), 'and the new one did not go in');

    // room again after a deliberate deletion — the way back the refusal points at
    assert.ok(AN.storage.remove('x499'));
    const saved = AN.storage.save('newest', { seed: 's', style: 'ambient' });
    assert.equal(AN.storage.list().length, 500);
    assert.equal(saved.name, 'newest');
  });
});

// The upgrade path: a library built on a build with no ceiling is bigger than this one
// allows, and every one of those mixes is the visitor's own. Nothing trims it — not on
// read, and not on the next save, which is where a truncating save() would take 301 of
// them in one silent write.
test('a library already over the ceiling keeps every mix', () => {
  const stored = [];
  for (let i = 0; i < 801; i++) stored.push(plainMix(i));
  withStorage(stored, () => {
    assert.equal(AN.storage.list().length, 801, 'reading does not trim it');
    assert.throws(() => AN.storage.save('todays mix', { seed: 's', style: 'ambient' }), /full/i);
    assert.equal(AN.storage.list().length, 801, 'and neither does saving');
    assert.ok(AN.storage.rename('x800', 'renamed') && AN.storage.list().length === 801, 'nor renaming');
    assert.ok(AN.storage.remove('x800') && AN.storage.list().length === 800, 'only a deliberate deletion');
  });
});

// The count alone does not bound the bytes: a record carrying a full set of movement
// edits serialises to fifty times a plain one, so a couple of hundred of them fill the
// ~5 MB localStorage budget and every later save — the visitor's own — fails.
test('an imported library is bounded in bytes as well as in records', () => {
  const edits = {};
  for (let i = 0; i < 240; i++) edits[i] = { mood: 'glow', mode: 'dorian', keyRoot: 7, minutes: 3.5 };
  const fat = [];
  for (let i = 0; i < 400; i++) fat.push({ id: `f${i}`, name: 'fat', createdAt: 1, settings: { seed: 'seed', style: 'ambient', edits } });
  withStorage(undefined, (store) => {
    const res = AN.storage.importJSON(JSON.stringify({ mixes: fat }));
    const bytes = store.get(MIXES_KEY).length;
    assert.ok(res.added > 0, 'a big library still imports what fits');
    assert.ok(res.added < 400, `the rest is refused (${res.added} of 400 added)`);
    assert.equal(res.added + res.full, 400, 'and what was left out is counted');
    // half a megabyte is nowhere near the quota, and is derived from the budget rather
    // than from the record size this test happens to build
    assert.ok(bytes <= AN.storage.MAX_BYTES, `the stored library is ${bytes} bytes, over the ${AN.storage.MAX_BYTES} budget`);
    assert.ok(bytes < 5000000 / 2, 'so a file cannot take the whole localStorage quota');
  });
});

// The edit keys are what make a record big, and the UI can only produce one per
// movement. Bound them by the most movements the composer can make, not by a number
// large enough to leave room for a hostile file.
test('a movement edit past the last movement the app can make is dropped', () => {
  const longest = AN.compose({ seed: 'bounds', style: 'ambient', durationMin: 240, sectionMin: 1 });
  const last = longest.sections.length - 1;   // the composer's own bound, not storage's
  const clean = AN.storage.cleanSettings({
    seed: 's', style: 'ambient',
    edits: { 0: { mood: 'glow' }, [last]: { mood: 'glow' }, [last + 1]: { mood: 'glow' }, 4000: { mood: 'glow' } },
  });
  assert.ok(clean.edits[0] && clean.edits[last], 'every movement the UI can show can still be edited');
  assert.equal(clean.edits[last + 1], undefined, 'one past the last movement is not a movement');
  assert.equal(clean.edits[4000], undefined);
});

// Validated on the way out, not only on the way in. cleanSettings runs on every write,
// which says nothing about a record written by something that is not this app — and a
// GitHub Pages project site shares its origin, and so its localStorage, with every
// other app the account publishes. renderLibrary() reaches into m.settings.levels.
test('a stored record this app did not write is dropped rather than handed to a renderer', () => {
  const hostile = [
    null,
    'not a record',
    ['not a record either'],
    { id: 'a', name: 'no settings', createdAt: 1, settings: null },
    { id: 'b', name: 'settings are a string', createdAt: 1, settings: 'levels' },
    { name: 'no id', settings: { style: 'ambient' } },
    { id: 'd', name: { toString: 'not callable' }, createdAt: 'soon', settings: { style: 'constructor', levels: 'lots' } },
    { id: 'e', name: 'usable', createdAt: 3, settings: { seed: 's', style: 'lofi' } },
  ];
  withStorage(hostile, () => {
    const list = AN.storage.list();
    assert.deepEqual(list.map((m) => m.id), ['d', 'e'], 'only the records that can be rendered survive');
    for (const m of list) {
      assert.equal(typeof m.name, 'string');
      assert.ok(Object.hasOwn(AN.STYLES, m.settings.style), `style ${m.settings.style} is a real style`);
      assert.ok(m.settings.levels && typeof m.settings.levels === 'object', 'levels are there to read');
      for (const l of AN.MUSIC_LAYERS.concat(AN.AMBIENCE_LAYERS)) assert.equal(typeof m.settings.levels[l.id], 'number');
      assert.ok(Number.isFinite(m.createdAt));
    }
    assert.ok(AN.storage.get('e'), 'a usable record is still findable by id');
    assert.equal(AN.storage.get('a'), null, 'and a dropped one is not');
  });
});

// Preferences are read before a single control is wired — initTheme() hands the stored
// theme straight to buildSelect, which stringifies what it is given. Each field falls
// back on its own: one stray value must not cost the visitor the rest of their choices.
test('a stored preference that does not hold up falls back to its default, field by field', () => {
  withStorage(undefined, () => {
    globalThis.localStorage.setItem(AN.storage.KEYS.prefs, JSON.stringify({
      theme: { toString: 'not callable' }, quiet: true, crossfade: 15,
      queue: ['keep', { id: 'drop' }, 7, 'x'.repeat(41)], visuals: 'off', queueEvery: '10', probe: 1,
    }));
    const p = AN.storage.prefs();
    assert.equal(p.theme, 'system', 'an object is dropped rather than stringified, and the default stands in');
    assert.equal(p.quiet, true);
    assert.equal(p.crossfade, 15);
    assert.equal(p.visuals, 'off');
    assert.deepEqual(p.queue, ['keep'], 'an id list keeps only the ids, and only ones the library could hold');
    assert.equal(p.queueEvery, 0, 'a number stored as a string is not one of the options');
    assert.equal(p.probe, undefined, 'a field this app does not know is not carried');
    assert.deepEqual(Object.keys(p).sort(), Object.keys(AN.storage.PREF_DEFAULTS).sort(), 'and every field is present');
  });
});

// The whitelist is an own-property lookup. 'constructor', '__proto__' and 'toString' are
// truthy on every plain table, so `key in TABLE` or `TABLE[key] !== undefined` would let
// each of them through as a theme. JSON.parse rather than a literal, because a literal
// {__proto__: ...} sets the prototype while parsed JSON makes an own key — the case a
// stored record actually presents.
test('no name inherited from Object.prototype is a valid preference value or field', () => {
  const D = AN.storage.PREF_DEFAULTS;
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const q = JSON.stringify(name);
    const hostile = JSON.parse(`{"theme":${q},"visuals":${q},"quiet":${q},"queue":${q},"queueEvery":${q},"crossfade":${q}}`);
    assert.deepEqual(AN.storage.cleanPrefs(hostile, D), D, `${name} is not a valid value for any field`);
    const keyed = JSON.parse(`{${q}:true,"theme":"dark"}`);
    const out = AN.storage.cleanPrefs(keyed, D);
    assert.deepEqual(out, Object.assign({}, D, { theme: 'dark' }), `${name} as a field name is dropped and poisons nothing`);
    assert.equal(Object.getPrototypeOf(out), Object.prototype);
    withStorage(undefined, () => {
      globalThis.localStorage.setItem(AN.storage.KEYS.prefs, `{"theme":${q}}`);
      assert.equal(AN.storage.prefs().theme, 'system', `${name} never reaches the theme select`);
    });
  }
});

// The defaults and every value the selects offer survive the validator unchanged —
// otherwise a real choice is quietly replaced by the default on the next load. The
// values are spelled out rather than read from the tables: a member dropped from a
// table would drop out of the loop too, and the test would excuse it.
test('the defaults and every enum value round-trip through cleanPrefs', () => {
  const S = AN.storage, D = S.PREF_DEFAULTS;
  assert.deepEqual(S.cleanPrefs(D, D), D);
  assert.deepEqual(S.cleanPrefs({}, D), D, 'an empty record is the defaults');
  assert.deepEqual(S.cleanPrefs(null, D), D);
  assert.deepEqual(S.cleanPrefs(['not', 'a', 'record'], D), D);
  for (const theme of ['system', 'dark', 'light', 'black']) assert.equal(S.cleanPrefs({ theme }, D).theme, theme);
  for (const visuals of ['on', 'off']) assert.equal(S.cleanPrefs({ visuals }, D).visuals, visuals);
  for (const queueEvery of [0, 10, 20, 30, 45, 60]) assert.equal(S.cleanPrefs({ queueEvery }, D).queueEvery, queueEvery);
  for (const crossfade of [4, 8, 15, 30]) assert.equal(S.cleanPrefs({ crossfade }, D).crossfade, crossfade);
  for (const quiet of [true, false]) assert.equal(S.cleanPrefs({ quiet }, D).quiet, quiet);
  assert.deepEqual(S.cleanPrefs({ queue: ['a', 'b'] }, D).queue, ['a', 'b']);
  assert.notEqual(S.cleanPrefs({}, D).queue, D.queue, 'the default list is copied, not shared');
  // and a wrong type is the default, not a coercion of the wrong value
  assert.equal(S.cleanPrefs({ quiet: 'yes' }, D).quiet, false);
  assert.equal(S.cleanPrefs({ crossfade: 9 }, D).crossfade, 8, 'a number the select does not offer is not shown as one');
  assert.equal(S.cleanPrefs({ theme: 'DARK' }, D).theme, 'system');
});

// The queue is a list written from outside too, and a record that repeats one real id
// is not bounded by dropping ids the library lacks: twenty thousand copies of a saved
// mix's id all survived that, and renderQueue() paid a library read per copy. The app's
// own enqueue() refuses a duplicate, so a dedupe eats nothing the visitor built, and a
// queue cannot name more distinct mixes than the library can hold.
test('a stored queue is deduplicated and capped at the library ceiling where it is read', () => {
  const S = AN.storage, D = S.PREF_DEFAULTS;
  const copies = Array.from({ length: 20000 }, () => 'a');
  assert.deepEqual(S.cleanPrefs({ queue: copies }, D).queue, ['a'], 'one id, however many times it is stored, is one entry');
  const many = Array.from({ length: S.MAX_MIXES + 1 }, (_, i) => `id${i}`);
  const kept = S.cleanPrefs({ queue: many }, D).queue;
  assert.equal(kept.length, S.MAX_MIXES, 'no more entries than the library can hold distinct mixes');
  assert.deepEqual(kept, many.slice(0, S.MAX_MIXES), 'the first ones, in order');
  assert.deepEqual(S.cleanPrefs({ queue: ['b', 'a', 'b', 'c', 'a'] }, D).queue, ['b', 'a', 'c'], 'order is kept at the first occurrence');
  withStorage(undefined, () => {
    globalThis.localStorage.setItem(S.KEYS.prefs, JSON.stringify({ queue: copies }));
    assert.deepEqual(S.prefs().queue, ['a'], 'and prefs() reads through the same bound');
  });
});

// Reset is the preferences only. The queue lives in the same record but is a list of the
// visitor's own mixes, not a preference; the library and the working mix are other
// records, and neither is Reset's to touch.
test('resetPrefs restores the defaults, keeps the queue and touches no other record', () => {
  withStorage([plainMix(1), plainMix(2)], (store) => {
    const S = AN.storage;
    S.autosave({ seed: 'in-progress', style: 'lofi' });
    assert.ok(S.setPref('theme', 'black'));
    assert.ok(S.setPref('quiet', true));
    assert.ok(S.setPref('crossfade', 30));
    assert.ok(S.setPref('queue', ['x1', 'x2']));
    assert.ok(S.setPref('probe', 'unknown field'), 'an unknown field is accepted by the writer');
    assert.ok(!JSON.parse(store.get(S.KEYS.prefs)).probe, 'and not stored');
    const mixesBefore = store.get(S.KEYS.mixes), autoBefore = store.get(S.KEYS.autosave);

    assert.ok(S.resetPrefs());
    const p = S.prefs();
    assert.deepEqual(p, Object.assign({}, S.PREF_DEFAULTS, { queue: ['x1', 'x2'] }));
    assert.equal(store.get(S.KEYS.mixes), mixesBefore, 'the library is untouched');
    assert.equal(store.get(S.KEYS.autosave), autoBefore, 'and so is the working mix');
    assert.equal(S.loadAutosave().seed, 'in-progress');
  });
});
