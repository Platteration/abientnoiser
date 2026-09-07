/* Visualiser: slow drifting bands keyed to the current movement's colour and
 * to live audio energy. Deliberately low-contrast and low-framerate — it is
 * background for work, not a music video. */
(function (root) {
  const AN = root.AN = root.AN || {};

  class Visualizer {
    constructor(canvas, getEngine) {
      this.canvas = canvas;
      this.ctx2d = canvas.getContext('2d');
      this.getEngine = getEngine;
      this.hue = 200; this.targetHue = 200;
      this.intensity = 0.3; this.targetIntensity = 0.3;
      this.phase = 0;
      this.energy = [0, 0, 0];
      this.running = false;
      this.enabled = true;
      this.last = 0;
      this.bins = null;
      this._frame = this._frame.bind(this);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop(); else if (this.enabled) this.start();
      });
    }

    setEnabled(on) {
      this.enabled = on;
      this.canvas.hidden = !on;
      if (on) this.start(); else this.stop();
    }

    setSection(section) {
      this.targetHue = section.hue;
      this.targetIntensity = section.intensity;
      if (!this.started) { this.hue = section.hue; this.intensity = section.intensity; this.started = true; }
    }

    start() { if (this.running || !this.enabled) return; this.running = true; requestAnimationFrame(this._frame); }
    stop() { this.running = false; }

    resize() {
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
      if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w; this.canvas.height = h;
      }
      return dpr;
    }

    /** Three coarse energy bands from the analyser, smoothed. */
    sample() {
      const engine = this.getEngine();
      const an = engine && engine.graph.analyser;
      if (!an) { this.energy = this.energy.map((e) => e * 0.94); return; }
      if (!this.bins || this.bins.length !== an.frequencyBinCount) this.bins = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(this.bins);
      const n = this.bins.length;
      const bands = [[0, Math.floor(n * 0.04)], [Math.floor(n * 0.04), Math.floor(n * 0.2)], [Math.floor(n * 0.2), Math.floor(n * 0.7)]];
      bands.forEach(([a, b], i) => {
        let sum = 0;
        for (let k = a; k < b; k++) sum += this.bins[k];
        const v = sum / Math.max(1, b - a) / 255;
        this.energy[i] += (v - this.energy[i]) * 0.18;
      });
    }

    _frame(ts) {
      if (!this.running) return;
      requestAnimationFrame(this._frame);
      if (ts - this.last < 33) return; // ~30 fps is plenty for this
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;

      // ease colour and intensity toward the movement's, over many seconds
      const k = 1 - Math.pow(0.5, dt / 4);
      let dh = ((this.targetHue - this.hue + 540) % 360) - 180;
      this.hue = (this.hue + dh * k + 360) % 360;
      this.intensity += (this.targetIntensity - this.intensity) * k;
      this.sample();
      this.phase += dt * (0.05 + 0.09 * this.intensity);
      this.draw();
    }

    draw() {
      const dpr = this.resize();
      const c = this.ctx2d, W = this.canvas.width, H = this.canvas.height;
      if (!W || !H) return;
      c.clearRect(0, 0, W, H);
      const [bass, mid, treble] = this.energy;
      const light = document.documentElement.dataset.theme === 'light';

      // glow that breathes with the low end
      const glow = c.createRadialGradient(W * 0.72, H * 0.1, 0, W * 0.72, H * 0.1, Math.max(W, H) * 0.75);
      glow.addColorStop(0, `hsla(${this.hue} 70% ${light ? 62 : 55}% / ${0.05 + 0.14 * bass})`);
      glow.addColorStop(1, 'transparent');
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);

      // layered bands: the further back, the slower and wider
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const depth = i / (layers - 1);
        const amp = H * (0.035 + 0.075 * (bass * 0.6 + mid * 0.5)) * (1 - depth * 0.45);
        const base = H * (0.52 + depth * 0.16);
        const freq = (1.1 + i * 0.7) * Math.PI * 2 / W;
        const drift = this.phase * (0.5 + i * 0.35);
        c.beginPath();
        c.moveTo(0, H);
        for (let x = 0; x <= W; x += Math.max(2, Math.round(4 * dpr))) {
          const y = base
            + Math.sin(x * freq + drift) * amp
            + Math.sin(x * freq * 2.3 + drift * 1.7) * amp * 0.35 * (0.4 + treble);
          c.lineTo(x, y);
        }
        c.lineTo(W, H);
        c.closePath();
        const lum = light ? 74 - i * 6 : 26 + i * 5;
        c.fillStyle = `hsla(${this.hue + i * 14} ${38 + 18 * this.intensity}% ${lum}% / ${light ? 0.16 : 0.2})`;
        c.fill();
      }
    }
  }

  AN.Visualizer = Visualizer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
