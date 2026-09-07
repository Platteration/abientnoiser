/* Recording (live, via MediaRecorder) and offline WAV rendering. */
(function (root) {
  const AN = root.AN = root.AN || {};

  class Recorder {
    constructor(graph) {
      this.graph = graph;
      this.rec = null;
      this.chunks = [];
      this.startedAt = 0;
    }
    static supported() { return typeof MediaRecorder !== 'undefined'; }
    static mimeType() {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      for (const t of types) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
      return '';
    }
    get recording() { return !!this.rec && this.rec.state === 'recording'; }
    get elapsed() { return this.recording ? (performance.now() - this.startedAt) / 1000 : 0; }
    start() {
      if (!this.graph.recordDest) throw new Error('Recording is not available in this context');
      const mimeType = Recorder.mimeType();
      this.chunks = [];
      this.rec = new MediaRecorder(this.graph.recordDest.stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.rec.start(1000);
      this.startedAt = performance.now();
      this.mimeType = this.rec.mimeType || mimeType || 'audio/webm';
    }
    stop() {
      return new Promise((resolve) => {
        if (!this.rec) return resolve(null);
        const rec = this.rec;
        rec.onstop = () => {
          const blob = new Blob(this.chunks, { type: this.mimeType });
          this.rec = null; this.chunks = [];
          resolve(blob);
        };
        rec.stop();
      });
    }
    extension() { return /ogg/.test(this.mimeType) ? 'ogg' : /mp4/.test(this.mimeType) ? 'm4a' : 'webm'; }
  }

  /** Render the first `seconds` of a mix offline and return a 16-bit WAV blob. */
  AN.renderWav = async function (settings, seconds, sampleRate = 44100) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) throw new Error('OfflineAudioContext is not supported in this browser');
    const frames = Math.floor(seconds * sampleRate);
    const ctx = new OAC(2, frames, sampleRate);
    const plan = AN.compose(settings);
    const engine = new AN.Engine(ctx, plan, settings, { offline: true });
    engine.transport.renderRange(seconds);
    // fade the render's tail so it ends cleanly
    engine.graph.master.gain.setValueAtTime(settings.volume, Math.max(0, seconds - 3));
    engine.graph.master.gain.linearRampToValueAtTime(0, seconds - 0.05);
    const buffer = await ctx.startRendering();
    return AN.encodeWav(buffer);
  };

  AN.encodeWav = function (buffer) {
    const numCh = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * numCh * 2, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
        o += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  };

  AN.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  };

  AN.Recorder = Recorder;
})(typeof globalThis !== 'undefined' ? globalThis : this);
