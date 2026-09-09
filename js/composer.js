/* The composer: turns (seed, style, duration) into a deterministic plan — a
 * sequence of "mood" sections, each with its own key, mode, tempo, chord
 * progression, layer balance and ambience weighting. The audio engine then
 * performs the plan; because everything is seeded, the piece loops exactly. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const T = AN.theory;

  // ---------- layers (what the mixer shows) ----------
  AN.MUSIC_LAYERS = [
    { id: 'pads',   name: 'Pads & chords' },
    { id: 'melody', name: 'Melody' },
    { id: 'arp',    name: 'Arpeggio' },
    { id: 'bass',   name: 'Bass' },
    { id: 'drums',  name: 'Drums' },
  ];
  AN.AMBIENCE_LAYERS = [
    { id: 'rain',     name: 'Rain' },
    { id: 'thunder',  name: 'Thunder' },
    { id: 'wind',     name: 'Wind' },
    { id: 'waves',    name: 'Ocean waves' },
    { id: 'creek',    name: 'Creek' },
    { id: 'fire',     name: 'Fireplace' },
    { id: 'birds',    name: 'Birds' },
    { id: 'crickets', name: 'Night crickets' },
    { id: 'chimes',   name: 'Wind chimes' },
    { id: 'cafe',     name: 'Café murmur' },
    { id: 'train',    name: 'Night train' },
    { id: 'vinyl',    name: 'Vinyl crackle' },
  ];

  // ---------- styles ----------
  AN.STYLES = {
    ambient: {
      name: 'Ambient Drift', icon: '🌫️',
      desc: 'Slow evolving pads, soft bells, no beat.',
      tempo: [56, 68], chordBars: 2, chordSizes: [3, 4], center: 64,
      melodyInstr: 'bell', chordInstr: 'pad', arpInstr: 'pluck', bass: 'sustain', kit: null,
      lofi: false, swing: [0.5, 0.5],
      modes: ['major', 'lydian', 'dorian', 'minor', 'mixolydian'],
      progressions: [[0, 5, 3, 4], [0, 3], [0, 5], [0, 2, 3, 5], [0, 1], [0, 6, 3, 5], [3, 0, 4, 5], [0, 4, 5, 3], [5, 3, 0, 4]],
      music: { pads: 1, melody: 0.55, arp: 0, bass: 0.5, drums: 0 },
      ambience: { rain: 0.35, thunder: 0, wind: 0.25, waves: 0, fire: 0, birds: 0, crickets: 0, vinyl: 0 },
      drone: 0.7,
    },
    lofi: {
      name: 'Lo-fi Hip Hop', icon: '📻',
      desc: 'Dusty drums, jazzy electric piano, warm bass, vinyl crackle.',
      tempo: [70, 88], chordBars: 1, chordSizes: [4], center: 67,
      melodyInstr: 'ep', chordInstr: 'ep', arpInstr: 'pluck', bass: 'pattern', kit: 'lofi', comp: true,
      lofi: true, swing: [0.54, 0.62],
      modes: ['major', 'dorian', 'minor', 'mixolydian'],
      progressions: [[1, 4, 0, 5], [0, 3], [5, 1, 4, 0], [2, 5, 1, 4], [0, 2, 3, 3], [3, 4, 2, 5], [0, 5, 1, 4], [5, 3, 0, 4], [0, 3, 1, 4]],
      music: { pads: 0.9, melody: 0.6, arp: 0, bass: 1, drums: 1 },
      ambience: { rain: 0.3, thunder: 0, wind: 0, waves: 0, fire: 0, birds: 0, crickets: 0, vinyl: 0.6 },
      drone: 0,
    },
    focus: {
      name: 'Deep Focus', icon: '🎯',
      desc: 'Steady arpeggios over soft pads. Even, unobtrusive, made for work.',
      tempo: [84, 100], chordBars: 2, chordSizes: [3, 4], center: 66,
      melodyInstr: 'pluck', chordInstr: 'pad', arpInstr: 'pluck', bass: 'sustain', kit: null,
      lofi: false, swing: [0.5, 0.5],
      modes: ['major', 'lydian', 'dorian', 'mixolydian'],
      progressions: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3], [5, 3, 0, 4], [0, 2, 5, 3], [0, 1, 0, 3]],
      music: { pads: 0.85, melody: 0.3, arp: 1, bass: 0.6, drums: 0 },
      ambience: { rain: 0.2, thunder: 0, wind: 0.1, waves: 0, fire: 0, birds: 0, crickets: 0, vinyl: 0 },
      drone: 0.4,
    },
    space: {
      name: 'Deep Space', icon: '🪐',
      desc: 'Vast drones, glassy tones, a very slow pulse of harmony.',
      tempo: [48, 58], chordBars: 4, chordSizes: [3], center: 60,
      melodyInstr: 'bell', chordInstr: 'pad', arpInstr: 'bell', bass: 'sustain', kit: null,
      lofi: false, swing: [0.5, 0.5],
      modes: ['lydian', 'minor', 'dorian', 'phrygian'],
      progressions: [[0, 3], [0, 6], [0, 1], [0, 5, 3], [0, 4], [0, 2]],
      music: { pads: 1, melody: 0.35, arp: 0, bass: 0.3, drums: 0 },
      ambience: { rain: 0, thunder: 0, wind: 0.4, waves: 0, fire: 0, birds: 0, crickets: 0, vinyl: 0 },
      drone: 1,
    },
    night: {
      name: 'Rainy Night', icon: '🌧️',
      desc: 'Soft electric piano and pads under steady rain and distant thunder.',
      tempo: [60, 72], chordBars: 2, chordSizes: [4], center: 64,
      melodyInstr: 'ep', chordInstr: 'pad', arpInstr: 'pluck', bass: 'sustain', kit: null,
      lofi: false, swing: [0.5, 0.5],
      modes: ['minor', 'dorian', 'major'],
      progressions: [[0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4], [0, 6], [1, 4, 0, 0], [0, 2, 3, 4]],
      music: { pads: 1, melody: 0.55, arp: 0.35, bass: 0.6, drums: 0 },
      ambience: { rain: 0.8, thunder: 0.3, wind: 0, waves: 0, fire: 0, birds: 0, crickets: 0.2, vinyl: 0 },
      drone: 0.5,
    },
    nocturne: {
      name: 'Piano Nocturne', icon: '🎹',
      desc: 'Sparse piano over held strings. Slow, roomy and late.',
      tempo: [52, 64], chordBars: 2, chordSizes: [3, 4], center: 65,
      melodyInstr: 'piano', chordInstr: 'pad', arpInstr: 'piano', bass: 'sustain', kit: null,
      lofi: false, swing: [0.5, 0.5],
      modes: ['minor', 'dorian', 'major', 'lydian'],
      progressions: [[0, 5, 3, 4], [0, 3, 4, 5], [5, 3, 0, 4], [0, 2, 5, 3], [1, 4, 0, 5], [0, 4, 5, 3]],
      music: { pads: 0.6, melody: 0.9, arp: 0.45, bass: 0.5, drums: 0 },
      ambience: { rain: 0.35, thunder: 0, wind: 0, waves: 0, creek: 0, fire: 0.25, birds: 0, crickets: 0, chimes: 0, cafe: 0, train: 0, vinyl: 0.12 },
      drone: 0.3,
    },
    synthwave: {
      name: 'Cassette Synthwave', icon: '📼',
      desc: 'Warm analog pads, sub bass and a slow electronic pulse.',
      tempo: [84, 98], chordBars: 2, chordSizes: [3, 4], center: 67,
      melodyInstr: 'pluck', chordInstr: 'pad', arpInstr: 'pluck', bass: 'pattern', kit: 'electro',
      lofi: true, swing: [0.5, 0.5],
      modes: ['minor', 'dorian', 'lydian', 'major'],
      progressions: [[5, 3, 0, 4], [0, 5, 3, 4], [3, 4, 5, 0], [0, 6, 5, 4], [5, 0, 3, 4], [0, 4, 5, 5]],
      music: { pads: 1, melody: 0.5, arp: 0.85, bass: 0.9, drums: 0.8 },
      ambience: { rain: 0.15, thunder: 0, wind: 0.15, waves: 0, creek: 0, fire: 0, birds: 0, crickets: 0, chimes: 0, cafe: 0, train: 0, vinyl: 0.35 },
      drone: 0.4,
    },
    jazz: {
      name: 'Late Jazz Trio', icon: '🎷',
      desc: 'Brushed drums, walking bass and quiet piano comping.',
      tempo: [96, 124], chordBars: 1, chordSizes: [4], center: 67,
      melodyInstr: 'piano', chordInstr: 'piano', arpInstr: 'piano', bass: 'walk', kit: 'brush', comp: true,
      lofi: false, swing: [0.62, 0.68],
      modes: ['dorian', 'major', 'mixolydian', 'minor'],
      progressions: [[1, 4, 0, 0], [1, 4, 0, 5], [2, 5, 1, 4], [0, 5, 1, 4], [3, 6, 2, 5], [0, 3, 1, 4]],
      music: { pads: 0.4, melody: 0.7, arp: 0, bass: 1, drums: 0.9 },
      ambience: { rain: 0.15, thunder: 0, wind: 0, waves: 0, creek: 0, fire: 0, birds: 0, crickets: 0, chimes: 0, cafe: 0.3, train: 0, vinyl: 0.3 },
      drone: 0,
    },
  };

  // ---------- moods ----------
  // intensity drives layer levels and density; modeBias colours the harmony.
  AN.MOODS = {
    still:   { intensity: 0.15, brightness: 0.25, density: 0.18, melody: 0.2, drums: 0.0, bass: 0.4, pads: 1.0, arp: 0.25, tempoDelta: -4, registerDelta: 0,
               modeBias: ['major', 'dorian', 'lydian'], hue: 200,
               words: [['Still', 'Quiet', 'Hushed', 'Pale', 'Slow'], ['Water', 'Hour', 'Room', 'Light', 'Morning', 'Breath']] },
    drift:   { intensity: 0.35, brightness: 0.4, density: 0.35, melody: 0.45, drums: 0.55, bass: 0.7, pads: 1.0, arp: 0.5, tempoDelta: -2, registerDelta: 0,
               modeBias: ['dorian', 'major', 'mixolydian'], hue: 180,
               words: [['Drifting', 'Floating', 'Wandering', 'Low', 'Grey'], ['Tide', 'Clouds', 'Fog', 'Current', 'Haze', 'Shore']] },
    warm:    { intensity: 0.55, brightness: 0.55, density: 0.5, melody: 0.6, drums: 1.0, bass: 1.0, pads: 0.9, arp: 0.7, tempoDelta: 0, registerDelta: 0,
               modeBias: ['major', 'mixolydian', 'lydian'], hue: 35,
               words: [['Warm', 'Golden', 'Soft', 'Amber', 'Late'], ['Afternoon', 'Window', 'Kitchen', 'Sun', 'Lamp', 'Ember']] },
    lift:    { intensity: 0.8, brightness: 0.75, density: 0.7, melody: 0.8, drums: 1.0, bass: 1.0, pads: 0.85, arp: 1.0, tempoDelta: 3, registerDelta: 2,
               modeBias: ['lydian', 'major'], hue: 60,
               words: [['Rising', 'Open', 'Bright', 'High', 'Clear'], ['Sky', 'Field', 'Air', 'Horizon', 'Noon', 'Wings']] },
    tension: { intensity: 0.7, brightness: 0.45, density: 0.6, melody: 0.5, drums: 1.0, bass: 1.0, pads: 1.0, arp: 0.8, tempoDelta: 1, registerDelta: -2,
               modeBias: ['minor', 'phrygian', 'dorian'], hue: 290,
               words: [['Restless', 'Dark', 'Distant', 'Cold', 'Heavy'], ['Storm', 'Weather', 'Static', 'Signal', 'Undertow', 'Glass']] },
    release: { intensity: 0.45, brightness: 0.6, density: 0.4, melody: 0.7, drums: 0.8, bass: 0.8, pads: 1.0, arp: 0.5, tempoDelta: -1, registerDelta: 0,
               modeBias: ['major', 'dorian'], hue: 150,
               words: [['Letting', 'After', 'Easy', 'Gentle', 'Settling'], ['Go', 'Rain', 'Silence', 'Dusk', 'Ground', 'Return']] },
    deep:    { intensity: 0.3, brightness: 0.2, density: 0.3, melody: 0.25, drums: 0.6, bass: 1.0, pads: 0.9, arp: 0.3, tempoDelta: -3, registerDelta: -5,
               modeBias: ['minor', 'dorian'], hue: 230,
               words: [['Deep', 'Sunken', 'Below', 'Night', 'Blue'], ['Water', 'Harbour', 'Roots', 'Cellar', 'Well', 'Depth']] },
    glow:    { intensity: 0.6, brightness: 0.9, density: 0.45, melody: 0.65, drums: 0.9, bass: 0.7, pads: 0.8, arp: 0.9, tempoDelta: 0, registerDelta: 5,
               modeBias: ['lydian', 'major'], hue: 15,
               words: [['Glowing', 'Neon', 'Faded', 'Evening', 'Small'], ['Streetlight', 'Screen', 'Coals', 'Stars', 'Lantern', 'Postcard']] },
  };

  /** Optional time-of-day colouring. Resolved to a fixed name before composing,
   *  so a plan stays deterministic and shareable. */
  AN.DAYPARTS = {
    morning:   { label: 'Morning',   moodBias: ['still', 'drift', 'lift', 'warm'],      arc: -0.04, brightness: 0.15,  tempo: 1,
                 ambience: { birds: 1.7, crickets: 0.15, rain: 0.9, chimes: 1.2, fire: 0.6 } },
    afternoon: { label: 'Afternoon', moodBias: ['warm', 'lift', 'glow', 'drift'],        arc: 0.08,  brightness: 0.1,   tempo: 2,
                 ambience: { birds: 1.2, cafe: 1.3, crickets: 0.25, fire: 0.6 } },
    evening:   { label: 'Evening',   moodBias: ['glow', 'warm', 'release', 'drift'],     arc: 0,     brightness: -0.05, tempo: 0,
                 ambience: { crickets: 1.2, fire: 1.4, birds: 0.35, cafe: 1.1 } },
    night:     { label: 'Night',     moodBias: ['still', 'deep', 'drift', 'release'],    arc: -0.16, brightness: -0.2,  tempo: -3,
                 ambience: { crickets: 1.5, rain: 1.15, birds: 0.05, train: 1.3, fire: 1.2, chimes: 0.7 } },
  };

  AN.daypartAt = function (date) {
    const h = (date || new Date()).getHours();
    return h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  };

  const SEED_WORDS = [
    ['amber', 'blue', 'cedar', 'dusk', 'ember', 'fern', 'glass', 'harbour', 'ivory', 'jade', 'kite', 'lunar', 'moss', 'north', 'ochre', 'pale', 'quiet', 'river', 'slate', 'tidal', 'umber', 'velvet', 'willow', 'zephyr'],
    ['rain', 'lamp', 'window', 'tape', 'cloud', 'signal', 'shore', 'attic', 'garden', 'static', 'orbit', 'harbor', 'lantern', 'meadow', 'monsoon', 'tide', 'ember', 'canyon', 'radio', 'sleeper'],
  ];

  AN.randomSeed = function () {
    const r = Math.random;
    const w = (list) => list[Math.floor(r() * list.length)];
    return `${w(SEED_WORDS[0])}-${w(SEED_WORDS[1])}-${Math.floor(r() * 900 + 100)}`;
  };

  AN.defaultSettings = function (styleId = 'ambient') {
    const style = AN.STYLES[styleId] || AN.STYLES.ambient;
    return {
      seed: AN.randomSeed(),
      style: style === AN.STYLES[styleId] ? styleId : 'ambient',
      durationMin: 60,
      sectionMin: 4,
      levels: Object.assign({}, style.music, style.ambience),
      volume: 0.8,
      tone: 1,
    };
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function pickMode(rng, mood, style, prevMode) {
    if (prevMode && rng.bool(0.55)) return prevMode;
    const shared = mood.modeBias.filter((m) => style.modes.includes(m));
    const pool = shared.length ? shared : style.modes;
    return rng.pick(pool);
  }

  /** A two-word name for a movement, avoiding names already used in this plan. */
  function moodName(rng, mood, used) {
    let name = '';
    for (let k = 0; k < 12; k++) {
      name = `${rng.pick(mood.words[0])} ${rng.pick(mood.words[1])}`;
      if (!used || !used.has(name)) break;
    }
    if (used) used.add(name);
    return name;
  }

  /**
   * Compose a plan.
   * @param {object} settings { seed, style, durationMin, sectionMin }
   * @returns plan { seed, style, duration, sections[], keyRoot }
   */
  AN.compose = function (settings) {
    const styleId = AN.STYLES[settings.style] ? settings.style : 'ambient';
    const style = AN.STYLES[styleId];
    const seed = String(settings.seed || 'default');
    const duration = clamp(Number(settings.durationMin) || 60, 5, 240) * 60;
    const sectionLen = clamp(Number(settings.sectionMin) || 4, 1, 15) * 60;
    const wanted = settings.daypart === 'auto' ? AN.daypartAt(new Date()) : settings.daypart;
    const daypart = AN.DAYPARTS[wanted] ? wanted : null;
    const dp = daypart ? AN.DAYPARTS[daypart] : null;
    const rng = AN.rng(seed, styleId, daypart || '-', 'plan');

    const edits = (settings.edits && typeof settings.edits === 'object') ? settings.edits : {};
    const editFor = (i) => edits[i] || edits[String(i)] || null;

    // --- section boundaries: roughly sectionLen each, varied ±25%, summing to duration
    const n = Math.max(2, Math.round(duration / sectionLen));
    const weights = [];
    for (let i = 0; i < n; i++) weights.push(rng.float(0.75, 1.25));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const lengths = weights.map((w) => (w / wsum) * duration);

    // a movement given an explicit length keeps it; the rest share what is left
    const MIN_LEN = 30;
    const pinned = lengths.map((_, i) => {
      const e = editFor(i);
      return e && e.minutes ? clamp(Number(e.minutes) * 60, MIN_LEN, duration) : null;
    });
    if (pinned.some((p) => p !== null)) {
      let pinnedSum = 0, freeSum = 0;
      pinned.forEach((p, i) => { if (p === null) freeSum += lengths[i]; else pinnedSum += p; });
      const freeRoom = duration - pinnedSum;
      const freeCount = pinned.filter((p) => p === null).length;
      if (freeCount === 0 || freeRoom < freeCount * MIN_LEN) {
        // the pinned movements do not leave room: scale everything to fit
        const all = pinned.map((p, i) => (p === null ? lengths[i] : p));
        const total = all.reduce((a, b) => a + b, 0);
        all.forEach((v, i) => { lengths[i] = (v / total) * duration; });
      } else {
        const scale = freeRoom / freeSum;
        pinned.forEach((p, i) => { lengths[i] = p === null ? lengths[i] * scale : p; });
      }
    }

    const bounds = [0];
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += lengths[i]; bounds.push(i === n - 1 ? duration : Math.round(acc)); }

    // --- global musical identity
    const keyRootBase = rng.int(0, 11);
    const tempoBase = rng.int(style.tempo[0], style.tempo[1]);
    // 0.5 is straight; anything above delays the odd sixteenths. Guard against a
    // style declaring 0 for "no swing", which would pull them a whole step early.
    const swing = clamp(rng.float(style.swing[0], style.swing[1]), 0.5, 0.8);
    const peaks = n >= 9 ? rng.weighted([[1, 2], [2, 1]]) : 1;

    // --- assign moods along an intensity arc (low at both ends so the loop seam is calm)
    const moodIds = Object.keys(AN.MOODS);
    const usedNames = new Set();
    const sections = [];
    let prev = null;
    for (let i = 0; i < n; i++) {
      const phase = n === 1 ? 0.5 : i / (n - 1);
      const arc = 0.22 + 0.55 * Math.abs(Math.sin(Math.PI * peaks * phase));
      const target = clamp(arc + (dp ? dp.arc : 0) + rng.gauss(0, 0.12), 0.1, 0.9);

      let moodId;
      if (prev && prev.moodId === 'tension' && rng.bool(0.7)) moodId = 'release';
      else {
        const ranked = moodIds
          .filter((id) => !prev || id !== prev.moodId)
          .map((id) => [id, Math.abs(AN.MOODS[id].intensity - target) - (dp && dp.moodBias.includes(id) ? 0.12 : 0)])
          .sort((a, b) => a[1] - b[1]);
        moodId = rng.weighted([[ranked[0][0], 5], [ranked[1][0], 3], [ranked[2][0], 1]]);
      }
      const edit = editFor(i);
      if (edit && AN.MOODS[edit.mood]) moodId = edit.mood;
      const mood = AN.MOODS[moodId];
      const srng = AN.rng(seed, styleId, 'section', i);

      // key: mostly stay, sometimes modulate to a related key
      let keyRoot = prev ? prev.keyRoot : keyRootBase;
      if (prev && srng.bool(0.35)) keyRoot = (keyRoot + srng.pick([5, 7, 9, 2, 3, 10])) % 12;
      let mode = pickMode(srng, mood, style, prev && prev.mode);
      if (edit && Number.isInteger(edit.keyRoot)) keyRoot = ((edit.keyRoot % 12) + 12) % 12;
      if (edit && AN.theory.MODES[edit.mode]) mode = edit.mode;

      const tempo = clamp(tempoBase + mood.tempoDelta + (dp ? dp.tempo : 0) + srng.int(-1, 1), style.tempo[0] - 8, style.tempo[1] + 8);
      const intensity = clamp(mood.intensity + srng.gauss(0, 0.05), 0.05, 1);
      const brightness = clamp(mood.brightness + (dp ? dp.brightness : 0) + srng.gauss(0, 0.08), 0.05, 1);
      const progression = srng.pick(style.progressions);
      const chordSize = srng.pick(style.chordSizes);
      const drumLevel = mood.drums;
      const drumPattern = drumLevel <= 0.01 ? 'off' : drumLevel < 0.65 ? 'sparse' : drumLevel < 0.95 ? 'light' : 'full';

      const start = bounds[i], end = bounds[i + 1];
      sections.push({
        index: i, start, end, length: end - start,
        moodId, name: moodName(srng, mood, usedNames), hue: mood.hue,
        edited: !!edit,
        intensity, brightness, density: clamp(mood.density + srng.gauss(0, 0.05), 0.05, 1),
        keyRoot, keyName: T.keyName(keyRoot), mode, tempo, swing,
        chordBars: style.chordBars, chordSize, progression,
        chordNames: progression.map((d) => T.chordName(keyRoot, mode, d, chordSize)),
        center: style.center + mood.registerDelta,
        melodyInstr: style.melodyInstr, chordInstr: style.chordInstr, arpInstr: style.arpInstr || 'pluck',
        bassStyle: style.bass || 'sustain', kit: style.kit || null, comp: !!style.comp,
        drumPattern, drumVariant: srng.int(0, 3), bassPattern: srng.int(0, 3), arpPattern: srng.int(0, 2),
        // per-section multipliers for the music layers (user mixer multiplies these)
        music: {
          pads: mood.pads,
          melody: mood.melody,
          arp: mood.arp,
          bass: mood.bass,
          drums: drumLevel,
          drone: style.drone * (0.6 + 0.6 * (1 - intensity)),
        },
        // per-section multipliers for the ambience textures
        ambience: {
          rain: clamp(0.55 + 0.7 * intensity + (moodId === 'tension' ? 0.35 : 0) + srng.gauss(0, 0.08), 0.3, 1.6),
          thunder: moodId === 'tension' ? 1.6 : moodId === 'deep' ? 0.9 : 0.45,
          wind: clamp(0.5 + 0.8 * intensity + srng.gauss(0, 0.1), 0.3, 1.5),
          waves: clamp(0.7 + 0.5 * intensity, 0.5, 1.3),
          fire: clamp(0.7 + 0.5 * (1 - intensity) + srng.gauss(0, 0.05), 0.5, 1.3),
          birds: (moodId === 'lift' || moodId === 'glow' || moodId === 'warm') ? 1.3 : (moodId === 'deep' || moodId === 'tension') ? 0.35 : 0.8,
          crickets: (moodId === 'still' || moodId === 'deep' || moodId === 'drift') ? 1.2 : 0.7,
          creek: clamp(0.7 + 0.5 * intensity, 0.5, 1.3),
          chimes: (moodId === 'lift' || moodId === 'glow') ? 1.5 : (moodId === 'tension' || moodId === 'deep') ? 0.45 : 1,
          cafe: clamp(0.75 + 0.5 * intensity, 0.6, 1.3),
          train: 1,
          vinyl: 1,
        },
      });
      if (dp) {
        const amb = sections[i].ambience;
        for (const id in dp.ambience) if (amb[id] != null) amb[id] *= dp.ambience[id];
      }
      prev = sections[i];
    }

    return {
      seed, style: styleId, styleName: style.name, duration, sections,
      keyRoot: keyRootBase, tempo: tempoBase, lofi: style.lofi,
      daypart, daypartName: dp ? dp.label : null,
      editCount: sections.filter((s) => s.edited).length,
    };
  };

  /** Section containing piece time p (seconds, wrapped into [0, duration)). */
  AN.sectionAt = function (plan, p) {
    const d = plan.duration;
    p = ((p % d) + d) % d;
    const s = plan.sections;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p >= s[mid].end) lo = mid + 1; else hi = mid;
    }
    return s[lo];
  };

  AN.formatTime = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
