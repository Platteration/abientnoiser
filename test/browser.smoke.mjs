/* Browser smoke test: loads the app in headless Chromium, renders audio offline
 * for every style and checks the output is audible, finite and not clipping,
 * then drives the live transport across a loop seam.
 * Run: npm run test:browser  (needs playwright + chromium available) */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_GLOBAL_MODULES || '/opt/node22/lib/node_modules', 'playwright'))); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 5199;
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

try {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.seg');

  check((await page.$$('.seg')).length >= 10, 'timeline renders movements');
  const expectedFaders = await page.evaluate(() => AN.MUSIC_LAYERS.length + AN.AMBIENCE_LAYERS.length);
  check((await page.$$('.fader')).length === expectedFaders, `mixer shows all ${expectedFaders} layers`);

  // offline render of each style with plenty of environment sound
  const styles = await page.evaluate(() => Object.keys(AN.STYLES));
  for (const style of styles) {
    const r = await page.evaluate(async (style) => {
      const s = AN.defaultSettings(style);
      s.seed = 'smoke-' + style;
      for (const l of AN.AMBIENCE_LAYERS) s.levels[l.id] = 0.4;
      Object.assign(s.levels, { melody: 0.8, arp: 0.8 });
      const sr = 22050, seconds = 24;
      const ctx = new OfflineAudioContext(2, seconds * sr, sr);
      const plan = AN.compose(s);
      const engine = new AN.Engine(ctx, plan, s);
      const t0 = performance.now();
      engine.transport.renderRange(seconds);
      const steps = engine.transport.stepIndex;
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, nan = 0, firstLoud = -1;
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (!Number.isFinite(v)) { nan++; continue; }
        const a = Math.abs(v); if (a > peak) peak = a; sum += v * v;
        if (firstLoud < 0 && a > 0.02) firstLoud = i / sr;
      }
      // tail RMS (last 4 s) to confirm continued activity
      let tail = 0; for (let i = d.length - 4 * sr; i < d.length; i++) tail += d[i] * d[i];
      return { peak, rms: Math.sqrt(sum / d.length), tailRms: Math.sqrt(tail / (4 * sr)), nan, steps, firstLoud, ms: performance.now() - t0, sections: plan.sections.length };
    }, style);
    const ok = r.nan === 0 && r.rms > 0.01 && r.peak < 1.0 && r.tailRms > 0.005 && r.steps > 20;
    check(ok, `${style}: rms ${r.rms.toFixed(3)} peak ${r.peak.toFixed(3)} tail ${r.tailRms.toFixed(3)} nan ${r.nan} steps ${r.steps} onset ${r.firstLoud.toFixed(2)}s render ${r.ms.toFixed(0)}ms`);
  }

  // determinism: two renders of the same settings are identical
  const same = await page.evaluate(async () => {
    const render = async () => {
      const s = AN.defaultSettings('lofi'); s.seed = 'det'; s.levels.vinyl = 0.5; s.levels.rain = 0.3;
      const ctx = new OfflineAudioContext(1, 22050 * 6, 22050);
      const engine = new AN.Engine(ctx, AN.compose(s), s);
      engine.transport.renderRange(6);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const a = await render(), b = await render();
    let diff = 0; for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    return diff;
  });
  check(same < 1e-6, `offline render is deterministic (max diff ${same})`);

  // loop seam: 5 min piece rendered for 5 min 10 s, crossing the seam
  const seam = await page.evaluate(async () => {
    const s = AN.defaultSettings('ambient'); s.seed = 'seam'; s.durationMin = 5; s.sectionMin = 1; s.levels.rain = 0.3;
    const sr = 8000, seconds = 5 * 60 + 10;
    const ctx = new OfflineAudioContext(1, seconds * sr, sr);
    const plan = AN.compose(s);
    const engine = new AN.Engine(ctx, plan, s);
    let loops = 0; engine.transport.onLoop = () => loops++;
    engine.transport.renderRange(seconds);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let around = 0; for (let i = (300 - 2) * sr; i < (300 + 2) * sr; i++) around += d[i] * d[i];
    let nan = 0; for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) nan++;
    return { loops, seamRms: Math.sqrt(around / (4 * sr)), nan, sections: plan.sections.length };
  });
  check(seam.loops === 1 && seam.nan === 0 && seam.seamRms > 0.005, `loop seam crossed: loops ${seam.loops} rms@seam ${seam.seamRms.toFixed(3)} sections ${seam.sections}`);

  // live transport
  await page.click('#play');
  await page.waitForTimeout(2500);
  const live = await page.evaluate(() => {
    const t = AmbientNoiser.state.engine.transport;
    return { playing: t.playing, pos: t.now(), ctxState: t.ctx.state, sources: AmbientNoiser.state.engine.graph.sources.size, moodName: document.getElementById('moodName').textContent };
  });
  check(live.playing && live.pos > 1.5 && live.pos < 4, `live transport advances (pos ${live.pos.toFixed(2)}s, ctx ${live.ctxState}, ${live.sources} live sources, mood "${live.moodName}")`);

  // seek near the end of the loop and cross the seam live
  await page.evaluate(() => AmbientNoiser.state.engine.transport.seek(AmbientNoiser.state.plan.duration - 2));
  await page.waitForTimeout(3500);
  const wrapped = await page.evaluate(() => ({ pos: AmbientNoiser.state.engine.transport.now(), loops: AmbientNoiser.state.engine.transport.loops }));
  check(wrapped.pos > 0.5 && wrapped.pos < 4 && wrapped.loops === 1, `live loop wrap (pos ${wrapped.pos.toFixed(2)}s, loops ${wrapped.loops})`);

  // pause kills sources
  await page.click('#play');
  await page.waitForTimeout(700);
  const paused = await page.evaluate(() => ({ playing: AmbientNoiser.state.engine.transport.playing, sources: AmbientNoiser.state.engine.graph.sources.size }));
  check(!paused.playing && paused.sources === 0, `pause stops everything (${paused.sources} sources left)`);

  // save / reload a mix
  await page.fill('#mixName', 'Smoke mix');
  await page.click('#save');
  check((await page.$$('#mixList li')).length === 1, 'mix saved to library');
  await page.click('#dice');
  const seedBefore = await page.inputValue('#seed');
  await page.click('#mixList .load');
  const seedAfter = await page.inputValue('#seed');
  check(seedBefore !== seedAfter, `loading a mix restores its seed (${seedAfter})`);
  const share = await page.evaluate(() => AN.storage.decodeShare(AN.storage.encodeShare(AmbientNoiser.state.settings)));
  check(share && share.seed === seedAfter, 'share code round-trips');

  // style switch while playing
  await page.click('#play');
  await page.click('.style[data-style="lofi"]');
  await page.waitForTimeout(1500);
  const lofi = await page.evaluate(() => ({ style: AmbientNoiser.state.plan.style, playing: AmbientNoiser.state.engine.transport.playing, pos: AmbientNoiser.state.engine.transport.now() }));
  check(lofi.style === 'lofi' && lofi.playing && lofi.pos > 0.5, `style switch while playing restarts (pos ${lofi.pos.toFixed(2)}s)`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
