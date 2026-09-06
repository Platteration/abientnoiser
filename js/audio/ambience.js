/* Procedural environment sounds. Each texture has:
 *   start(t)                 begin continuous parts
 *   stop(t)                  stop continuous parts
 *   setSection(section, t)   ramp to the section's intensity multiplier
 *   tick(p0, p1, toCtx, rng) schedule random one-shots in piece-time window [p0, p1)
 * The layer's `input` gain is the texture's section multiplier; `user` is the mixer. */
(function (root) {
  const AN = root.AN = root.AN || {};

  class Texture {
    constructor(graph, id) {
      this.graph = graph;
      this.id = id;
      this.layer = graph.layer(id, 'ambience', this.sendLevel());
      this.nodes = [];
      this.running = false;
      this.mult = 1;
    }
    sendLevel() { return 0.15; }
    get ctx() { return this.graph.ctx; }
    /** Keep a continuous node so stop() can kill it. */
    keep(n) { this.nodes.push(n); return n; }
    start(t) { if (this.running) return; this.running = true; this.build(t); }
    build() {}
    stop(t) {
      if (!this.running) return;
      this.running = false;
      for (const n of this.nodes) {
        try { if (typeof n.stop === 'function') n.stop(t + 0.05); } catch (e) { /* ignore */ }
        // disconnect a moment later so tails through gain ramps aren't cut mid-sample
        if (typeof n.stop !== 'function') { try { n.disconnect(); } catch (e) { /* ignore */ } }
      }
      this.nodes = [];
    }
    setSection(section, t) {
      this.mult = (section.ambience && section.ambience[this.id]) || 1;
      this.layer.input.gain.setTargetAtTime(this.mult, t, 4);
      this.onSection(section, t);
    }
    onSection() {}
    tick() {}
    burst(t, dur, type, filterType, freq, Q, gain, pan) {
      const c = this.ctx, g = this.graph;
      t = Math.max(t, c.currentTime);
      const src = g.noiseSource(type, t, true);
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = Q;
      const env = c.createGain();
      const p = g.panner(pan);
      src.connect(f); f.connect(env); env.connect(p); p.connect(this.layer.input);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(gain, t + Math.min(0.004, dur * 0.2));
      env.gain.setTargetAtTime(0, t + Math.min(0.004, dur * 0.2), dur / 3);
      src.stop(t + dur * 3 + 0.05);
      g.track(src, f, env, p);
    }
  }

  // ---------------- Rain ----------------
  class Rain extends Texture {
    sendLevel() { return 0.08; }
    build(t) {
      const c = this.ctx;
      const src = this.keep(this.graph.noiseSource('pink', t));
      const bp = this.keep(c.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.45;
      const hp = this.keep(c.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 350;
      const g = this.keep(c.createGain()); g.gain.value = 0.55;
      src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.layer.input);
      this.bp = bp; this.g = g;
      // slow wander of the rain's colour
      const lfo = this.keep(c.createOscillator()); lfo.frequency.value = 0.05;
      const lg = this.keep(c.createGain()); lg.gain.value = 250;
      lfo.connect(lg); lg.connect(bp.frequency); lfo.start(t);
    }
    onSection(section, t) {
      if (!this.bp) return;
      // heavier rain = darker + louder
      this.bp.frequency.setTargetAtTime(1900 - 600 * Math.min(1.5, this.mult), t, 5);
    }
    tick(p0, p1, toCtx, rng) {
      const rate = 2.2 * this.mult; // drips per second
      const n = rng.poisson(rate * (p1 - p0));
      for (let i = 0; i < n; i++) {
        const t = toCtx(rng.float(p0, p1));
        const f = rng.float(1800, 5200);
        this.burst(t, rng.float(0.02, 0.05), 'white', 'bandpass', f, 14, rng.float(0.05, 0.18), rng.float(-0.8, 0.8));
      }
    }
  }

  // ---------------- Thunder ----------------
  class Thunder extends Texture {
    sendLevel() { return 0.35; }
    tick(p0, p1, toCtx, rng) {
      const perMinute = 0.55 * this.mult;
      const n = rng.poisson(perMinute / 60 * (p1 - p0));
      for (let i = 0; i < n; i++) this.strike(toCtx(rng.float(p0, p1)), rng);
    }
    strike(t, rng) {
      const c = this.ctx, g = this.graph;
      const src = g.noiseSource('brown', t, true);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(rng.float(260, 420), t);
      lp.frequency.setTargetAtTime(70, t + 0.3, 2.5);
      const env = c.createGain();
      const p = g.panner(rng.float(-0.7, 0.7));
      src.connect(lp); lp.connect(env); env.connect(p); p.connect(this.layer.input);
      const distance = rng.float(0.3, 1); // 1 = near
      const peak = 0.9 * distance;
      const attack = rng.float(0.08, 0.6) / distance;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + attack);
      let cursor = t + attack;
      const rolls = rng.int(1, 4);
      for (let r = 0; r < rolls; r++) {
        const gap = rng.float(0.5, 1.6);
        env.gain.setTargetAtTime(peak * rng.float(0.2, 0.5), cursor, 0.5);
        env.gain.setTargetAtTime(peak * rng.float(0.5, 0.9) * (1 - r / (rolls + 1)), cursor + gap, 0.25);
        cursor += gap + 0.4;
      }
      const tail = rng.float(3, 7);
      env.gain.setTargetAtTime(0, cursor, tail / 3);
      src.stop(cursor + tail * 1.5);
      g.track(src, lp, env, p);
    }
  }

  // ---------------- Wind ----------------
  class Wind extends Texture {
    sendLevel() { return 0.1; }
    build(t) {
      const c = this.ctx;
      const src = this.keep(this.graph.noiseSource('pink', t));
      const lp = this.keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1.4;
      const g = this.keep(c.createGain()); g.gain.value = 0.35;
      src.connect(lp); lp.connect(g); g.connect(this.layer.input);
      // a whistling band that gusts
      const bp = this.keep(c.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
      const bg = this.keep(c.createGain()); bg.gain.value = 0.12;
      src.connect(bp); bp.connect(bg); bg.connect(this.layer.input);
      this.lp = lp; this.g = g; this.bp = bp; this.bg = bg;
    }
    tick(p0, p1, toCtx, rng) {
      if (!this.lp) return;
      // every ~2 s, wander towards a new gust level
      if (Math.floor(p0 / 2) !== Math.floor(p1 / 2)) {
        const t = toCtx(p1);
        const gust = Math.pow(rng.next(), 1.6) * this.mult; // mostly calm, sometimes gusty
        this.lp.frequency.setTargetAtTime(220 + 900 * gust, t, 1.6);
        this.g.gain.setTargetAtTime(0.25 + 0.35 * gust, t, 1.8);
        this.bp.frequency.setTargetAtTime(rng.float(500, 1400), t, 2.2);
        this.bg.gain.setTargetAtTime(0.03 + 0.22 * gust * gust, t, 1.5);
      }
    }
  }

  // ---------------- Waves ----------------
  class Waves extends Texture {
    sendLevel() { return 0.12; }
    build(t) {
      const c = this.ctx;
      // low wash
      const src = this.keep(this.graph.noiseSource('brown', t));
      const lp = this.keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.6;
      const g = this.keep(c.createGain()); g.gain.value = 0.2;
      src.connect(lp); lp.connect(g); g.connect(this.layer.input);
      // foam / hiss
      const src2 = this.keep(this.graph.noiseSource('pink', t));
      const hp = this.keep(c.createBiquadFilter()); hp.type = 'bandpass'; hp.frequency.value = 2200; hp.Q.value = 0.5;
      const g2 = this.keep(c.createGain()); g2.gain.value = 0.09;
      src2.connect(hp); hp.connect(g2); g2.connect(this.layer.input);
      // swell LFOs (slightly different periods so the pattern never quite repeats)
      const lfo = this.keep(c.createOscillator()); lfo.frequency.value = 1 / 11.5;
      const lg = this.keep(c.createGain()); lg.gain.value = 0.17;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      const lfo2 = this.keep(c.createOscillator()); lfo2.frequency.value = 1 / 9.7;
      const lg2 = this.keep(c.createGain()); lg2.gain.value = 0.08;
      lfo2.connect(lg2); lg2.connect(g2.gain); lfo2.start(t);
      const lg3 = this.keep(c.createGain()); lg3.gain.value = 350;
      lfo.connect(lg3); lg3.connect(lp.frequency);
    }
  }

  // ---------------- Fire ----------------
  class Fire extends Texture {
    sendLevel() { return 0.05; }
    build(t) {
      const c = this.ctx;
      const src = this.keep(this.graph.noiseSource('brown', t));
      const lp = this.keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.8;
      const g = this.keep(c.createGain()); g.gain.value = 0.3;
      src.connect(lp); lp.connect(g); g.connect(this.layer.input);
      const lfo = this.keep(c.createOscillator()); lfo.frequency.value = 0.23;
      const lg = this.keep(c.createGain()); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
    }
    tick(p0, p1, toCtx, rng) {
      // crackles arrive in little clusters
      const rate = 5 * this.mult;
      const n = rng.poisson(rate * (p1 - p0));
      for (let i = 0; i < n; i++) {
        const base = rng.float(p0, p1);
        const k = rng.bool(0.3) ? rng.int(2, 4) : 1;
        for (let j = 0; j < k; j++) {
          const t = toCtx(base + j * rng.float(0.01, 0.04));
          this.burst(t, rng.float(0.004, 0.014), 'white', 'highpass', rng.float(1800, 4000), 1.5, rng.float(0.05, 0.18), rng.float(-0.5, 0.5));
        }
      }
    }
  }

  // ---------------- Birds ----------------
  class Birds extends Texture {
    sendLevel() { return 0.3; }
    tick(p0, p1, toCtx, rng) {
      const perMinute = 7 * this.mult;
      const n = rng.poisson(perMinute / 60 * (p1 - p0));
      for (let i = 0; i < n; i++) this.phrase(toCtx(rng.float(p0, p1)), rng);
    }
    phrase(t, rng) {
      const c = this.ctx, g = this.graph;
      const o = c.createOscillator(); o.type = 'sine';
      const env = c.createGain(); env.gain.value = 0;
      const p = g.panner(rng.float(-0.9, 0.9));
      o.connect(env); env.connect(p); p.connect(this.layer.input);
      const base = rng.float(2300, 4600);
      const notes = rng.int(2, 6);
      const loud = rng.float(0.05, 0.13) * Math.pow(rng.next(), 0.5); // distance
      let cursor = t;
      o.frequency.setValueAtTime(base, t);
      for (let i = 0; i < notes; i++) {
        const len = rng.float(0.05, 0.16);
        const f0 = base * rng.float(0.85, 1.15), f1 = f0 * rng.float(0.8, 1.3);
        o.frequency.setValueAtTime(f0, cursor);
        o.frequency.exponentialRampToValueAtTime(f1, cursor + len);
        env.gain.setValueAtTime(0, cursor);
        env.gain.linearRampToValueAtTime(loud, cursor + len * 0.3);
        env.gain.linearRampToValueAtTime(0, cursor + len);
        cursor += len + rng.float(0.03, 0.12);
      }
      o.start(t); o.stop(cursor + 0.1);
      g.track(o, env, p);
    }
  }

  // ---------------- Crickets ----------------
  class Crickets extends Texture {
    sendLevel() { return 0.1; }
    build(t) {
      const c = this.ctx;
      this.voices = [];
      const defs = [[4300, 27, -0.6], [4650, 31, 0.5], [3900, 24, 0.1]];
      for (const [freq, rate, pan] of defs) {
        const o = this.keep(c.createOscillator()); o.type = 'sine'; o.frequency.value = freq;
        const gate = this.keep(c.createGain()); gate.gain.value = 0.5;       // trill: 0.5 + square*0.5
        const lfo = this.keep(c.createOscillator()); lfo.type = 'square'; lfo.frequency.value = rate;
        const lg = this.keep(c.createGain()); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(gate.gain);
        const phrase = this.keep(c.createGain()); phrase.gain.value = 0;    // chirp on/off
        const p = this.keep(this.graph.panner(pan));
        o.connect(gate); gate.connect(phrase); phrase.connect(p); p.connect(this.layer.input);
        o.start(t); lfo.start(t);
        this.voices.push({ phrase, next: null });
      }
    }
    tick(p0, p1, toCtx, rng) {
      if (!this.voices) return;
      this.voices.forEach((v, i) => {
        if (v.next === null || v.next < p0 - 5) v.next = p0 + rng.float(0, 1.5);
        while (v.next < p1) {
          const on = rng.float(0.35, 1.1), off = rng.float(0.25, 1.5) / this.mult;
          const t = toCtx(v.next), level = rng.float(0.05, 0.11) * (i === 2 ? 0.6 : 1);
          v.phrase.gain.setTargetAtTime(level, t, 0.05);
          v.phrase.gain.setTargetAtTime(0, t + on, 0.05);
          v.next += on + off;
        }
      });
    }
  }

  // ---------------- Vinyl ----------------
  class Vinyl extends Texture {
    sendLevel() { return 0; }
    build(t) {
      const c = this.ctx;
      const src = this.keep(this.graph.noiseSource('pink', t));
      const bp = this.keep(c.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.4;
      const g = this.keep(c.createGain()); g.gain.value = 0.045;
      src.connect(bp); bp.connect(g); g.connect(this.layer.input);
      // faint mains hum / motor rumble
      const hum = this.keep(c.createOscillator()); hum.type = 'sine'; hum.frequency.value = 50;
      const hg = this.keep(c.createGain()); hg.gain.value = 0.012;
      hum.connect(hg); hg.connect(this.layer.input); hum.start(t);
    }
    tick(p0, p1, toCtx, rng) {
      const rate = 9; // clicks per second
      const n = rng.poisson(rate * (p1 - p0));
      for (let i = 0; i < n; i++) {
        const t = toCtx(rng.float(p0, p1));
        const big = rng.bool(0.08);
        this.burst(t, big ? rng.float(0.008, 0.02) : rng.float(0.0015, 0.004), 'white', 'highpass', big ? 900 : 2500, 0.7, big ? 0.18 : rng.float(0.05, 0.13), rng.float(-0.3, 0.3));
      }
    }
  }

  AN.ambience = {
    classes: { rain: Rain, thunder: Thunder, wind: Wind, waves: Waves, fire: Fire, birds: Birds, crickets: Crickets, vinyl: Vinyl },
    create(graph) {
      const out = {};
      for (const id of Object.keys(this.classes)) out[id] = new this.classes[id](graph, id);
      return out;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
