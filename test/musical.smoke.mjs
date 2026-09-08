/* Musical validity: schedules every style's whole loop, records each note the
 * engine asks for, and checks it is in key, in range and in the right register.
 * The synths are stubbed out, so this only exercises the composer and the
 * performance logic — no audio is rendered, which makes it fast.
 * Run: npm run test:musical */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_GLOBAL_MODULES || '/opt/node22/lib/node_modules', 'playwright'))); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// a fresh port each run: a lingering server from a previous run would
// otherwise keep answering until its shutdown lands, mid-run
const port = 5600 + Math.floor(Math.random() * 300);
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
// wait for it to actually answer rather than guessing at a delay
let ready = false;
for (let i = 0; i < 60 && !ready && !serverGone; i++) {
  try { ready = (await fetch(`http://localhost:${port}/index.html`)).ok; } catch { /* not up yet */ }
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) {
  console.error(`static server never came up on port ${port}\n${serverLog}`);
  server.kill();
  process.exit(1);
}

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// what each layer is allowed to occupy, in MIDI note numbers
const REGISTER = {
  drone: [24, 52], bass: [30, 60], pads: [43, 84], arp: [43, 88], melody: [55, 96],
};

try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector('.seg');

  const report = await page.evaluate(async (REGISTER) => {
    const out = [];
    for (const style of Object.keys(AN.STYLES)) {
      const s = AN.defaultSettings(style);
      s.seed = 'musical'; s.durationMin = 20; s.sectionMin = 2;
      for (const l of AN.MUSIC_LAYERS) s.levels[l.id] = 1;
      const plan = AN.compose(s);
      const ctx = new OfflineAudioContext(1, 128, 16000);
      const engine = new AN.Engine(ctx, plan, s, { offline: true });

      // record what is asked for, and which step asked for it; build nothing
      const notes = [];
      let step = null;
      const realOnStep = engine.onStep.bind(engine);
      engine.onStep = (ev) => { step = ev; realOnStep(ev); step = null; };
      const when = () => (step ? { stepT: step.t, stepLen: step.stepLen, sixteenth: step.sixteenth } : {});

      const real = {};
      for (const k of ['bell', 'ep', 'piano', 'pluck', 'bass', 'pad', 'drone']) {
        real[k] = AN.synths[k];
        AN.synths[k] = (g, layer, o) => {
          const sec = engine.section;
          const list = o.midis || [o.midi];
          for (const midi of list) notes.push({ layer: layer.name, midi, t: o.t, section: sec ? sec.index : -1, ...when() });
        };
      }
      const realDrums = {};
      for (const k of ['kick', 'snare', 'hat', 'shaker', 'rim', 'brush', 'ride', 'clap']) {
        realDrums[k] = AN.drums[k];
        AN.drums[k] = (g, layer, o) => {
          const sec = engine.section;
          notes.push({ layer: 'drums', voice: k, t: o.t, section: sec ? sec.index : -1, ...when() });
        };
      }
      engine.transport.renderRange(plan.duration);
      for (const k in real) AN.synths[k] = real[k];
      for (const k in realDrums) AN.drums[k] = realDrums[k];

      const bad = { range: [], offScale: [], register: [], timing: [] };
      // How far a note may sit after its own step: swing, plus a rolled chord's
      // spread, plus the small humanising jitter. Nothing may sit before it.
      const EARLY = 0.02, ROLL = 0.09;
      const steps = [];
      let approach = 0, walkNotes = 0, lastWalk = null;
      for (const n of notes) {
        const sec = plan.sections[n.section];
        if (!sec) { bad.range.push(`${n.layer} in no section`); continue; }

        // timing: every voice must land on its own step, swung forward only
        if (n.stepT != null) {
          // Swing delays a note; it never pulls one earlier. Deriving the bound from
          // the section's own swing would let a negative swing excuse itself, so the
          // lower bound is absolute: nothing may sound before the step that asked for it.
          const swung = Math.max(0, n.sixteenth % 2 === 1 ? (sec.swing - 0.5) * 2 * n.stepLen : 0);
          const offset = n.t - n.stepT;
          if (offset < -EARLY || offset > swung + ROLL) {
            bad.timing.push(`${n.voice || n.layer} on 16th ${n.sixteenth}: ${(offset * 1000).toFixed(0)}ms`
              + ` from its step, allowed ${(-EARLY * 1000).toFixed(0)}..${((swung + ROLL) * 1000).toFixed(0)}ms`
              + ` (step ${(n.stepLen * 1000).toFixed(0)}ms)`);
          }
        }
        if (n.midi === undefined) continue; // a drum hit: timing only

        if (!Number.isFinite(n.midi)) { bad.range.push(`${n.layer} ${n.midi}`); continue; }
        const band = REGISTER[n.layer];
        if (band && (n.midi < band[0] || n.midi > band[1])) bad.register.push(`${n.layer} ${n.midi}`);
        const degree = ((n.midi - (60 + sec.keyRoot)) % 12 + 12) % 12;
        const inScale = AN.theory.MODES[sec.mode].includes(degree);
        const walking = n.layer === 'bass' && sec.bassStyle === 'walk';
        if (walking) {
          walkNotes++;
          if (lastWalk !== null) steps.push(Math.abs(n.midi - lastWalk));
          lastWalk = n.midi;
        }
        if (inScale) continue;
        if (walking) { // a chromatic approach into the next chord is the point
          approach++;
          const scaleTones = AN.theory.MODES[sec.mode];
          const near = scaleTones.some((d) => Math.min((d - degree + 12) % 12, (degree - d + 12) % 12) <= 2);
          if (!near) bad.offScale.push(`${n.layer} ${n.midi} far from ${sec.keyName} ${sec.mode}`);
          continue;
        }
        bad.offScale.push(`${n.layer} ${AN.theory.NOTE_NAMES[n.midi % 12]} not in ${sec.keyName} ${sec.mode}`);
      }
      out.push({
        style, total: notes.length, drums: notes.filter((n) => n.layer === 'drums').length, bad, walkNotes, approach,
        stepsOk: steps.length ? steps.filter((d) => d <= 7).length / steps.length : 1,
        maxStep: steps.length ? Math.max(...steps) : 0,
      });
    }
    return out;
  }, REGISTER);

  for (const r of report) {
    const label = `${r.style} (${r.total} notes)`;
    check(r.total > 500, `${label}: the loop produces notes`);
    check(r.bad.range.length === 0, `${label}: every note is a real MIDI number${r.bad.range.length ? ' — ' + r.bad.range.slice(0, 3).join(', ') : ''}`);
    check(r.bad.register.length === 0, `${label}: every layer stays in its register${r.bad.register.length ? ' — ' + r.bad.register.slice(0, 3).join(', ') : ''}`);
    check(r.bad.offScale.length === 0, `${label}: every note is in key${r.bad.offScale.length ? ' — ' + r.bad.offScale.slice(0, 3).join(', ') : ''}`);
    check(r.bad.timing.length === 0, `${label}: every voice lands on its own step, swung forward only`
      + `${r.drums ? `, drums included (${r.drums} hits)` : ''}`
      + `${r.bad.timing.length ? ' — ' + r.bad.timing.slice(0, 3).join('; ') : ''}`);
    if (r.walkNotes) {
      check(r.approach / r.walkNotes < 0.3, `${label}: walking bass uses approach notes sparingly (${(100 * r.approach / r.walkNotes).toFixed(0)}%)`);
      check(r.stepsOk > 0.95, `${label}: the bass walks rather than leaps (${(100 * r.stepsOk).toFixed(1)}% of steps within a fifth, largest ${r.maxStep})`);
    }
  }

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  if (serverGone) console.error(`${serverGone}\n--- server output ---\n${serverLog}`);
  console.error(e);
  failures++;
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall musical checks passed');
process.exit(failures ? 1 : 0);
