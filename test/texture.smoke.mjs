/* Each environment texture must occupy the frequency range its name claims.
 * Renders every texture on its own and measures where its energy actually sits —
 * the check that catches a bed quietly dominated by inaudible rumble, or a
 * texture that stops making sound at all.
 * Run: npm run test:textures */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_GLOBAL_MODULES || '/opt/node22/lib/node_modules', 'playwright'))); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 5900 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.js')], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let serverGone = null;
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
server.on('exit', (code, signal) => { serverGone = `static server exited early (code ${code}, signal ${signal})`; });
let ready = false;
for (let i = 0; i < 60 && !ready && !serverGone; i++) {
  try { ready = (await fetch(`http://localhost:${port}/index.html`)).ok; } catch { /* not up yet */ }
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) { console.error(`static server never came up on port ${port}\n${serverLog}`); server.kill(); process.exit(1); }

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

/* What each texture claims to be. `bright` is the share of energy above 1 kHz,
 * `low` the share below 400 Hz. Bounds are set well inside measured values. */
const CLAIMS = {
  rain:     { bright: 40 },
  creek:    { bright: 70 },
  birds:    { bright: 80 },
  crickets: { bright: 80 },
  chimes:   { bright: 30 },
  vinyl:    { bright: 45 },   // a crackle, not a hum: this caught a 50 Hz rumble carrying 87% of the layer
  wind:     { low: 60 },
  waves:    { low: 55 },
  fire:     { low: 70 },
  train:    { low: 70 },
  cafe:     { low: 40 },
  thunder:  { sparse: true }, // too rare to measure in a short window; counted instead
};

try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.seg');

  const measured = await page.evaluate(async (CLAIMS) => {
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k], ui = im[i + k];
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
            re[i + k] = ur + vr; im[i + k] = ui + vi;
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }
    // Put the piece in conditions where even the rare textures are definitely
    // active — a bright morning movement — rather than hoping a sparse one fires
    // inside the window. Birds go from ~2 expected events to ~15.
    const solo = (id) => {
      const s = AN.defaultSettings('night');
      s.seed = 'texture'; s.volume = 1;
      s.daypart = 'morning';
      s.edits = { 0: { mood: 'lift', minutes: 5 } };
      for (const l of AN.MUSIC_LAYERS) s.levels[l.id] = 0;
      for (const l of AN.AMBIENCE_LAYERS) s.levels[l.id] = l.id === id ? 1 : 0;
      return s;
    };

    const out = [];
    for (const layer of AN.AMBIENCE_LAYERS) {
      const claim = CLAIMS[layer.id] || {};
      if (claim.sparse) { // count events over a long stretch instead of measuring a short one
        const s = solo(layer.id);
        const ctx = new OfflineAudioContext(1, 128, 8000);
        const engine = new AN.Engine(ctx, AN.compose(s), s, { offline: true });
        const tex = engine.textures[layer.id];
        let events = 0;
        const real = tex.strike.bind(tex);
        tex.strike = (t, rng) => { events++; real(t, rng); };
        engine.transport.renderRange(30 * 60);
        out.push({ id: layer.id, name: layer.name, events });
        continue;
      }
      const sr = 32000, seconds = 60;
      const ctx = new OfflineAudioContext(1, sr * seconds, sr);
      const s = solo(layer.id);
      const engine = new AN.Engine(ctx, AN.compose(s), s, { offline: true });
      engine.transport.renderRange(seconds);
      const d = (await ctx.startRendering()).getChannelData(0);

      const N = 4096, mag = new Float64Array(N / 2);
      let windows = 0;
      for (let start = sr * 3; start + N < d.length; start += N * 2) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = d[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
        fft(re, im);
        for (let k = 0; k < N / 2; k++) mag[k] += Math.hypot(re[k], im[k]);
        windows++;
      }
      const energy = (lo, hi) => {
        let e = 0;
        for (let k = Math.round(lo * N / sr); k < Math.min(N / 2, Math.round(hi * N / sr)); k++) e += (mag[k] / windows) ** 2;
        return e;
      };
      const total = energy(20, sr / 2) || 1;
      let peak = 0;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      out.push({
        id: layer.id, name: layer.name, peak: +peak.toFixed(4),
        bright: +(100 * energy(1000, sr / 2) / total).toFixed(1),
        low: +(100 * energy(20, 400) / total).toFixed(1),
      });
    }
    return out;
  }, CLAIMS);

  for (const m of measured) {
    const claim = CLAIMS[m.id] || {};
    if (claim.sparse) {
      check(m.events >= 2, `${m.name} fires (${m.events} in half an hour of piece time)`);
      continue;
    }
    check(m.peak > 0.01, `${m.name} makes a sound (peak ${m.peak})`);
    if (claim.bright != null) {
      check(m.bright >= claim.bright,
        `${m.name} sits where it should: ${m.bright}% of its energy above 1 kHz (needs ${claim.bright}%)`);
    }
    if (claim.low != null) {
      check(m.low >= claim.low,
        `${m.name} sits where it should: ${m.low}% of its energy below 400 Hz (needs ${claim.low}%)`);
    }
  }
  // the tone control must actually open the voice filters, not just exist
  const tone = await page.evaluate(async () => {
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k], ui = im[i + k];
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
            re[i + k] = ur + vr; im[i + k] = ui + vi;
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }
    const centroid = async (style, toneValue) => {
      const s = AN.defaultSettings(style);
      s.seed = 'tone'; s.volume = 1; s.tone = toneValue;
      for (const l of AN.AMBIENCE_LAYERS) s.levels[l.id] = 0; // music only: this is about the voices
      const sr = 32000, seconds = 25;
      const ctx = new OfflineAudioContext(1, sr * seconds, sr);
      const engine = new AN.Engine(ctx, AN.compose(s), s, { offline: true });
      engine.transport.renderRange(seconds);
      const d = (await ctx.startRendering()).getChannelData(0);
      const N = 4096, mag = new Float64Array(N / 2);
      let w = 0;
      for (let start = sr * 4; start + N < d.length; start += N * 2) {
        const re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < N; i++) re[i] = d[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
        fft(re, im);
        for (let k = 0; k < N / 2; k++) mag[k] += Math.hypot(re[k], im[k]);
        w++;
      }
      let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { const a = mag[k] / w; num += a * (k * sr / N); den += a; }
      return Math.round(num / (den || 1));
    };
    const out = {};
    for (const style of ['ambient', 'lofi']) {
      out[style] = [];
      for (const t of [0.6, 1, 2.5]) out[style].push(await centroid(style, t));
    }
    return out;
  });
  for (const style of Object.keys(tone)) {
    const [dark, neutral, bright] = tone[style];
    check(dark < neutral && neutral < bright && bright > dark * 1.3,
      `tone opens up ${style}: spectral centroid ${dark} → ${neutral} → ${bright} Hz across the control`);
  }

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  if (serverGone) console.error(`${serverGone}\n${serverLog}`);
  console.error(e);
  failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall texture checks passed');
process.exit(failures ? 1 : 0);
