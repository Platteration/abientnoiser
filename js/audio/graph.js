/* Audio graph: master chain, buses, reverb, layer gains, noise buffers.
 * Works with both AudioContext (live) and OfflineAudioContext (export). */
(function (root) {
  const AN = root.AN = root.AN || {};

  /* Impulse responses and noise beds are identical for every graph at a given
   * sample rate and cost real time to synthesise, so build each one once. They
   * are plain AudioBuffers and can be shared across contexts. */
  const BUFFERS = new Map();
  function cachedBuffer(key, build) {
    if (!BUFFERS.has(key)) BUFFERS.set(key, build());
    return BUFFERS.get(key);
  }

  /** The shared tail of the live audio chain: everything playing feeds one of
   *  these, so recording and the visualiser see the whole mix — including two
   *  pieces overlapping during a crossfade. */
  class Output {
    constructor(ctx) {
      this.ctx = ctx;
      this.node = ctx.createGain();
      this.node.connect(ctx.destination);
      if (typeof ctx.createAnalyser === 'function') {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.82;
        this.node.connect(this.analyser);
      }
      if (typeof ctx.createMediaStreamDestination === 'function') {
        this.recordDest = ctx.createMediaStreamDestination();
        this.node.connect(this.recordDest);
      }
    }
  }

  class Graph {
    constructor(ctx, opts = {}) {
      this.ctx = ctx;
      this.sources = new Set();
      const c = ctx;

      this.master = c.createGain();
      this.master.gain.value = opts.volume == null ? 0.8 : opts.volume;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.knee.value = 18; this.comp.ratio.value = 5;
      this.comp.attack.value = 0.01; this.comp.release.value = 0.3;
      this.master.connect(this.comp);
      this.output = opts.output || null;
      this.comp.connect(this.output ? this.output.node : c.destination);
      this.analyser = this.output ? this.output.analyser : null;
      this.recordDest = this.output ? this.output.recordDest : null;

      // reverb (generated impulse responses): a long hall, and a short room for drums
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.makeImpulse(3.4, 2.6, 'hall');
      this.reverbGain = c.createGain();
      this.reverbGain.gain.value = 0.9;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);

      this.roomReverb = c.createConvolver();
      this.roomReverb.buffer = this.makeImpulse(0.9, 4.5, 'room');
      this.roomGain = c.createGain();
      this.roomGain.gain.value = 0.8;
      this.roomReverb.connect(this.roomGain);
      this.roomGain.connect(this.master);

      // music chain: [pump] -> bus -> tape wobble -> lo-fi lowpass -> saturation -> master
      this.musicBus = c.createGain();

      // pads, drone and arp pass through here so the kick can duck them
      this.pump = c.createGain();
      this.pump.gain.value = 1;
      this.pump.connect(this.musicBus);

      // a short modulated delay: constant delay is inaudible, modulation is tape wow and flutter
      this.tape = c.createDelay(0.05);
      this.tape.delayTime.value = 0.006;
      this.wow = c.createOscillator(); this.wow.frequency.value = 0.7;
      this.wowGain = c.createGain(); this.wowGain.gain.value = 0;
      this.wow.connect(this.wowGain); this.wowGain.connect(this.tape.delayTime);
      this.flutter = c.createOscillator(); this.flutter.frequency.value = 6.3;
      this.flutterGain = c.createGain(); this.flutterGain.gain.value = 0;
      this.flutter.connect(this.flutterGain); this.flutterGain.connect(this.tape.delayTime);
      try { this.wow.start(0); this.flutter.start(0); } catch { /* already started */ }

      this.lofiFilter = c.createBiquadFilter();
      this.lofiFilter.type = 'lowpass'; this.lofiFilter.Q.value = 0.4;
      this.openCutoff = Math.min(18000, c.sampleRate * 0.45);
      this.lofiFilter.frequency.value = this.openCutoff;
      this.shaper = c.createWaveShaper();
      this.shaper.curve = Graph.curve(0);
      this.shaper.oversample = '2x';
      this.musicBus.connect(this.tape);
      this.tape.connect(this.lofiFilter);
      this.lofiFilter.connect(this.shaper);
      this.shaper.connect(this.master);

      this.ambienceBus = c.createGain();
      this.ambienceBus.connect(this.master);

      this.layers = {};
      this._offset = 0;
    }

    /** input(section multiplier) -> user(mixer level) -> bus; user -> send -> reverb.
     *  bus: 'music' | 'pump' (ducked by the kick) | 'ambience'. */
    layer(name, bus = 'music', sendLevel = 0.3, reverb = 'hall') {
      if (this.layers[name]) return this.layers[name];
      const c = this.ctx;
      const input = c.createGain(); input.gain.value = 1;
      const user = c.createGain(); user.gain.value = 1;
      const send = c.createGain(); send.gain.value = sendLevel;
      input.connect(user);
      user.connect(bus === 'ambience' ? this.ambienceBus : bus === 'pump' ? this.pump : this.musicBus);
      user.connect(send);
      send.connect(reverb === 'room' ? this.roomReverb : this.reverb);
      return (this.layers[name] = { name, input, user, send });
    }

    /** Duck the pumped layers under a kick. */
    pumpDuck(t, amount) {
      if (!(amount > 0)) return;
      const g = this.pump.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(Math.max(0.1, 1 - amount), t + 0.018);
      g.setTargetAtTime(1, t + 0.03, 0.085);
    }

    setUserLevel(name, level, t) {
      const l = this.layers[name];
      if (!l) return;
      l.user.gain.cancelScheduledValues(t);
      l.user.gain.setTargetAtTime(Math.max(0, level), t, 0.08);
    }

    setSectionLevel(name, mult, t, tc = 2.5) {
      const l = this.layers[name];
      if (!l) return;
      l.input.gain.setTargetAtTime(Math.max(0, mult), t, tc);
    }

    setVolume(v, t) {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(Math.max(0, v), t, 0.05);
    }

    /** Lo-fi character: closed-down lowpass, gentle saturation, tape wow and flutter. */
    setCharacter(lofi, brightness, t) {
      const f = lofi ? Math.min(this.openCutoff, 2200 + brightness * 4500) : this.openCutoff;
      this.lofiFilter.frequency.setTargetAtTime(f, t, 1.5);
      const drive = lofi ? 0.35 : 0;
      if (this._drive !== drive) { this.shaper.curve = Graph.curve(drive); this._drive = drive; }
      this.wowGain.gain.setTargetAtTime(lofi ? 0.0012 : 0, t, 1);
      this.flutterGain.gain.setTargetAtTime(lofi ? 0.00012 : 0, t, 1);
    }

    static curve(drive) {
      const n = 1024, arr = new Float32Array(n);
      const k = drive * 3;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        arr[i] = k > 0 ? Math.tanh(x * (1 + k)) / Math.tanh(1 + k) : x;
      }
      return arr;
    }

    makeImpulse(seconds, decay, kind = 'hall') {
      return cachedBuffer(`ir:${kind}:${seconds}:${decay}:${this.ctx.sampleRate}`, () => this.buildImpulse(seconds, decay, kind));
    }

    buildImpulse(seconds, decay, kind) {
      const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * seconds);
      const buf = c.createBuffer(2, len, sr);
      const rng = AN.rng('impulse', kind);
      const smooth = kind === 'room' ? 0.55 : 0.25; // rooms keep more high end
      const gain = kind === 'room' ? 1.4 : 2.2;
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let y = 0;
        for (let i = 0; i < len; i++) {
          const x = (rng.next() * 2 - 1) * Math.pow(1 - i / len, decay);
          y += smooth * (x - y); // one-pole lowpass -> darker tail
          d[i] = y * gain;
        }
      }
      return buf;
    }

    /** Looping noise buffer: 'white' | 'pink' | 'brown' */
    noise(type) {
      return cachedBuffer(`noise:${type}:${this.ctx.sampleRate}`, () => this.buildNoise(type));
    }

    buildNoise(type) {
      const c = this.ctx, sr = c.sampleRate, len = sr * 4;
      const buf = c.createBuffer(2, len, sr);
      const rng = AN.rng('noise', type);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        if (type === 'white') {
          for (let i = 0; i < len; i++) d[i] = rng.next() * 2 - 1;
        } else if (type === 'pink') {
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (let i = 0; i < len; i++) {
            const w = rng.next() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
          }
        } else { // brown
          let last = 0;
          for (let i = 0; i < len; i++) {
            const w = rng.next() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            d[i] = last * 3.5;
          }
        }
      }
      return buf;
    }

    noiseSource(type, t, loop = true) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise(type);
      src.loop = loop;
      this._offset = (this._offset + 0.731) % 3.9;
      src.start(t, this._offset);
      return src;
    }

    panner(pan) {
      const c = this.ctx;
      if (typeof c.createStereoPanner === 'function') {
        const p = c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan || 0));
        return p;
      }
      return c.createGain();
    }

    /** Register a source so pause/stop can kill it; disconnect nodes when done. */
    track(src, ...cleanup) {
      this.sources.add(src);
      src.onended = () => {
        this.sources.delete(src);
        for (const n of cleanup) { try { n.disconnect(); } catch { /* already gone */ } }
      };
      return src;
    }

    killAll(t) {
      for (const s of this.sources) { try { s.stop(t); } catch { /* not started */ } }
      this.sources.clear();
    }
  }

  AN.Graph = Graph;
  AN.Output = Output;
})(typeof globalThis !== 'undefined' ? globalThis : this);
