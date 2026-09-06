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

  D.kick = function (graph, layer, { t, vel = 0.9 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
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

  /** Schedule the drum hits of one 16th step. */
  D.step = function (graph, layer, { t, stepLen, section, sixteenth, bar, rng, swing }) {
    const pat = section.drumPattern;
    if (pat === 'off') return;
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
      D.kick(graph, layer, { t: time, vel: 0.85 + rng.float(-0.08, 0.1) });
    } else if (pat === 'full' && (sixteenth === 14 || sixteenth === 11) && rng.bool(0.12 * dens)) {
      D.kick(graph, layer, { t: time, vel: 0.6 });
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

  AN.drums = D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
