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
