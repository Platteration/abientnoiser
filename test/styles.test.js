const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/prng.js');
require('../js/theory.js');
require('../js/composer.js');
require('../js/audio/drums.js');
require('../js/audio/ambience.js');
const AN = globalThis.AN;

const INSTRUMENTS = ['bell', 'ep', 'piano', 'pluck'];
const KITS = ['lofi', 'brush', 'electro'];
const BASS = ['sustain', 'pattern', 'walk'];

test('every ambience layer has a texture, and every texture is in the mixer', () => {
  const layers = AN.AMBIENCE_LAYERS.map((l) => l.id).sort();
  const classes = Object.keys(AN.ambience.classes).sort();
  assert.deepEqual(classes, layers);
});

test('every style declares instruments, a bass style and a valid kit', () => {
  for (const id of Object.keys(AN.STYLES)) {
    const st = AN.STYLES[id];
    assert.ok(st.name && st.desc && st.icon, `${id} needs name, desc and icon`);
    assert.ok(INSTRUMENTS.includes(st.melodyInstr), `${id} melody instrument`);
    assert.ok(st.chordInstr === 'pad' || INSTRUMENTS.includes(st.chordInstr), `${id} chord instrument`);
    assert.ok(INSTRUMENTS.includes(st.arpInstr), `${id} arp instrument`);
    assert.ok(BASS.includes(st.bass), `${id} bass style`);
    assert.ok(st.kit === null || KITS.includes(st.kit), `${id} kit`);
    assert.ok(st.tempo[0] < st.tempo[1] && st.tempo[0] > 30, `${id} tempo range`);
    assert.ok(st.progressions.length >= 4, `${id} needs several progressions`);
    for (const p of st.progressions) for (const d of p) assert.ok(d >= 0 && d <= 6, `${id} degree ${d} out of range`);
    for (const m of st.modes) assert.ok(AN.theory.MODES[m], `${id} mode ${m}`);
  }
});

test('drum kits expose a step function for every kit a style uses', () => {
  for (const id of Object.keys(AN.STYLES)) {
    const kit = AN.STYLES[id].kit;
    if (!kit) continue;
    const fn = { lofi: 'lofiStep', brush: 'brushStep', electro: 'electroStep' }[kit];
    assert.equal(typeof AN.drums[fn], 'function', `${id} uses kit ${kit}`);
  }
});

test('sections carry the style fields the engine dispatches on', () => {
  for (const id of Object.keys(AN.STYLES)) {
    const plan = AN.compose({ seed: 'fields', style: id, durationMin: 40, sectionMin: 4 });
    for (const s of plan.sections) {
      assert.ok(INSTRUMENTS.includes(s.melodyInstr) && INSTRUMENTS.includes(s.arpInstr), `${id} instruments`);
      assert.ok(BASS.includes(s.bassStyle), `${id} bass style on section`);
      assert.equal(s.kit, AN.STYLES[id].kit || null);
      for (const l of AN.AMBIENCE_LAYERS) {
        assert.ok(Number.isFinite(s.ambience[l.id]) && s.ambience[l.id] >= 0, `${id} ambience weight for ${l.id}`);
      }
    }
  }
});

test('movement names are unique within a plan', () => {
  for (const style of Object.keys(AN.STYLES)) {
    for (const seed of ['one', 'two', 'three']) {
      const plan = AN.compose({ seed, style, durationMin: 120, sectionMin: 2 });
      const names = plan.sections.map((s) => s.name);
      assert.equal(new Set(names).size, names.length, `${style}/${seed} repeats a movement name`);
    }
  }
});

test('swing is a ratio where 0.5 is straight, never below', () => {
  for (const id of Object.keys(AN.STYLES)) {
    const [lo, hi] = AN.STYLES[id].swing;
    assert.ok(lo >= 0.5 && hi >= lo && hi <= 0.8, `${id} declares swing ${lo}-${hi}; 0.5 is straight`);
    // below 0.5 an odd sixteenth would be pulled earlier than the beat before it
    const plan = AN.compose({ seed: 'swing', style: id, durationMin: 30, sectionMin: 3 });
    for (const s of plan.sections) {
      assert.ok(s.swing >= 0.5 && s.swing <= 0.8, `${id} section swing ${s.swing}`);
      const stepLen = 60 / s.tempo / 4;
      const shift = (s.swing - 0.5) * 2 * stepLen;
      assert.ok(shift >= 0 && shift < stepLen, `${id} shifts an odd sixteenth by ${shift}s of a ${stepLen}s step`);
    }
  }
});
