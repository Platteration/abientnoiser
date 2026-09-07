/* Recording (live, via MediaRecorder) and offline WAV rendering. */
(function (root) {
  const AN = root.AN = root.AN || {};

  class Recorder {
    constructor(output) {
      this.graph = output;
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

  /**
   * Render `seconds` of a mix offline into a 16-bit WAV blob.
   *
   * Long exports are rendered in chunks so a full hour never has to fit in one
   * AudioBuffer. Each chunk after the first is rendered with a lead-in that is
   * then discarded: seeking into the middle of a movement re-arms its pad and
   * drone envelopes, and the lead-in gives them time to reach full level, so the
   * joins are inaudible.
   *
   * @param {object} settings mix settings
   * @param {number} seconds  total length to render
   * @param {object} [opts]   { sampleRate, chunkSeconds, preroll, onProgress(fraction, renderedSeconds), shouldCancel() }
   */
  AN.renderWav = async function (settings, seconds, opts = {}) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) throw new Error('OfflineAudioContext is not supported in this browser');
    const sampleRate = opts.sampleRate || 44100;
    const preroll = opts.preroll == null ? 20 : opts.preroll;
    const chunkLen = Math.max(30, Math.min(seconds, opts.chunkSeconds || 300));
    const chunkCount = Math.max(1, Math.ceil(seconds / chunkLen));
    const plan = AN.compose(settings);
    const parts = [];
    let frames = 0;

    for (let i = 0; i < chunkCount; i++) {
      if (opts.shouldCancel && opts.shouldCancel()) throw new Error('cancelled');
      const from = i * chunkLen;
      const len = Math.min(chunkLen, seconds - from);
      const lead = i === 0 ? 0 : Math.min(preroll, from);
      const total = lead + len;
      const ctx = new OAC(2, Math.round(total * sampleRate), sampleRate);
      const engine = new AN.Engine(ctx, plan, settings, { offline: true });
      engine.transport.renderRange(total, from - lead);
      if (i === chunkCount - 1) { // fade the very end so the file does not stop mid-note
        const g = engine.graph.master.gain;
        g.setValueAtTime(settings.volume, Math.max(0, total - 3));
        g.linearRampToValueAtTime(0, Math.max(0.01, total - 0.05));
      }
      const buf = await ctx.startRendering();
      const skip = Math.round(lead * sampleRate);
      parts.push(new Blob([AN.pcm16(buf, skip)]));
      frames += buf.length - skip;
      if (opts.onProgress) opts.onProgress((i + 1) / chunkCount, from + len);
      await new Promise((r) => setTimeout(r, 0)); // let the page repaint between chunks
    }
    return new Blob([AN.wavHeader(frames, 2, sampleRate), ...parts], { type: 'audio/wav' });
  };

  /** 44-byte RIFF/WAVE header for `frames` frames of 16-bit PCM. */
  AN.wavHeader = function (frames, channels, sampleRate) {
    const ab = new ArrayBuffer(44);
    const v = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    const dataBytes = frames * channels * 2;
    str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataBytes, true);
    return ab;
  };

  /** Interleaved 16-bit PCM for an AudioBuffer, skipping the first `skip` frames. */
  AN.pcm16 = function (buffer, skip = 0) {
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const n = buffer.length - skip;
    const ab = new ArrayBuffer(n * chans.length * 2);
    const view = new DataView(ab);
    let o = 0;
    for (let i = skip; i < buffer.length; i++) {
      for (let c = 0; c < chans.length; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
        o += 2;
      }
    }
    return ab;
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
