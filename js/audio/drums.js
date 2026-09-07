/* Synthesized lo-fi drum kit and 16-step patterns. */
(function (root) {
  const AN = root.AN = root.AN || {};

  const D = {};

  function out(graph, layer, pan) {
    const g = graph.ctx.createGain();
    const p = graph.panner(pan || 0);
    g.connect(p); p.connect(layer.input);
    return { g, p };
  }

  D.kick = function (graph, layer, { t, vel = 0.9, pump = 0 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    graph.pumpDuck(t, pump * vel);
    const { g, p } = out(graph, layer, 0);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    o.frequency.setTargetAtTime(42, t + 0.09, 0.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.03, 0.14);
    o.connect(g);
    o.start(t); o.stop(t + 0.7);
    graph.track(o, g, p);
  };

  D.snare = function (graph, layer, { t, vel = 0.7 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, 0.05);
    const n = graph.noiseSource('white', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.24 * vel, t + 0.003);
    ng.gain.setTargetAtTime(0, t + 0.01, 0.07);
    n.connect(bp); bp.connect(ng); ng.connect(g);
    const body = c.createOscillator(); body.type = 'triangle';
    body.frequency.setValueAtTime(230, t); body.frequency.exponentialRampToValueAtTime(150, t + 0.05);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.2 * vel, t); bg.gain.setTargetAtTime(0, t, 0.04);
    body.connect(bg); bg.connect(g);
    g.gain.value = 1;
    n.stop(t + 0.5); body.start(t); body.stop(t + 0.3);
    graph.track(body, bg);
    graph.track(n, bp, ng, g, p);
  };

  D.hat = function (graph, layer, { t, vel = 0.3, open = false }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, 0.2);
    const n = graph.noiseSource('white', t, true);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500; hp.Q.value = 0.8;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000;
    const decay = open ? 0.11 : 0.025;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.004, decay);
    n.connect(hp); hp.connect(lp); lp.connect(g);
    n.stop(t + (open ? 0.6 : 0.2));
    graph.track(n, hp, lp, g, p);
  };

  D.shaker = function (graph, layer, { t, vel = 0.25 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, -0.25);
    const n = graph.noiseSource('white', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 1.2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vel, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.012, 0.03);
    n.connect(bp); bp.connect(g);
    n.stop(t + 0.2);
    graph.track(n, bp, g, p);
  };

  D.rim = function (graph, layer, { t, vel = 0.5 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, -0.15);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1750, t);
    o.frequency.exponentialRampToValueAtTime(780, t + 0.03);
    const og = c.createGain();
    og.gain.setValueAtTime(0.5 * vel, t); og.gain.setTargetAtTime(0, t, 0.012);
    o.connect(og); og.connect(g);
    const n = graph.noiseSource('white', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 2.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.3 * vel, t); ng.gain.setTargetAtTime(0, t, 0.01);
    n.connect(bp); bp.connect(ng); ng.connect(g);
    n.stop(t + 0.15);
    g.gain.value = 1;
    o.start(t); o.stop(t + 0.2);
    graph.track(o, og);
    graph.track(n, bp, ng, g, p);
  };

  /** Wire brush swept across the head: a soft, slow noise swirl. */
  D.brush = function (graph, layer, { t, vel = 0.3, dur = 0.35, pan = -0.1 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, pan);
    const n = graph.noiseSource('pink', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.linearRampToValueAtTime(3200, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + dur * 0.45);
    g.gain.setTargetAtTime(0, t + dur * 0.55, dur / 3);
    n.connect(bp); bp.connect(g);
    n.stop(t + dur * 2.5);
    graph.track(n, bp, g, p);
  };

  /** Ride cymbal: inharmonic square partials through a highpass, long shimmer. */
  D.ride = function (graph, layer, { t, vel = 0.3, bell = false }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, 0.3);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    hp.connect(g);
    const base = bell ? 720 : 420;
    for (const r of [1, 1.41, 2.37, 4.16]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = base * r;
      const og = c.createGain(); og.gain.value = 0.055 / r;
      o.connect(og); og.connect(hp);
      o.start(t); o.stop(t + 1.2);
      graph.track(o, og);
    }
    const n = graph.noiseSource('white', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7200; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0.5;
    n.connect(bp); bp.connect(ng); ng.connect(hp);
    n.stop(t + 1.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.006, bell ? 0.28 : 0.14);
    graph.track(n, bp, ng, hp, g, p);
  };

  /** Layered hand clap. */
  D.clap = function (graph, layer, { t, vel = 0.5 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { g, p } = out(graph, layer, 0.1);
    const n = graph.noiseSource('white', t, true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.1;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    for (const off of [0, 0.011, 0.022]) {
      env.gain.setValueAtTime(0.28 * vel, t + off);
      env.gain.setTargetAtTime(0.02 * vel, t + off, 0.008);
    }
    env.gain.setValueAtTime(0.34 * vel, t + 0.032);
    env.gain.setTargetAtTime(0, t + 0.032, 0.075);
    n.connect(bp); bp.connect(env); env.connect(g);
    n.stop(t + 0.5);
    g.gain.value = 1;
    graph.track(n, bp, env, g, p);
  };

  // 16-step patterns, x = hit
  D.PATTERNS = {
    kick: {
      sparse: ['x...............', 'x.......x.......', 'x.........x.....', 'x.......x.....x.'],
      light:  ['x.......x.......', 'x..x....x.......', 'x.....x...x.....', 'x.......x..x....'],
      full:   ['x..x....x.x.....', 'x.....x.x..x....', 'x..x..x...x..x..', 'x......x..x.....'],
    },
    snare: {
      sparse: ['................', '............x...', '................', '....x...........'],
      light:  ['....x.......x...', '....x.......x...', '....x.....x.x...', '....x.......x...'],
      full:   ['....x.......x...', '....x.....x.x...', '....x..x....x...', '....x.......x..x'],
    },
    hat: {
      sparse: ['..x...x...x...x.', 'x...x...x...x...', '..x...x...x...x.', 'x.x...x.x.x...x.'],
      light:  ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.xx', 'x.x.x.x.x.x.x.x.'],
      full:   ['x.x.x.x.x.x.x.x.', 'x.xxx.x.x.x.x.xx', 'x.x.x.xxx.x.x.x.', 'xxx.x.x.x.xxx.x.'],
    },
  };

  /** Schedule the drum hits of one 16th step, for whichever kit the style uses. */
  D.step = function (graph, layer, ev) {
    if (ev.section.drumPattern === 'off') return;
    const kit = ev.section.kit || 'lofi';
    if (kit === 'brush') return D.brushStep(graph, layer, ev);
    if (kit === 'electro') return D.electroStep(graph, layer, ev);
    return D.lofiStep(graph, layer, ev);
  };

  D.lofiStep = function (graph, layer, { t, stepLen, section, sixteenth, bar, rng, swing, pump }) {
    const pat = section.drumPattern;
    const v = section.drumVariant;
    const P = D.PATTERNS;
    const kick = P.kick[pat][v], snare = P.snare[pat][v], hat = P.hat[pat][v];
    // swing: push odd 16ths late; humanise a little
    let time = t;
    if (sixteenth % 2 === 1) time += (swing - 0.5) * 2 * stepLen;
    time += rng.gauss(0, 0.004);
    const dens = section.density;
    const lastBarOfPhrase = bar % 8 === 7;

    if (kick[sixteenth] === 'x' && !(rng.bool(0.06) && sixteenth !== 0)) {
      D.kick(graph, layer, { t: time, vel: 0.85 + rng.float(-0.08, 0.1), pump });
    } else if (pat === 'full' && (sixteenth === 14 || sixteenth === 11) && rng.bool(0.12 * dens)) {
      D.kick(graph, layer, { t: time, vel: 0.6, pump });
    }

    if (snare[sixteenth] === 'x') {
      D.snare(graph, layer, { t: time, vel: 0.62 + rng.float(-0.06, 0.08) });
    } else if ((sixteenth === 7 || sixteenth === 15 || sixteenth === 10) && rng.bool(0.18 * dens) && pat !== 'sparse') {
      D.snare(graph, layer, { t: time, vel: 0.22 }); // ghost note
    }
    if (pat === 'full' && lastBarOfPhrase && sixteenth >= 12 && rng.bool(0.5)) {
      D.snare(graph, layer, { t: time, vel: 0.25 + (sixteenth - 12) * 0.08 }); // little fill
    }

    if (hat[sixteenth] === 'x' && !rng.bool(0.08)) {
      const accent = sixteenth % 4 === 2 ? 0.42 : 0.26;
      const open = pat !== 'sparse' && sixteenth === 14 && rng.bool(0.3);
      D.hat(graph, layer, { t: time, vel: accent + rng.float(-0.05, 0.05), open });
    }
    if (pat !== 'sparse' && sixteenth % 4 === 2 && rng.bool(0.35 * dens)) {
      D.shaker(graph, layer, { t: time, vel: 0.2 });
    }
  };

  /** Jazz brushes: swung ride, brush swirl on the backbeat, feathered kick. */
  D.brushStep = function (graph, layer, { t, stepLen, section, sixteenth, bar, rng, swing, pump }) {
    let time = t;
    if (sixteenth % 2 === 1) time += (swing - 0.5) * 2 * stepLen;
    time += rng.gauss(0, 0.005);
    const dens = section.density;
    const full = section.drumPattern === 'full';

    // ride: 1 . . (2) 2 . a . 3 . . . 4 . a .
    const ridePattern = full ? [0, 4, 6, 8, 12, 14] : [0, 4, 8, 12];
    if (ridePattern.includes(sixteenth) && !rng.bool(0.05)) {
      const accent = sixteenth % 8 === 0 ? 0.34 : 0.22;
      D.ride(graph, layer, { t: time, vel: accent + rng.float(-0.04, 0.05), bell: sixteenth === 0 && rng.bool(0.12) });
    }
    if (sixteenth === 0 || sixteenth === 8) {
      D.brush(graph, layer, { t: time, vel: 0.34 + rng.float(-0.05, 0.06), dur: stepLen * 3.2, pan: sixteenth === 0 ? -0.18 : 0.12 });
    }
    if ((sixteenth === 4 || sixteenth === 12) && rng.bool(0.45 + 0.3 * dens)) {
      D.rim(graph, layer, { t: time, vel: 0.3 + rng.float(-0.05, 0.08) });
    }
    if ((sixteenth === 0 || sixteenth === 8) && full) D.kick(graph, layer, { t: time, vel: 0.22 }); // feathering
    if (bar % 8 === 7 && sixteenth >= 10 && rng.bool(0.35)) {
      D.brush(graph, layer, { t: time, vel: 0.3, dur: stepLen * 1.6, pan: rng.float(-0.4, 0.4) });
    }
  };

  /** Synthwave: straight kick, clap backbeat, eighth-note hats. */
  D.electroStep = function (graph, layer, { t, section, sixteenth, bar, rng, pump }) {
    const time = t + rng.gauss(0, 0.002);
    const full = section.drumPattern === 'full';
    const light = section.drumPattern !== 'sparse';
    if (sixteenth === 0 || sixteenth === 8) D.kick(graph, layer, { t: time, vel: 0.9, pump });
    else if (full && sixteenth === 14 && rng.bool(0.4)) D.kick(graph, layer, { t: time, vel: 0.6, pump });
    if (sixteenth === 4 || sixteenth === 12) D.clap(graph, layer, { t: time, vel: 0.55 + rng.float(-0.05, 0.05) });
    if (sixteenth % (light ? 2 : 4) === 0) {
      D.hat(graph, layer, { t: time, vel: (sixteenth % 4 === 0 ? 0.2 : 0.3), open: light && sixteenth === 14 && rng.bool(0.5) });
    }
    if (full && sixteenth % 4 === 2 && rng.bool(0.4)) D.shaker(graph, layer, { t: time, vel: 0.18 });
    if (bar % 8 === 7 && sixteenth >= 12 && rng.bool(0.4)) D.clap(graph, layer, { t: time, vel: 0.25 });
  };

  AN.drums = D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
