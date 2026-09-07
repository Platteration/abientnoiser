/* Engine: performs a plan on an audio graph. Transport: timing, lookahead
 * scheduling, seamless looping, seeking, pause/resume, and offline render. */
(function (root) {
  const AN = root.AN = root.AN || {};
  const T = AN.theory;
  const S = AN.synths;

  const SENDS = { pads: 0.45, melody: 0.5, arp: 0.3, bass: 0.05, drums: 0.12, drone: 0.3 };
  const BASS_PATTERNS = [[0, 10], [0, 6, 8], [0, 8, 14], [0, 3, 8, 11]];

  class Engine {
    constructor(ctx, plan, settings) {
      this.ctx = ctx;
      this.plan = plan;
      this.settings = settings;
      this.graph = new AN.Graph(ctx, { volume: settings.volume });
      for (const l of AN.MUSIC_LAYERS) this.graph.layer(l.id, 'music', SENDS[l.id]);
      this.graph.layer('drone', 'music', SENDS.drone);
      this.textures = AN.ambience.create(this.graph);
      this.levels = Object.assign({}, settings.levels);
      this.section = null;
      this.mel = { note: null };
      this.transport = new Transport(this);
      this.applyLevels(this.levels, 0, true);
    }

    get isOffline() { return typeof this.ctx.startRendering === 'function'; }

    /** Mixer levels from the UI. */
    applyLevels(levels, t, initial = false) {
      const g = this.graph;
      Object.assign(this.levels, levels);
      for (const l of AN.MUSIC_LAYERS) {
        const v = this.levels[l.id] == null ? 0 : this.levels[l.id];
        if (initial) g.layers[l.id].user.gain.value = v; else g.setUserLevel(l.id, v, t);
      }
      const pads = this.levels.pads == null ? 0 : this.levels.pads;
      if (initial) g.layers.drone.user.gain.value = pads; else g.setUserLevel('drone', pads, t);
      for (const l of AN.AMBIENCE_LAYERS) {
        const v = this.levels[l.id] == null ? 0 : this.levels[l.id];
        const tex = this.textures[l.id];
        if (initial) tex.layer.user.gain.value = v; else g.setUserLevel(l.id, v, t);
        if (!initial && this.transport.playing) {
          if (v > 0 && !tex.running) { tex.start(t); if (this.section) tex.setSection(this.section, t); }
          else if (v <= 0 && tex.running) tex.stop(t + 0.6);
        }
      }
    }

    setVolume(v, t) { this.settings.volume = v; this.graph.setVolume(v, t); }

    /** Swap in a new plan (new seed/style/length) and restart from the top. */
    setPlan(plan, settings) {
      this.plan = plan;
      this.transport.plan = plan;
      if (settings) Object.assign(this.settings, settings);
      this.section = null;
      this.barRng = null;
      this.transport.seek(0);
    }

    startTextures(t) {
      for (const l of AN.AMBIENCE_LAYERS) {
        if ((this.levels[l.id] || 0) > 0) this.textures[l.id].start(t);
      }
    }
    stopTextures(t) { for (const id in this.textures) this.textures[id].stop(t); }

    // ---------- section handling ----------
    enterSection(section, t, fromSeek, pos) {
      this.section = section;
      this.lastBass = null;
      const g = this.graph;
      const tc = fromSeek ? 0.02 : 2.5;
      g.setCharacter(this.plan.lofi, section.brightness, t);
      for (const l of AN.MUSIC_LAYERS) g.setSectionLevel(l.id, section.music[l.id] || 0, t, tc);
      g.setSectionLevel('drone', section.music.drone || 0, t, tc);
      for (const id in this.textures) this.textures[id].setSection(section, t);
      // a root drone for the whole section
      if ((section.music.drone || 0) > 0 && (this.levels.pads || 0) > 0) {
        const remaining = section.end - pos;
        if (remaining > 8) {
          const keyMidi = 60 + section.keyRoot;
          S.drone(g, g.layers.drone, {
            midi: T.rootInRange(0, keyMidi, 36), t, dur: remaining - 4,
            brightness: section.brightness, level: 0.12, rng: AN.rng(this.plan.seed, 'drone', section.index),
          });
        }
      }
    }

    chordAt(section, stepIndex) {
      const chordSteps = section.chordBars * 16;
      const idx = Math.floor(stepIndex / chordSteps) % section.progression.length;
      const degree = section.progression[idx];
      const tones = T.chordTones(section.mode, degree, section.chordSize);
      const keyMidi = 60 + section.keyRoot;
      return { idx, degree, tones, keyMidi, voicing: T.voiceChord(tones, keyMidi, section.center) };
    }

    // ---------- per-step performance ----------
    onStep(ev) {
      const { t, section, stepIndex, bar, sixteenth, stepLen } = ev;
      const seed = this.plan.seed;
      if (sixteenth === 0 || !this.barRng || this.barFor !== `${section.index}:${bar}`) {
        this.barRng = AN.rng(seed, 'bar', section.index, bar);
        this.barFor = `${section.index}:${bar}`;
        this.barPlan = {
          melodyActive: this.barRng.bool(0.6 + 0.4 * (section.music.melody || 0)),
          stab: this.barRng.bool(0.55), stabStep: this.barRng.pick([10, 11, 12, 7]),
          fifth: this.barRng.bool(0.3), arpSkip: this.barRng.int(0, 15),
        };
      }
      const rng = AN.rng(seed, 'step', section.index, bar, sixteenth);
      const chord = this.chordAt(section, stepIndex);
      const chordSteps = section.chordBars * 16;
      const swingT = sixteenth % 2 === 1 ? t + (section.swing - 0.5) * 2 * stepLen : t;

      if (stepIndex % chordSteps === 0 && (this.levels.pads || 0) > 0) this.playChord(chord, t, chordSteps * stepLen, section, rng);
      if (section.comp && this.barPlan.stab && sixteenth === this.barPlan.stabStep && (this.levels.pads || 0) > 0) {
        this.compChord(chord.voicing, swingT, stepLen * 3, 0.2, section, rng);
      }
      if ((this.levels.bass || 0) > 0 && (section.music.bass || 0) > 0) this.playBass(chord, ev, swingT, rng);
      if ((this.levels.melody || 0) > 0 && (section.music.melody || 0) > 0 && this.barPlan.melodyActive) this.playMelody(chord, ev, swingT, rng);
      if ((this.levels.arp || 0) > 0 && (section.music.arp || 0) > 0) this.playArp(chord, ev, rng);
      if (section.kit && (this.levels.drums || 0) > 0 && section.drumPattern !== 'off') {
        AN.drums.step(this.graph, this.graph.layers.drums, { t, stepLen, section, sixteenth, bar, rng: AN.rng(seed, 'drums', section.index, bar, sixteenth), swing: section.swing });
      }
      // ambience one-shots for this step's window
      const p0 = ev.p, p1 = ev.p + stepLen;
      for (const id in this.textures) {
        const tex = this.textures[id];
        if (tex.running) tex.tick(p0, p1, ev.toCtx, AN.rng(seed, id, section.index, bar, sixteenth));
      }
    }

    /** One note of any melodic instrument, on any layer. */
    voice(layer, instr, opts) {
      const g = this.graph;
      if (instr === 'bell') S.bell(g, layer, opts);
      else if (instr === 'ep') S.ep(g, layer, opts);
      else if (instr === 'piano') S.piano(g, layer, opts);
      else S.pluck(g, layer, opts);
    }

    playChord(chord, t, dur, section, rng) {
      const g = this.graph, layer = g.layers.pads;
      if (section.chordInstr !== 'pad') {
        this.compChord(chord.voicing, t, dur * 0.9, 0.3, section, rng);
        S.pad(g, layer, { midis: chord.voicing, t, dur, brightness: section.brightness * 0.6, level: 0.04, wave: 'triangle', rng });
      } else {
        const dark = section.brightness < 0.35;
        S.pad(g, layer, {
          midis: chord.voicing, t, dur, brightness: section.brightness,
          level: dark ? 0.16 : 0.11, wave: dark ? 'triangle' : 'sawtooth', rng, pan: rng.float(-0.15, 0.15),
        });
      }
    }

    /** Rolled chord on the comping instrument. */
    compChord(voicing, t, dur, vel, section, rng) {
      const instr = section.chordInstr === 'pad' ? 'ep' : section.chordInstr;
      const roll = instr === 'piano' ? 0.02 : 0.012;
      voicing.forEach((m, i) => this.voice(this.graph.layers.pads, instr, {
        midi: m, t: t + i * roll + rng.float(0, 0.01), dur,
        vel: vel * rng.float(0.85, 1.05), pan: (i / voicing.length - 0.5) * 0.5,
      }));
    }

    playBass(chord, ev, swingT, rng) {
      const { section, sixteenth, stepIndex, stepLen } = ev;
      const layer = this.graph.layers.bass;
      const rootMidi = T.rootInRange(chord.tones[0], chord.keyMidi, 36);
      if (section.bassStyle === 'walk') return this.walkBass(chord, ev, swingT, rng);
      if (section.bassStyle !== 'pattern') {
        const chordSteps = section.chordBars * 16;
        if (stepIndex % chordSteps === 0) S.bass(this.graph, layer, { midi: rootMidi, t: ev.t, dur: chordSteps * stepLen * 0.95, vel: 0.4, soft: true });
        return;
      }
      const pattern = BASS_PATTERNS[section.bassPattern % BASS_PATTERNS.length];
      if (!pattern.includes(sixteenth)) return;
      if (section.drumPattern === 'off' && sixteenth !== 0) return; // breakdown: whole notes
      let midi = rootMidi;
      if (sixteenth === 8 && this.barPlan.fifth) midi = T.rootInRange(chord.tones[2], chord.keyMidi, 36);
      if (sixteenth > 8 && rng.bool(0.25)) midi += 12;
      const next = pattern[pattern.indexOf(sixteenth) + 1];
      const holdSteps = next == null ? 16 - sixteenth : next - sixteenth;
      S.bass(this.graph, layer, { midi, t: swingT, dur: Math.max(0.15, holdSteps * stepLen * 0.85), vel: 0.6 + rng.float(-0.05, 0.1) });
    }

    /** Walking bass: root on the chord change, chord and passing tones between,
     *  then a chromatic approach into the next chord. */
    walkBass(chord, ev, swingT, rng) {
      const { section, sixteenth, stepIndex, stepLen } = ev;
      if (sixteenth % 4 !== 0) return;
      const low = 36;
      const chordSteps = section.chordBars * 16;
      const posInChord = stepIndex % chordSteps;
      const scale = T.scaleNotes(chord.keyMidi, section.mode, low, low + 17);
      const rootMidi = T.rootInRange(chord.tones[0], chord.keyMidi, low);
      const chordNotes = scale.filter((m) => chord.tones.some((tn) => ((m - chord.keyMidi - tn) % 12 + 12) % 12 === 0));
      let midi;
      if (posInChord === 0 || this.lastBass == null) {
        midi = rootMidi;
      } else if (posInChord + 4 >= chordSteps) {
        const next = this.chordAt(section, stepIndex + 4);
        const nextRoot = T.rootInRange(next.tones[0], next.keyMidi, low);
        midi = nextRoot + rng.pick([-1, 1, -2, 2]); // approach from a step away
      } else {
        const near = chordNotes.concat(scale).filter((m) => Math.abs(m - this.lastBass) <= 5 && m !== this.lastBass);
        midi = near.length ? rng.pick(near) : rootMidi;
      }
      if (midi < low) midi += 12;
      if (midi > low + 19) midi -= 12;
      this.lastBass = midi;
      S.bass(this.graph, this.graph.layers.bass, {
        midi, t: swingT, dur: stepLen * 4 * 0.92, vel: 0.5 + rng.float(-0.05, 0.08),
      });
    }

    playMelody(chord, ev, swingT, rng) {
      const { section, sixteenth, stepLen } = ev;
      if (sixteenth % 2 === 1) return;
      const instr = section.melodyInstr;
      const rate = instr === 'bell' ? 0.5 : instr === 'ep' ? 0.55 : instr === 'piano' ? 0.52 : 0.45;
      const prob = rate * (0.35 + 0.65 * section.density) * (sixteenth % 4 === 0 ? 1 : 0.5) * (0.4 + 0.6 * section.music.melody);
      if (!rng.bool(prob)) return;
      const lo = section.center + 3, hi = section.center + 20;
      const scale = T.scaleNotes(chord.keyMidi, section.mode, lo, hi);
      const chordNotes = scale.filter((m) => chord.tones.some((tn) => ((m - chord.keyMidi - tn) % 12 + 12) % 12 === 0));
      let note = this.mel.note;
      if (note == null || note < lo || note > hi) note = rng.pick(chordNotes);
      else if (sixteenth % 4 === 0 && rng.bool(0.6)) {
        // resolve to the nearest chord tone (tie-break upward or downward at random)
        const sorted = chordNotes.slice().sort((a, b) => Math.abs(a - note) - Math.abs(b - note) || (rng.bool() ? -1 : 1));
        note = sorted[0] === note && sorted.length > 1 && rng.bool(0.5) ? sorted[1] : sorted[0];
      } else {
        const i = scale.indexOf(note) >= 0 ? scale.indexOf(note) : Math.floor(scale.length / 2);
        const centerIdx = scale.length / 2;
        const dirUp = rng.bool(0.5 + (centerIdx - i) * 0.06); // drift back toward the middle
        const stepSize = rng.pick([1, 1, 1, 2, 2, 3]);
        note = scale[Math.max(0, Math.min(scale.length - 1, i + (dirUp ? stepSize : -stepSize)))];
      }
      this.mel.note = note;
      const vel = Math.max(0.15, Math.min(0.95, 0.32 + 0.45 * section.intensity + rng.gauss(0, 0.06)));
      const pan = rng.float(-0.35, 0.35);
      const layer = this.graph.layers.melody;
      const dur = rng.pick([1, 2, 2, 3, 4]) * stepLen * 2;
      this.voice(layer, instr, { midi: note, t: swingT, dur, vel, pan });
      if ((instr === 'ep' || instr === 'piano') && rng.bool(0.14)) { // harmony note a third below
        const i = scale.indexOf(note);
        if (i >= 2) this.voice(layer, instr, { midi: scale[i - 2], t: swingT + 0.012, dur: dur * 0.8, vel: vel * 0.7, pan: -pan });
      }
    }

    playArp(chord, ev, rng) {
      const { section, sixteenth, stepIndex, stepLen } = ev;
      if (sixteenth % 2 === 1) return;
      if (sixteenth === this.barPlan.arpSkip) return;
      const notes = chord.voicing.concat([chord.voicing[0] + 12]);
      const n = notes.length, k = stepIndex >> 1;
      let idx;
      if (section.arpPattern === 0) idx = k % n;
      else if (section.arpPattern === 1) { const cyc = 2 * n - 2; const j = k % cyc; idx = j < n ? j : cyc - j; }
      else idx = AN.rng(this.plan.seed, 'arp', section.index, k).int(0, n - 1);
      const vel = (sixteenth === 0 ? 0.42 : 0.3) * (0.7 + 0.5 * section.intensity) + rng.float(-0.03, 0.03);
      this.voice(this.graph.layers.arp, section.arpInstr, {
        midi: notes[idx], t: ev.t + rng.gauss(0, 0.002), dur: stepLen * 2, vel, pan: (idx / n - 0.5) * 0.6,
      });
    }
  }

  // ---------- Transport ----------
  class Transport {
    constructor(engine) {
      this.engine = engine;
      this.ctx = engine.ctx;
      this.plan = engine.plan;
      this.lookahead = 2.5;
      this.playing = false;
      this.position = 0;     // piece seconds while paused
      this.baseCtx = 0;      // ctx time at which piece position 0 of the current loop falls
      this.cursor = 0;       // ctx time of the next step to schedule
      this.stepIndex = 0;
      this.section = null;
      this.loops = 0;
      this.gen = 0;
      this.onLoop = null;
    }

    get duration() { return this.plan.duration; }
    wrap(p) { const d = this.duration; return ((p % d) + d) % d; }

    /** Current piece position in seconds. */
    now() {
      if (!this.playing) return this.position;
      return this.wrap(this.ctx.currentTime - this.baseCtx);
    }

    play() {
      if (this.playing) return;
      const ctx = this.ctx;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      const t = ctx.currentTime + 0.08;
      this.playing = true;
      this.gen++;
      this._enter(this.position, t, true);
      const m = this.engine.graph.master.gain;
      m.cancelScheduledValues(t);
      m.setValueAtTime(0, t);
      m.linearRampToValueAtTime(this.engine.settings.volume, t + 0.8);
      this.engine.startTextures(t);
      this._startTimer();
      this.schedule();
    }

    pause() {
      if (!this.playing) return;
      const ctx = this.ctx, t = ctx.currentTime;
      this.position = this.now();
      this.playing = false;
      this._stopTimer();
      const m = this.engine.graph.master.gain;
      m.cancelScheduledValues(t);
      m.setTargetAtTime(0, t, 0.06);
      const gen = ++this.gen;
      setTimeout(() => {
        if (this.gen !== gen) return;
        const now = ctx.currentTime;
        this.engine.graph.killAll(now);
        this.engine.stopTextures(now);
      }, 350);
    }

    seek(pos) {
      const was = this.playing;
      if (was) {
        const now = this.ctx.currentTime;
        this.engine.graph.killAll(now);
        this.engine.stopTextures(now);
        this.gen++;
      }
      this.position = this.wrap(pos);
      if (was) {
        const t = this.ctx.currentTime + 0.05;
        this._enter(this.position, t, true);
        this.engine.startTextures(t);
        this.schedule();
      }
    }

    toggle() { this.playing ? this.pause() : this.play(); }

    _enter(pos, ctxTime, fromSeek) {
      const section = AN.sectionAt(this.plan, pos);
      const stepLen = 60 / section.tempo / 4;
      this.baseCtx = ctxTime - pos;
      this.stepIndex = Math.ceil((pos - section.start) / stepLen - 1e-9);
      this.cursor = this.baseCtx + section.start + this.stepIndex * stepLen;
      this.section = section;
      this.engine.mel.note = null;
      this.engine.enterSection(section, ctxTime, fromSeek, pos);
    }

    /** Schedule every step up to `limit` (ctx seconds). */
    scheduleUntil(limit) {
      let guard = 0;
      while (this.cursor < limit && guard++ < 100000) this.step();
    }

    schedule() {
      if (!this.playing) return;
      this.scheduleUntil(this.ctx.currentTime + this.lookahead);
    }

    step() {
      let p = this.cursor - this.baseCtx;
      if (p >= this.duration - 1e-6) { // loop seam
        this.baseCtx += this.duration;
        p -= this.duration;
        this.loops++;
        if (this.onLoop) this.onLoop(this.loops);
      }
      const sec = AN.sectionAt(this.plan, p);
      if (sec !== this.section) {
        this.cursor = this.baseCtx + sec.start;
        p = sec.start;
        this.section = sec;
        this.stepIndex = 0;
        this.engine.enterSection(sec, this.cursor, false, p);
      }
      const stepLen = 60 / sec.tempo / 4;
      const stepIndex = this.stepIndex;
      this.engine.onStep({
        t: this.cursor, p, section: sec, stepIndex, bar: Math.floor(stepIndex / 16), sixteenth: stepIndex % 16,
        stepLen, barLen: stepLen * 16, toCtx: (pp) => this.baseCtx + pp,
      });
      this.stepIndex++;
      this.cursor += stepLen;
    }

    /** Offline: schedule the first `seconds` of the piece from position 0. */
    renderRange(seconds) {
      this.playing = true;
      this._enter(0, 0, true);
      this.engine.startTextures(0);
      this.scheduleUntil(seconds + 0.5);
      this.playing = false;
    }

    _startTimer() {
      this._stopTimer();
      const tick = () => this.schedule();
      try {
        const src = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        this.worker.onmessage = tick;
        this.worker.postMessage(120);
        URL.revokeObjectURL(url);
      } catch (e) {
        this.timer = setInterval(tick, 120);
      }
    }
    _stopTimer() {
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
  }

  AN.Engine = Engine;
  AN.Transport = Transport;
})(typeof globalThis !== 'undefined' ? globalThis : this);
