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
// keep the static server's output: if it dies mid-run every later navigation
// fails with a bare connection error, which is otherwise a mystery
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.js')], {
  env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
let serverGone = null;
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
server.on('exit', (code, signal) => { serverGone = `static server exited early (code ${code}, signal ${signal})`; });
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
  // Two renders of the same settings must be identical to the ear. They are not bit-exact:
  // Chromium's own float mixing of many concurrent sources varies slightly run to run, so the
  // bar is one 16-bit quantisation step (2^-15), which is what an exported WAV can represent.
  const QUANTISE = 1 / 32768;
  check(same < QUANTISE, `offline render repeats identically (max diff ${same.toExponential(1)}, under 16-bit step ${QUANTISE.toExponential(1)})`);

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

  // steering: calmer / lift / lock
  await page.evaluate(() => AmbientNoiser.state.engine.transport.seek(0));
  const steered = await page.evaluate(async () => {
    const before = AN.sectionAt(AmbientNoiser.state.plan, AmbientNoiser.state.engine.transport.now());
    AmbientNoiser.steer(1);
    const up = AN.sectionAt(AmbientNoiser.state.plan, AmbientNoiser.state.engine.transport.now());
    AmbientNoiser.steer(-1);
    const down = AN.sectionAt(AmbientNoiser.state.plan, AmbientNoiser.state.engine.transport.now());
    return { before: before.intensity, up: up.intensity, down: down.intensity };
  });
  check(steered.up > steered.before && steered.down < steered.up, `steering moves between movements (${steered.before.toFixed(2)} -> ${steered.up.toFixed(2)} -> ${steered.down.toFixed(2)})`);

  // Locking must hold the movement whether it is set well before the end or inside
  // the scheduler's lookahead window, and the reported position must never leave it.
  const locked = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const runs = [];
    for (const lead of [4, 1]) {
      const t = AmbientNoiser.state.engine.transport;
      t.setLock(null);
      if (!t.playing) t.play();
      await wait(300);
      const sec = AN.sectionAt(AmbientNoiser.state.plan, t.now());
      t.seek(sec.end - lead);
      await wait(400); // let the scheduler queue its lookahead past the boundary
      const queuedPastEnd = t.cursor - t.baseCtx >= sec.end;
      AmbientNoiser.setLock(true);
      const strayed = [];
      let quietest = Infinity;
      for (let i = 0; i < 14; i++) {
        await wait(200);
        const pos = t.now();
        if (pos < sec.start || pos >= sec.end) strayed.push(+pos.toFixed(2));
        quietest = Math.min(quietest, AmbientNoiser.state.engine.graph.sources.size);
      }
      runs.push({ lead, section: sec.index, queuedPastEnd, strayed, quietest, ended: AN.sectionAt(AmbientNoiser.state.plan, t.now()).index });
      AmbientNoiser.setLock(false);
    }
    return runs;
  });
  for (const run of locked) {
    check(run.ended === run.section && run.strayed.length === 0 && run.quietest > 0,
      `lock holds movement ${run.section + 1} when set ${run.lead}s before its end`
      + `${run.queuedPastEnd ? ' (scheduler already past the boundary)' : ''}`
      + `, no gap (min ${run.quietest} sources)`
      + `${run.strayed.length ? ` — clock strayed to ${run.strayed.slice(0, 3).join(', ')}` : ''}`);
  }

  // focus timer ducks the mix on a break and restores it after
  const pomo = await page.evaluate(async () => {
    const e = AmbientNoiser.state.engine;
    AmbientNoiser.setPomodoro(25);
    const before = e.graph.layers.drums.user.gain.value;
    AmbientNoiser.state.pomo.endsAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 900)); // the logic ticker runs twice a second
    const onBreak = e.duck.drums;
    AmbientNoiser.state.pomo.endsAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 900));
    const back = Object.keys(e.duck).length;
    AmbientNoiser.setPomodoro(0);
    return { before, onBreak, back, phase: AmbientNoiser.state.pomo === null };
  });
  check(pomo.onBreak > 0 && pomo.onBreak < 1 && pomo.back === 0, `focus timer ducks on a break (drums x${pomo.onBreak}) and restores after`);

  // time of day changes the plan
  const daypart = await page.evaluate(() => {
    const base = { seed: 'clock', style: 'ambient', durationMin: 40, sectionMin: 4 };
    const off = AN.compose(base).sections.map((s) => s.moodId).join(',');
    const night = AN.compose(Object.assign({}, base, { daypart: 'night' }));
    const morning = AN.compose(Object.assign({}, base, { daypart: 'morning' }));
    return { off, night: night.sections.map((s) => s.moodId).join(','), label: night.daypartName,
      nightBirds: night.sections[0].ambience.birds, morningBirds: morning.sections[0].ambience.birds };
  });
  check(daypart.off !== daypart.night && daypart.label === 'Night' && daypart.nightBirds < daypart.morningBirds,
    `time of day recolours the plan (night birds ${daypart.nightBirds.toFixed(2)} < morning ${daypart.morningBirds.toFixed(2)})`);

  // the visualiser actually paints while playing
  const vis = await page.evaluate(async () => {
    const cv = document.getElementById('visual');
    AmbientNoiser.state.visual.setEnabled(true);
    if (!AmbientNoiser.state.engine.transport.playing) AmbientNoiser.state.engine.transport.play();
    await new Promise((r) => setTimeout(r, 900));
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let painted = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 4) painted++;
    return { w: cv.width, h: cv.height, painted, hasAnalyser: !!AmbientNoiser.state.engine.graph.analyser };
  });
  check(vis.w > 100 && vis.painted > 20 && vis.hasAnalyser, `visualiser paints (${vis.w}x${vis.h}, ${vis.painted} sampled pixels lit)`);

  const visOff = await page.evaluate(() => {
    AmbientNoiser.state.visual.setEnabled(false);
    const hidden = document.getElementById('visual').hidden;
    AmbientNoiser.state.visual.setEnabled(true);
    return hidden;
  });
  check(visOff, 'visualiser can be turned off');

  // chunked WAV export: correct header, exact length, and no clicks at the joins
  const wav = await page.evaluate(async () => {
    const s = AN.defaultSettings('lofi');
    s.seed = 'export'; s.durationMin = 10; s.levels.rain = 0.3;
    const sampleRate = 16000, seconds = 120, chunkSeconds = 40;
    const progress = [];
    const blob = await AN.renderWav(s, seconds, {
      sampleRate, chunkSeconds, preroll: 10, onProgress: (f, done) => progress.push([f, done]),
    });
    const ab = await blob.arrayBuffer();
    const v = new DataView(ab);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const header = {
      riff: tag(0), wave: tag(8), fmt: tag(12), data: tag(36),
      channels: v.getUint16(22, true), rate: v.getUint32(24, true), bits: v.getUint16(34, true),
      dataBytes: v.getUint32(40, true), riffSize: v.getUint32(4, true), size: ab.byteLength,
    };

    // decode and look for discontinuities at the chunk joins
    const ctx = new OfflineAudioContext(1, 1, sampleRate);
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const d = buf.getChannelData(0);
    const rms = (from, to) => {
      let sum = 0, n = 0;
      for (let i = Math.max(0, Math.floor(from * sampleRate)); i < Math.min(d.length, Math.floor(to * sampleRate)); i++) { sum += d[i] * d[i]; n++; }
      return n ? Math.sqrt(sum / n) : 0;
    };
    let globalStep = 0;
    for (let i = 1; i < d.length; i++) globalStep = Math.max(globalStep, Math.abs(d[i] - d[i - 1]));
    const seams = [];
    for (let t = chunkSeconds; t < seconds; t += chunkSeconds) {
      let step = 0;
      const c = Math.floor(t * sampleRate);
      for (let i = c - 40; i < c + 40; i++) if (i > 0) step = Math.max(step, Math.abs(d[i] - d[i - 1]));
      seams.push({ t, before: rms(t - 0.6, t), after: rms(t, t + 0.6), step });
    }
    return { header, frames: buf.length, seconds: buf.duration, globalStep, seams, chunks: progress.length };
  });
  const h = wav.header;
  const headerOk = h.riff === 'RIFF' && h.wave === 'WAVE' && h.fmt === 'fmt ' && h.data === 'data'
    && h.channels === 2 && h.rate === 16000 && h.bits === 16
    && h.dataBytes === 120 * 16000 * 2 * 2 && h.riffSize === h.size - 8;
  check(headerOk, `export writes a valid 2 ch / 16 kHz / 16-bit WAV header (${(h.size / 1048576).toFixed(1)} MB, ${h.dataBytes} data bytes)`);
  check(Math.abs(wav.seconds - 120) < 0.01 && wav.chunks === 3, `export is exactly ${wav.seconds.toFixed(2)} s from ${wav.chunks} chunks`);
  const seamOk = wav.seams.every((s) => s.before > 0.002 && s.after > 0.002
    && s.after / s.before < 6 && s.before / s.after < 6
    && s.step <= wav.globalStep * 1.05);
  check(seamOk, `chunk joins are continuous (${wav.seams.map((s) => `${s.t}s ${s.before.toFixed(3)}->${s.after.toFixed(3)}`).join(', ')})`);

  // per-movement editing
  await page.evaluate(() => AmbientNoiser.resetAllEdits());
  const edited = await page.evaluate(() => {
    AmbientNoiser.setEdit(1, 'mood', 'tension');
    AmbientNoiser.setEdit(1, 'minutes', 6);
    AmbientNoiser.setEdit(1, 'mode', 'phrygian');
    const p = AmbientNoiser.state.plan;
    return {
      mood: p.sections[1].moodId, mode: p.sections[1].mode, minutes: p.sections[1].length / 60,
      total: p.sections.reduce((a, s) => a + s.length, 0), duration: p.duration,
      editCount: p.editCount, edited: p.sections[1].edited,
      contiguous: p.sections.every((s, i) => i === 0 || s.start === p.sections[i - 1].end),
    };
  });
  check(edited.mood === 'tension' && edited.mode === 'phrygian' && Math.abs(edited.minutes - 6) < 0.02
    && edited.total === edited.duration && edited.contiguous && edited.editCount === 1,
    `movement edits apply and keep the loop exactly ${edited.duration / 60} min (movement 2 is now ${edited.minutes} min of ${edited.mood})`);

  const editRoundTrip = await page.evaluate(() => {
    const code = AN.storage.encodeShare(AmbientNoiser.state.settings);
    const back = AN.storage.decodeShare(code);
    const plan = AN.compose(back);
    return { mood: plan.sections[1].moodId, minutes: plan.sections[1].length / 60, count: plan.editCount };
  });
  check(editRoundTrip.mood === 'tension' && Math.abs(editRoundTrip.minutes - 6) < 0.02,
    'edits survive a share link round trip');

  const editUi = await page.evaluate(() => {
    AmbientNoiser.openEditor(1);
    const n = document.querySelectorAll('#sectionList .editor select').length;
    const pill = document.querySelectorAll('#sectionList li.edited').length;
    AmbientNoiser.openEditor(1);
    return { selects: n, pill, closed: document.querySelectorAll('#sectionList .editor').length };
  });
  check(editUi.selects === 4 && editUi.pill === 1 && editUi.closed === 0, 'the movement editor opens, marks the row and closes again');

  const cleared = await page.evaluate(() => { AmbientNoiser.resetAllEdits(); return AmbientNoiser.state.plan.editCount; });
  check(cleared === 0, 'reset clears every movement edit');

  // share card
  const card = await page.evaluate(async () => {
    const blob = await AN.shareCard(AmbientNoiser.state.plan, AmbientNoiser.state.settings);
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, size: blob.size, w: bmp.width, h: bmp.height };
  });
  check(card.type === 'image/png' && card.w === 1200 && card.h === 630 && card.size > 20000,
    `share card renders a ${card.w}x${card.h} PNG (${(card.size / 1024).toFixed(0)} KB)`);

  // queue with crossfade: two mixes overlap, then the old engine is released
  const queue = await page.evaluate(async () => {
    // two distinct saved mixes
    AmbientNoiser.applySettings(Object.assign(AN.defaultSettings('ambient'), { seed: 'queue-a' }));
    const a = AN.storage.save('Queue A', AmbientNoiser.state.settings);
    AmbientNoiser.applySettings(Object.assign(AN.defaultSettings('lofi'), { seed: 'queue-b' }));
    const b = AN.storage.save('Queue B', AmbientNoiser.state.settings);
    AmbientNoiser.state.queue = [];
    AmbientNoiser.enqueue(a.id);
    AmbientNoiser.enqueue(b.id);
    AmbientNoiser.renderQueue();

    const engine = AmbientNoiser.ensureEngine();
    if (!engine.transport.playing) engine.transport.play();
    await new Promise((r) => setTimeout(r, 600));
    const before = { engine, seed: AmbientNoiser.state.settings.seed, output: engine.graph.output === AmbientNoiser.state.output };

    const t0 = performance.now();
    AmbientNoiser.crossfadeTo(AN.storage.get(a.id).settings, 1.5);
    const buildMs = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 500));
    const during = {
      swapped: AmbientNoiser.state.engine !== before.engine,
      oldStillSounding: before.engine.graph.sources.size > 0,
      newSounding: AmbientNoiser.state.engine.graph.sources.size > 0,
      seed: AmbientNoiser.state.settings.seed,
      seedField: document.getElementById('seed').value,
    };
    await new Promise((r) => setTimeout(r, 2600));
    const after = { oldReleased: before.engine.graph.sources.size === 0, newPlaying: AmbientNoiser.state.engine.transport.playing };
    AmbientNoiser.state.engine.transport.pause();
    return { before, during, after, buildMs, queued: AmbientNoiser.state.queue.length, rows: document.querySelectorAll('#queueList li').length };
  });
  check(queue.before.output, 'engines feed one shared output, so recording and visuals see everything');
  check(queue.during.swapped && queue.during.oldStillSounding && queue.during.newSounding,
    'both mixes sound at once during a crossfade');
  check(queue.during.seed === 'queue-a' && queue.during.seedField === 'queue-a', 'the controls follow the incoming mix');
  check(queue.after.oldReleased && queue.after.newPlaying, 'the outgoing engine is released once the fade ends');
  check(queue.queued === 2 && queue.rows === 2, `queue holds ${queue.queued} mixes`);
  check(queue.buildMs < 400, `building the incoming engine takes ${queue.buildMs.toFixed(0)} ms`);

  // background tab: timers must keep running with no animation frames at all
  const background = await page.evaluate(async () => {
    const engine = AmbientNoiser.ensureEngine();
    AmbientNoiser.state.queue = [];
    if (!engine.transport.playing) engine.transport.play();
    await new Promise((r) => setTimeout(r, 300));

    const realRaf = window.requestAnimationFrame;
    let frames = 0;
    window.requestAnimationFrame = () => { frames++; return 0; }; // a hidden tab grants none
    await new Promise((r) => setTimeout(r, 400));

    // focus timer must still change phase
    AmbientNoiser.setPomodoro(25);
    AmbientNoiser.state.pomo.endsAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 900));
    const pomoAdvanced = AmbientNoiser.state.pomo.phase === 'break';
    AmbientNoiser.setPomodoro(0);

    // sleep timer must still fire, and fade rather than cut
    AmbientNoiser.state.sleepAt = Date.now() - 1;
    await new Promise((r) => setTimeout(r, 900));
    const fading = AmbientNoiser.state.sleepStopAt !== null;
    const gain = engine.graph.master.gain.value;
    AmbientNoiser.state.sleepStopAt = Date.now() - 1; // jump to the end of the fade
    await new Promise((r) => setTimeout(r, 900));
    const stopped = !AmbientNoiser.state.engine.transport.playing;

    window.requestAnimationFrame = realRaf;
    requestAnimationFrame(function loop() { requestAnimationFrame(loop); });
    return { framesRequested: frames, pomoAdvanced, fading, stopped, gain, volume: AmbientNoiser.state.settings.volume };
  });
  check(background.pomoAdvanced && background.fading && background.stopped,
    'focus and sleep timers keep running with no animation frames (a background tab)');
  check(background.gain < background.volume, `the sleep timer fades out rather than cutting (gain ${background.gain.toFixed(3)} of ${background.volume})`);

  // every style has its own accent colour, and the timeline is a real slider
  const accents = await page.evaluate(() => {
    const out = {};
    for (const id of Object.keys(AN.STYLES)) {
      const card = document.querySelector(`.style[data-style="${id}"]`);
      out[id] = (card && card.style.getPropertyValue('--accent')) || '';
    }
    return out;
  });
  const accentValues = Object.values(accents);
  check(accentValues.every((v) => /^#[0-9a-f]{6}$/i.test(v.trim())) && new Set(accentValues).size === accentValues.length,
    `all ${accentValues.length} styles have a distinct accent colour`);

  const slider = await page.evaluate(async () => {
    const tl = document.getElementById('timeline');
    tl.focus();
    const engine = AmbientNoiser.ensureEngine();
    if (!engine.transport.playing) engine.transport.play();
    await new Promise((r) => setTimeout(r, 300));
    tl.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const nearEnd = engine.transport.now();
    tl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    engine.transport.pause();
    return {
      role: tl.getAttribute('role'), focusable: tl.tabIndex === 0,
      max: Number(tl.getAttribute('aria-valuemax')), text: tl.getAttribute('aria-valuetext'),
      nearEnd, backToStart: engine.transport.now(),
      live: document.querySelector('.mood').getAttribute('aria-live'),
    };
  });
  check(slider.role === 'slider' && slider.focusable && slider.max > 0 && /of \d+:\d+/.test(slider.text || ''),
    `timeline is a labelled slider (${slider.text})`);
  check(slider.nearEnd > 60 && slider.backToStart < 5, `timeline keys seek (End -> ${slider.nearEnd.toFixed(0)}s, Home -> ${slider.backToStart.toFixed(1)}s)`);
  check(slider.live === 'polite', 'movement changes are announced to screen readers');

  // under heavy load the incidental one-shots thin out; musical notes never do
  const load = await page.evaluate(async () => {
    const measure = async (full) => {
      const s = AN.defaultSettings('lofi');
      s.seed = 'load';
      for (const l of AN.MUSIC_LAYERS.concat(AN.AMBIENCE_LAYERS)) s.levels[l.id] = full ? 1 : (s.levels[l.id] || 0);
      AmbientNoiser.applySettings(s);
      const e = AmbientNoiser.ensureEngine();
      e.graph.dropped = 0;
      e.transport.play();
      let peak = 0;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        peak = Math.max(peak, AmbientNoiser.state.engine.graph.sources.size);
      }
      const dropped = AmbientNoiser.state.engine.graph.dropped;
      AmbientNoiser.state.engine.transport.pause();
      await new Promise((r) => setTimeout(r, 500));
      return { peak, dropped, limit: AmbientNoiser.state.engine.graph.softLimit };
    };
    const heavy = await measure(true);
    const normal = await measure(false);
    return { heavy, normal };
  });
  check(load.heavy.peak <= load.heavy.limit + 60 && load.heavy.dropped > 0,
    `heavy load is capped near ${load.heavy.limit} sources (peak ${load.heavy.peak}, ${load.heavy.dropped} one-shots skipped)`);
  check(load.normal.dropped === 0 && load.normal.peak < load.heavy.limit,
    `a normal mix never hits the cap (peak ${load.normal.peak} sources, none skipped)`);

  // narrow screens: nothing scrolls sideways and inputs stay usable
  const phone = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await phone.goto(`http://localhost:${port}/`);
  await phone.waitForSelector('.seg');
  const layout = await phone.evaluate(() => {
    const doc = document.documentElement;
    const width = (el) => el.getBoundingClientRect().width;
    // free-text fields need room to type in; selects only need to fit their own label
    const tooNarrow = [
      ...[...document.querySelectorAll('input[type="text"]')].filter((el) => width(el) < 140),
      ...[...document.querySelectorAll('select')].filter((el) => width(el) < 50),
    ].map((el) => `${el.id || el.className} (${Math.round(width(el))}px)`);
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, tooNarrow, faders: document.querySelectorAll('.fader').length };
  });
  await phone.close();
  check(layout.scrollW <= layout.clientW && layout.tooNarrow.length === 0,
    `at ${layout.clientW}px nothing overflows sideways and every field stays usable${layout.tooNarrow.length ? ': ' + layout.tooNarrow.join(', ') : ''}`);

  // environment presets set exactly the named textures and clear the rest
  const preset = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('#presets button')];
    const byName = (n) => buttons.find((b) => b.textContent === n);
    byName('Thunderstorm').click();
    await new Promise((r) => setTimeout(r, 150));
    const storm = {};
    for (const l of AN.AMBIENCE_LAYERS) storm[l.id] = AmbientNoiser.state.settings.levels[l.id];
    const faderMatches = [...document.querySelectorAll('#ambienceMixer input')]
      .every((i) => Math.round(storm[i.dataset.layer] * 100) === Number(i.value));
    byName('Silence').click();
    await new Promise((r) => setTimeout(r, 150));
    const silent = AN.AMBIENCE_LAYERS.every((l) => AmbientNoiser.state.settings.levels[l.id] === 0);
    return { count: buttons.length, rain: storm.rain, thunder: storm.thunder, cafe: storm.cafe, faderMatches, silent };
  });
  check(preset.count >= 8 && preset.rain > 0 && preset.thunder > 0 && preset.cafe === 0 && preset.faderMatches && preset.silent,
    `${preset.count} environment presets set the faders and clear what they do not name`);

  // string-valued selects must restore their stored value, and not overwrite it on load
  const prefsPage = await browser.newPage();
  await prefsPage.goto(`http://localhost:${port}/`);
  await prefsPage.waitForSelector('.seg');
  await prefsPage.selectOption('#theme', 'dark');
  await prefsPage.selectOption('#visuals', 'off');
  await prefsPage.selectOption('#daypart', 'night');
  await prefsPage.reload();
  await prefsPage.waitForSelector('.seg');
  const restored = await prefsPage.evaluate(() => ({
    theme: document.getElementById('theme').value,
    visuals: document.getElementById('visuals').value,
    daypart: document.getElementById('daypart').value,
    storedTheme: AN.storage.prefs().theme,
    storedVisuals: AN.storage.prefs().visuals,
    applied: document.documentElement.dataset.theme,
    visualHidden: document.getElementById('visual').hidden,
  }));
  await prefsPage.close();
  check(restored.theme === 'dark' && restored.storedTheme === 'dark' && restored.applied === 'dark',
    `theme survives a reload (select ${restored.theme}, stored ${restored.storedTheme})`);
  check(restored.visuals === 'off' && restored.storedVisuals === 'off' && restored.visualHidden,
    'the visuals choice survives a reload and matches what is drawn');
  check(restored.daypart === 'night', 'time of day survives a reload');

  // ambience one-shots keep going after the loop seam sends piece time backwards
  const wrapped2 = await page.evaluate(async () => {
    const s = AN.defaultSettings('ambient');
    s.seed = 'wrap-amb'; s.durationMin = 5; s.sectionMin = 1;
    s.levels.crickets = 0.6; s.levels.train = 0.6;
    const ctx = new OfflineAudioContext(1, 8000 * 40, 8000);
    const plan = AN.compose(s);
    const engine = new AN.Engine(ctx, plan, s, { offline: true });
    engine.transport.renderRange(20, plan.duration - 10); // straddle the loop seam
    const { train, crickets } = engine.textures;
    // after wrapping, each texture's cursor must have followed piece time back to the start
    return {
      before: { train: train.nextJoint, crickets: crickets.voices && crickets.voices[0].next },
      duration: plan.duration,
    };
  });
  check(wrapped2.before.train != null && wrapped2.before.train < 30,
    `rail joints re-seed after the loop seam (cursor back to ${wrapped2.before.train.toFixed(1)}s, not stuck near ${wrapped2.duration}s)`);
  check(wrapped2.before.crickets != null && wrapped2.before.crickets < 30,
    `crickets re-seed after the loop seam (cursor ${wrapped2.before.crickets.toFixed(1)}s)`);

  // a discarded engine really lets go of its tape oscillators
  const teardown = await page.evaluate(async () => {
    const ctx = AmbientNoiser.state.engine.ctx;
    const e = new AN.Engine(ctx, AmbientNoiser.state.plan, AmbientNoiser.state.settings, { output: AmbientNoiser.state.output });
    const running = e.graph.tapeRunning;
    e.transport.play({ fade: 0.1 });
    await new Promise((r) => setTimeout(r, 200));
    e.transport.dispose(0.1);
    await new Promise((r) => setTimeout(r, 900));
    e.graph.dispose(ctx.currentTime); // must be safe to call twice
    return { running, stopped: e.graph.tapeRunning === false, disposed: e.graph.disposed, sources: e.graph.sources.size };
  });
  check(teardown.running && teardown.stopped && teardown.disposed && teardown.sources === 0,
    'a discarded engine stops its tape oscillators and releases every source');

  // the whole working state comes back after a reload
  const persist = await browser.newPage();
  await persist.goto(`http://localhost:${port}/`);
  await persist.waitForSelector('.seg');
  const saved = await persist.evaluate(async () => {
    AmbientNoiser.applySettings(Object.assign(AN.defaultSettings('jazz'), {
      seed: 'persist-me', durationMin: 45, sectionMin: 3, daypart: 'evening', volume: 0.42,
    }));
    AmbientNoiser.state.settings.levels.cafe = 0.37;
    AmbientNoiser.state.settings.levels.drums = 0.66;
    AmbientNoiser.setEdit(2, 'mood', 'glow');
    AmbientNoiser.setEdit(2, 'minutes', 5);
    const mix = AN.storage.save('Persisted mix', AmbientNoiser.state.settings);
    AmbientNoiser.state.queue = [];
    AmbientNoiser.enqueue(mix.id);
    document.getElementById('crossfade').value = '15';
    document.getElementById('crossfade').dispatchEvent(new Event('change'));
    AmbientNoiser.setQuiet(true);
    AN.storage.autosave(AmbientNoiser.state.settings);
    return { seed: AmbientNoiser.state.settings.seed, mixId: mix.id };
  });
  await persist.reload();
  await persist.waitForSelector('.seg');
  const back = await persist.evaluate(() => {
    const s = AmbientNoiser.state.settings;
    return {
      seed: s.seed, style: s.style, durationMin: s.durationMin, sectionMin: s.sectionMin,
      daypart: s.daypart, volume: s.volume, cafe: s.levels.cafe, drums: s.levels.drums,
      edit: s.edits && s.edits[2], editCount: AmbientNoiser.state.plan.editCount,
      seedField: document.getElementById('seed').value,
      durationField: document.getElementById('duration').value,
      daypartField: document.getElementById('daypart').value,
      volumeField: document.getElementById('volume').value,
      cafeFader: [...document.querySelectorAll('#ambienceMixer input')].find((i) => i.dataset.layer === 'cafe').value,
      queue: AmbientNoiser.state.queue.length,
      crossfade: document.getElementById('crossfade').value,
      quiet: document.body.classList.contains('quiet'),
      library: AN.storage.list().length,
    };
  });
  await persist.close();
  const settingsBack = back.seed === 'persist-me' && back.style === 'jazz' && back.durationMin === 45
    && back.sectionMin === 3 && back.daypart === 'evening' && Math.abs(back.volume - 0.42) < 0.01
    && Math.abs(back.cafe - 0.37) < 0.01 && Math.abs(back.drums - 0.66) < 0.01;
  check(settingsBack, `settings come back after a reload (${back.style}, ${back.durationMin} min, ${back.daypart}, volume ${back.volume})`);
  check(back.edit && back.edit.mood === 'glow' && back.edit.minutes === 5 && back.editCount === 1,
    'movement edits come back after a reload');
  const fieldsBack = back.seedField === 'persist-me' && Number(back.durationField) === 45
    && back.daypartField === 'evening' && Number(back.volumeField) === 42 && Number(back.cafeFader) === 37;
  check(fieldsBack, `every control shows the restored values (seed ${back.seedField}, volume ${back.volumeField}, café ${back.cafeFader})`);
  check(back.queue === 1 && back.crossfade === '15' && back.quiet && back.library >= 1,
    `queue, crossfade, quiet mode and library survive too (${back.queue} queued, ${back.crossfade}s, ${back.library} saved)`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  if (serverGone) console.error(`${serverGone}\n--- server output ---\n${serverLog}`);
  console.error(e);
  failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
