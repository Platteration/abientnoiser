/* Synth voices. Every voice takes (graph, layer, params) and schedules itself
 * entirely with AudioParam automation at absolute time `t`. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const mtof = (m) => AN.theory.midiToFreq(m);

  function output(graph, layer, pan) {
    const out = graph.ctx.createGain();
    const p = graph.panner(pan || 0);
    out.connect(p);
    p.connect(layer.input);
    return { out, p };
  }

  const S = {};

  /** Warm detuned pad. midis: array of MIDI notes. */
  S.pad = function (graph, layer, { midis, t, dur, brightness = 0.5, level = 0.25, pan = 0, wave = 'sawtooth', rng }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, pan);
    const attack = Math.min(dur * 0.45, 2.2 + (1 - brightness) * 2.5);
    const release = Math.min(9, 3 + dur * 0.35);
    const end = t + dur + release * 2;

    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 0.8;
    const cutoff = 260 + brightness * 1900;
    filt.frequency.setValueAtTime(cutoff * 0.5, t);
    filt.frequency.linearRampToValueAtTime(cutoff, t + attack);
    filt.connect(out);

    const lfo = c.createOscillator();
    lfo.frequency.value = rng ? rng.float(0.05, 0.14) : 0.08;
    const lfoG = c.createGain(); lfoG.gain.value = cutoff * 0.35;
    lfo.connect(lfoG); lfoG.connect(filt.frequency);
    lfo.start(t); lfo.stop(end);

    const g = level / Math.sqrt(Math.max(1, midis.length));
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(g, t + attack);
    out.gain.setValueAtTime(g, t + dur);
    out.gain.setTargetAtTime(0, t + dur, release / 4);

    midis.forEach((m, i) => {
      const f = mtof(m);
      for (const d of [-7, 6]) {
        const o = c.createOscillator();
        o.type = wave;
        o.frequency.value = f;
        o.detune.value = d + i * 1.7;
        o.connect(filt);
        o.start(t); o.stop(end);
        graph.track(o);
      }
    });
    graph.track(lfo, lfoG, filt, out, p);
  };

  /** Long low drone: sub sine + soft saws through a slowly breathing filter. */
  S.drone = function (graph, layer, { midi, t, dur, brightness = 0.3, level = 0.3, rng }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, 0);
    const attack = Math.min(8, dur * 0.3), release = Math.min(10, dur * 0.4);
    const end = t + dur + release * 2;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 1.2;
    const cutoff = 140 + brightness * 500;
    filt.frequency.value = cutoff;
    filt.connect(out);
    const lfo = c.createOscillator(); lfo.frequency.value = rng ? rng.float(0.02, 0.06) : 0.04;
    const lfoG = c.createGain(); lfoG.gain.value = cutoff * 0.5;
    lfo.connect(lfoG); lfoG.connect(filt.frequency); lfo.start(t); lfo.stop(end);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(level, t + attack);
    out.gain.setValueAtTime(level, t + dur);
    out.gain.setTargetAtTime(0, t + dur, release / 4);
    const f = mtof(midi);
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f; sub.connect(out);
    sub.start(t); sub.stop(end); graph.track(sub);
    for (const d of [-9, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * 2; o.detune.value = d;
      const og = c.createGain(); og.gain.value = 0.35; o.connect(og); og.connect(filt);
      o.start(t); o.stop(end); graph.track(o, og);
    }
    graph.track(lfo, lfoG, filt, out, p);
  };

  /** Glassy bell (additive partials with independent decays). */
  S.bell = function (graph, layer, { midi, t, vel = 0.6, pan = 0 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, pan);
    const f = mtof(midi);
    const partials = [[1, 1.0, 3.2], [2.0, 0.45, 2.0], [3.01, 0.22, 1.3], [4.7, 0.1, 0.7], [6.4, 0.05, 0.4]];
    const end = t + 7;
    out.gain.value = 0.28 * vel;
    partials.forEach(([ratio, amp, decay], i) => {
      if (f * ratio > 16000) return;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.006, decay / 3);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(end);
      if (i === 0) graph.track(o, g, out, p); else graph.track(o, g);
    });
  };

  /** FM electric piano (DX-style): carrier + modulator at ratio 1, plus a tine. */
  S.ep = function (graph, layer, { midi, t, dur = 1, vel = 0.6, pan = 0 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, pan);
    const f = mtof(midi);
    const end = t + dur + 1.2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600 + vel * 2500; lp.Q.value = 0.5;
    lp.connect(out);

    const car = c.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = f;
    const modG = c.createGain();
    modG.gain.setValueAtTime(f * (1.2 + 2.2 * vel), t);
    modG.gain.setTargetAtTime(f * 0.15, t + 0.01, 0.22);
    mod.connect(modG); modG.connect(car.frequency);

    const tine = c.createOscillator(); tine.type = 'sine'; tine.frequency.value = f * 4;
    const tineG = c.createGain();
    tineG.gain.setValueAtTime(0.12 * vel, t);
    tineG.gain.setTargetAtTime(0, t, 0.12);
    tine.connect(tineG); tineG.connect(lp);

    car.connect(lp);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.3 * vel, t + 0.004);
    out.gain.setTargetAtTime(0.1 * vel, t + 0.004, 0.7);
    out.gain.setTargetAtTime(0, t + dur, 0.14);

    car.start(t); car.stop(end); mod.start(t); mod.stop(end); tine.start(t); tine.stop(t + 1);
    graph.track(mod, modG); graph.track(tine, tineG);
    graph.track(car, lp, out, p);
  };

  /** Short plucked tone with a snappy filter envelope. */
  S.pluck = function (graph, layer, { midi, t, vel = 0.5, pan = 0 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, pan);
    const f = mtof(midi);
    const end = t + 1.4;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 2.5;
    filt.frequency.setValueAtTime(Math.min(9000, 1500 + 5000 * vel), t);
    filt.frequency.setTargetAtTime(f * 1.4 + 180, t, 0.09);
    filt.connect(out);
    const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 4;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(filt); o2.connect(g2); g2.connect(filt);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.3 * vel, t + 0.003);
    out.gain.setTargetAtTime(0, t + 0.003, 0.24);
    o1.start(t); o1.stop(end); o2.start(t); o2.stop(end);
    graph.track(o2, g2);
    graph.track(o1, filt, out, p);
  };

  /** Acoustic-ish piano: inharmonic partials, hammer thump, register-dependent decay. */
  S.piano = function (graph, layer, { midi, t, dur = 1.2, vel = 0.6, pan = 0 }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, pan);
    const f = mtof(midi);
    const decay = Math.max(0.7, 5.6 - (midi - 36) * 0.055); // low strings ring longer
    const end = t + Math.min(11, dur + decay * 1.8);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(Math.min(11000, 1600 + 6500 * vel), t);
    lp.frequency.setTargetAtTime(650 + 500 * vel, t, decay * 0.5);
    lp.connect(out);

    const partials = [[1, 1, 1], [2.001, 0.4, 0.72], [3.005, 0.17, 0.52], [4.012, 0.08, 0.38], [5.02, 0.035, 0.28]];
    partials.forEach(([ratio, amp, dfac], i) => {
      if (f * ratio > 15000) return;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      o.detune.value = i * 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.005, (decay * dfac) / 3);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(end);
      if (i === 0) graph.track(o, g, lp, out, p); else graph.track(o, g);
    });

    const n = graph.noiseSource('white', t, true); // hammer
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 3); bp.Q.value = 1.1;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.18 * vel, t);
    ng.gain.setTargetAtTime(0, t, 0.011);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.stop(t + 0.18);
    graph.track(n, bp, ng);

    out.gain.setValueAtTime(0.2 * vel, t);
    out.gain.setValueAtTime(0.2 * vel, t + dur);
    out.gain.setTargetAtTime(0, t + dur, 0.3); // damper
  };

  /** Bass: sine fundamental + soft triangle octave, gentle lowpass. */
  S.bass = function (graph, layer, { midi, t, dur = 0.5, vel = 0.7, soft = false }) {
    const c = graph.ctx;
    t = Math.max(t, c.currentTime);
    const { out, p } = output(graph, layer, 0);
    const f = mtof(midi);
    const attack = soft ? Math.min(1.2, dur * 0.3) : 0.012;
    const release = soft ? Math.min(3, dur * 0.5) : 0.12;
    const end = t + dur + release * 3;
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = soft ? 260 : 420; filt.Q.value = 0.7;
    filt.connect(out);
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = soft ? 0.12 : 0.3;
    o1.connect(filt); o2.connect(g2); g2.connect(filt);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime((soft ? 0.3 : 0.2) * vel, t + attack);
    if (!soft) out.gain.setTargetAtTime(0.13 * vel, t + attack, dur * 0.6);
    out.gain.setTargetAtTime(0, t + dur, release / 3);
    o1.start(t); o1.stop(end); o2.start(t); o2.stop(end);
    graph.track(o2, g2);
    graph.track(o1, filt, out, p);
  };

  AN.synths = S;
})(typeof globalThis !== 'undefined' ? globalThis : this);
