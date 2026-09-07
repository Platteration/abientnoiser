/* UI glue: settings, mixer, timeline, library, recording. */
(function () {
  const AN = window.AN;
  const $ = (id) => document.getElementById(id);
  const ACCENTS = { ambient: '#7cc4ff', lofi: '#f0a35e', focus: '#7ee0b8', space: '#b48cff', night: '#6aa0ff' };
  const DURATIONS = [30, 45, 60, 90, 120];
  const SECTION_MINS = [2, 3, 4, 5, 6, 8];

  const state = { settings: null, plan: null, engine: null, recorder: null, sleepAt: null, wavBusy: false, lastSectionIdx: -1 };
  const THEMES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light'], ['black', 'OLED black']];

  // ---------- init ----------
  function init() {
    const fromUrl = new URLSearchParams(location.search).get('mix');
    state.settings = (fromUrl && AN.storage.decodeShare(fromUrl)) || AN.storage.loadAutosave() || AN.defaultSettings('ambient');
    if (fromUrl) history.replaceState(null, '', location.pathname);
    state.plan = AN.compose(state.settings);

    initTheme();
    buildStyles();
    buildSelect($('duration'), DURATIONS, (v) => `${v} min`, state.settings.durationMin);
    buildSelect($('sectionMin'), SECTION_MINS, (v) => `${v} min`, state.settings.sectionMin);
    buildSelect($('sleep'), [0, 25, 45, 60, 90, 120], (v) => (v ? `${v} min` : 'Off'), 0);
    buildSelect($('wavMinutes'), [1, 2, 3, 5, 10], (v) => `${v} min`, 3);
    buildMixer($('musicMixer'), AN.MUSIC_LAYERS);
    buildMixer($('ambienceMixer'), AN.AMBIENCE_LAYERS);
    $('seed').value = state.settings.seed;
    $('volume').value = Math.round(state.settings.volume * 100);
    applyAccent();
    renderPlan();
    renderLibrary();
    bind();
    if (AN.storage.prefs().quiet) setQuiet(true);
    if (!AN.Recorder.supported()) { $('record').disabled = true; $('recStatus').textContent = 'Recording not supported in this browser'; }
    requestAnimationFrame(tick);
  }

  function buildSelect(sel, values, label, current) {
    sel.innerHTML = '';
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label(v);
      if (Number(v) === Number(current)) o.selected = true;
      sel.appendChild(o);
    }
  }

  function buildStyles() {
    const wrap = $('styles');
    wrap.innerHTML = '';
    for (const id of Object.keys(AN.STYLES)) {
      const st = AN.STYLES[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'style' + (id === state.settings.style ? ' active' : '');
      b.dataset.style = id;
      b.style.setProperty('--accent', ACCENTS[id]);
      b.innerHTML = `<span class="icon">${st.icon}</span><span class="name">${st.name}</span><span class="desc">${st.desc}</span>`;
      b.addEventListener('click', () => setStyle(id));
      wrap.appendChild(b);
    }
  }

  function buildMixer(wrap, layers) {
    wrap.innerHTML = '';
    for (const l of layers) {
      const row = document.createElement('label');
      row.className = 'fader';
      const v = Math.round((state.settings.levels[l.id] || 0) * 100);
      row.innerHTML = `<span class="fname">${l.name}</span><input type="range" min="0" max="100" value="${v}" data-layer="${l.id}"><span class="fval">${v}</span>`;
      const input = row.querySelector('input');
      input.addEventListener('input', () => {
        const lv = Number(input.value) / 100;
        row.querySelector('.fval').textContent = input.value;
        row.classList.toggle('off', lv === 0);
        state.settings.levels[l.id] = lv;
        if (state.engine) state.engine.applyLevels({ [l.id]: lv }, state.engine.ctx.currentTime);
        autosave();
      });
      row.classList.toggle('off', v === 0);
      wrap.appendChild(row);
    }
  }

  function refreshMixer() {
    document.querySelectorAll('.fader input').forEach((input) => {
      const v = Math.round((state.settings.levels[input.dataset.layer] || 0) * 100);
      input.value = v;
      input.parentElement.querySelector('.fval').textContent = v;
      input.parentElement.classList.toggle('off', v === 0);
    });
  }

  function applyAccent() {
    document.documentElement.style.setProperty('--accent', ACCENTS[state.settings.style] || ACCENTS.ambient);
    document.querySelectorAll('.style').forEach((b) => b.classList.toggle('active', b.dataset.style === state.settings.style));
  }

  // ---------- theme ----------
  function initTheme() {
    buildSelect($('theme'), THEMES.map((t) => t[0]), (v) => THEMES.find((t) => t[0] === v)[1], AN.storage.prefs().theme || 'system');
    applyTheme();
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  }

  function applyTheme() {
    const choice = $('theme').value || 'system';
    let theme = choice;
    if (choice === 'system') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.dataset.theme = theme;
    AN.storage.setPref('theme', choice);
  }

  // ---------- quiet mode ----------
  function setQuiet(on) {
    document.body.classList.toggle('quiet', on);
    AN.storage.setPref('quiet', on);
    $('quiet').textContent = on ? 'Exit quiet mode' : 'Quiet mode';
  }

  // ---------- media session ----------
  function updateMediaSession(section) {
    if (!('mediaSession' in navigator)) return;
    const plan = state.plan;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: section.name,
        artist: `${plan.styleName} · ${section.keyName} ${section.mode}`,
        album: `Ambient Noiser · seed ${plan.seed}`,
      });
    } catch (e) { /* MediaMetadata unavailable */ }
    if (!state.mediaBound) {
      state.mediaBound = true;
      const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* unsupported action */ } };
      set('play', () => { if (!state.engine || !state.engine.transport.playing) togglePlay(); });
      set('pause', () => { if (state.engine && state.engine.transport.playing) togglePlay(); });
      set('seekbackward', (d) => nudge(-(d && d.seekOffset ? d.seekOffset : 30)));
      set('seekforward', (d) => nudge(d && d.seekOffset ? d.seekOffset : 30));
      set('seekto', (d) => { if (d && d.seekTime != null) seekTo(d.seekTime); });
      set('previoustrack', () => jumpMovement(-1));
      set('nexttrack', () => jumpMovement(1));
    }
    if (navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration: plan.duration,
          position: Math.min(plan.duration, Math.max(0, state.engine ? state.engine.transport.now() : 0)),
          playbackRate: 1,
        });
      } catch (e) { /* position state rejected */ }
    }
    navigator.mediaSession.playbackState = state.engine && state.engine.transport.playing ? 'playing' : 'paused';
  }

  function nudge(delta) { if (state.engine) seekTo(state.engine.transport.now() + delta); }

  /** Jump to the previous / next movement (previous restarts the current one first). */
  function jumpMovement(dir) {
    const engine = ensureEngine();
    if (!engine) return;
    const pos = engine.transport.now();
    const cur = AN.sectionAt(state.plan, pos);
    if (dir < 0 && pos - cur.start > 4) return seekTo(cur.start);
    const n = state.plan.sections.length;
    const target = state.plan.sections[((cur.index + dir) % n + n) % n];
    seekTo(target.start);
  }

  // ---------- settings changes ----------
  function autosave() { AN.storage.autosave(state.settings); }

  function setStyle(id) {
    if (!AN.STYLES[id]) return;
    state.settings.style = id;
    Object.assign(state.settings.levels, AN.STYLES[id].music); // music layers follow the style; environment stays yours
    refreshMixer();
    applyAccent();
    recompose();
  }

  function recompose() {
    state.plan = AN.compose(state.settings);
    if (state.engine) {
      state.engine.applyLevels(state.settings.levels, state.engine.ctx.currentTime);
      state.engine.setPlan(state.plan, state.settings);
    }
    state.lastSectionIdx = -1;
    renderPlan();
    autosave();
  }

  function applySettings(s) {
    state.settings = AN.storage.cleanSettings(s);
    $('seed').value = state.settings.seed;
    $('volume').value = Math.round(state.settings.volume * 100);
    buildSelect($('duration'), DURATIONS.includes(state.settings.durationMin) ? DURATIONS : DURATIONS.concat([state.settings.durationMin]).sort((a, b) => a - b), (v) => `${v} min`, state.settings.durationMin);
    buildSelect($('sectionMin'), SECTION_MINS.includes(state.settings.sectionMin) ? SECTION_MINS : SECTION_MINS.concat([state.settings.sectionMin]).sort((a, b) => a - b), (v) => `${v} min`, state.settings.sectionMin);
    refreshMixer();
    applyAccent();
    if (state.engine) state.engine.setVolume(state.settings.volume, state.engine.ctx.currentTime);
    recompose();
  }

  // ---------- engine ----------
  function ensureEngine() {
    if (state.engine) return state.engine;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { toast('Web Audio is not supported in this browser'); return null; }
    let ctx;
    try { ctx = new Ctx({ latencyHint: 'playback' }); } catch (e) { ctx = new Ctx(); }
    state.engine = new AN.Engine(ctx, state.plan, state.settings);
    state.engine.transport.onLoop = (n) => toast(`Loop ${n + 1} — starting over, seamlessly`);
    state.recorder = AN.Recorder.supported() ? new AN.Recorder(state.engine.graph) : null;
    return state.engine;
  }

  function togglePlay() {
    const engine = ensureEngine();
    if (!engine) return;
    engine.transport.toggle();
    updatePlayButton();
  }

  function updatePlayButton() {
    const playing = !!(state.engine && state.engine.transport.playing);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    $('play').textContent = playing ? '❚❚' : '▶';
    $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('play').classList.toggle('playing', playing);
    document.body.classList.toggle('is-playing', playing);
  }

  function seekTo(pos) {
    const engine = ensureEngine();
    if (!engine) return;
    engine.transport.seek(pos);
    state.lastSectionIdx = -1;
  }

  // ---------- rendering ----------
  function renderPlan() {
    const plan = state.plan;
    const seg = $('segments');
    seg.innerHTML = '';
    for (const s of plan.sections) {
      const d = document.createElement('div');
      d.className = 'seg';
      d.style.flexGrow = s.length;
      d.style.background = `hsl(${s.hue} 45% ${28 + s.intensity * 30}%)`;
      d.title = `${s.name} · ${s.keyName} ${s.mode} · ${AN.formatTime(s.start)}–${AN.formatTime(s.end)}`;
      d.dataset.index = s.index;
      seg.appendChild(d);
    }
    $('total').textContent = AN.formatTime(plan.duration);
    $('planSummary').textContent = `${plan.sections.length} movements · ${plan.styleName} · key of ${AN.theory.keyName(plan.keyRoot)} · ~${plan.tempo} bpm`;
    const list = $('sectionList');
    list.innerHTML = '';
    for (const s of plan.sections) {
      const li = document.createElement('li');
      li.dataset.index = s.index;
      li.innerHTML = `<button type="button" class="jump" title="Jump here">${AN.formatTime(s.start)}</button>
        <span class="swatch" style="background:hsl(${s.hue} 45% ${28 + s.intensity * 30}%)"></span>
        <span class="sname">${s.name}</span>
        <span class="sinfo">${s.keyName} ${s.mode} · ${s.chordNames.join(' – ')} · ${s.tempo} bpm</span>`;
      li.querySelector('.jump').addEventListener('click', () => seekTo(s.start));
      list.appendChild(li);
    }
    updateNow(0, true);
  }

  function updateNow(pos, force) {
    const s = AN.sectionAt(state.plan, pos);
    const playing = !!(state.engine && state.engine.transport.playing);
    $('elapsed').textContent = AN.formatTime(pos);
    $('playhead').style.left = `${(pos / state.plan.duration) * 100}%`;
    const remaining = s.end - pos;
    const next = state.plan.sections[(s.index + 1) % state.plan.sections.length];
    $('nextMood').textContent = playing ? `Next: ${next.name} in ${AN.formatTime(remaining)}` : 'Press play — or pick a movement below';
    if (force || s.index !== state.lastSectionIdx) {
      state.lastSectionIdx = s.index;
      document.documentElement.style.setProperty('--mood-hue', s.hue);
      document.documentElement.style.setProperty('--mood-strength', `${8 + s.intensity * 16}%`);
      updateMediaSession(s);
      $('moodName').textContent = s.name;
      $('moodTag').textContent = s.moodId;
      $('moodTag').style.background = `hsl(${s.hue} 45% 40%)`;
      $('nowMeta').textContent = `${s.keyName} ${s.mode} · ${s.chordNames.join(' – ')} · ${s.tempo} bpm · movement ${s.index + 1} of ${state.plan.sections.length}`;
      document.querySelectorAll('.seg').forEach((el) => el.classList.toggle('active', Number(el.dataset.index) === s.index));
      document.querySelectorAll('#sectionList li').forEach((el) => el.classList.toggle('active', Number(el.dataset.index) === s.index));
    }
  }

  function tick() {
    const engine = state.engine;
    const pos = engine ? engine.transport.now() : 0;
    updateNow(pos, false);
    if (state.recorder && state.recorder.recording) {
      $('recStatus').textContent = `Recording… ${AN.formatTime(state.recorder.elapsed)}`;
    }
    if (state.sleepAt && engine && engine.transport.playing) {
      const left = (state.sleepAt - Date.now()) / 1000;
      $('sleepStatus').textContent = `Stops in ${AN.formatTime(Math.max(0, left))}`;
      if (left <= 0) { engine.transport.pause(); updatePlayButton(); state.sleepAt = null; $('sleep').value = '0'; $('sleepStatus').textContent = ''; toast('Sleep timer: stopped'); }
    }
    requestAnimationFrame(tick);
  }

  // ---------- library ----------
  function renderLibrary() {
    const list = $('mixList');
    const mixes = AN.storage.list();
    list.innerHTML = '';
    $('libraryEmpty').hidden = mixes.length > 0;
    for (const m of mixes) {
      const st = AN.STYLES[m.settings.style] || AN.STYLES.ambient;
      const env = AN.AMBIENCE_LAYERS.filter((l) => m.settings.levels[l.id] > 0).map((l) => l.name.toLowerCase()).join(', ');
      const li = document.createElement('li');
      li.innerHTML = `<div class="mix-main">
          <button type="button" class="load" title="Load this mix"><span class="icon">${st.icon}</span><span><strong>${escapeHtml(m.name)}</strong><small>${st.name} · ${m.settings.durationMin} min · seed ${escapeHtml(m.settings.seed)}${env ? ' · ' + env : ''}</small></span></button>
        </div>
        <div class="mix-actions">
          <button type="button" class="ghost sm share" title="Copy share link">Link</button>
          <button type="button" class="ghost sm del" title="Delete">✕</button>
        </div>`;
      li.querySelector('.load').addEventListener('click', () => { applySettings(m.settings); toast(`Loaded “${m.name}”`); });
      li.querySelector('.share').addEventListener('click', () => copyShare(m.settings));
      li.querySelector('.del').addEventListener('click', () => {
        if (confirm(`Delete “${m.name}”?`)) { AN.storage.remove(m.id); renderLibrary(); }
      });
      list.appendChild(li);
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function defaultMixName() {
    const s = state.plan.sections[0];
    return `${AN.STYLES[state.settings.style].name} · ${s.name}`;
  }

  async function copyShare(settings) {
    const url = `${location.origin}${location.pathname}?mix=${AN.storage.encodeShare(settings)}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch (e) { prompt('Copy this link', url); }
  }

  // ---------- recording / export ----------
  async function toggleRecord() {
    const engine = ensureEngine();
    if (!engine || !state.recorder) return;
    if (state.recorder.recording) {
      const blob = await state.recorder.stop();
      $('record').textContent = '● Record';
      $('record').classList.remove('rec');
      $('recStatus').textContent = blob ? `Saved ${(blob.size / 1048576).toFixed(1)} MB` : '';
      if (blob) AN.download(blob, `${fileStem()}.${state.recorder.extension()}`);
      return;
    }
    if (!engine.transport.playing) { engine.transport.play(); updatePlayButton(); }
    try {
      state.recorder.start();
      $('record').textContent = '■ Stop';
      $('record').classList.add('rec');
    } catch (e) { toast(`Recording failed: ${e.message}`); }
  }

  function fileStem() {
    return `ambient-noiser-${state.settings.style}-${state.settings.seed}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  }

  async function exportWav() {
    if (state.wavBusy) return;
    const minutes = Number($('wavMinutes').value) || 3;
    state.wavBusy = true;
    $('wav').disabled = true;
    $('wavStatus').textContent = `Rendering ${minutes} min…`;
    const started = performance.now();
    try {
      const blob = await AN.renderWav(state.settings, minutes * 60);
      AN.download(blob, `${fileStem()}-${minutes}min.wav`);
      $('wavStatus').textContent = `Done in ${((performance.now() - started) / 1000).toFixed(0)} s · ${(blob.size / 1048576).toFixed(0)} MB`;
    } catch (e) {
      $('wavStatus').textContent = `Failed: ${e.message}`;
    } finally {
      state.wavBusy = false;
      $('wav').disabled = false;
    }
  }

  // ---------- misc ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function bind() {
    $('play').addEventListener('click', togglePlay);
    $('theme').addEventListener('change', applyTheme);
    $('quiet').addEventListener('click', () => setQuiet(!document.body.classList.contains('quiet')));
    $('quietExit').addEventListener('click', () => setQuiet(false));
    $('dice').addEventListener('click', () => { state.settings.seed = AN.randomSeed(); $('seed').value = state.settings.seed; recompose(); });
    $('seed').addEventListener('change', () => { state.settings.seed = $('seed').value.trim() || AN.randomSeed(); $('seed').value = state.settings.seed; recompose(); });
    $('duration').addEventListener('change', () => { state.settings.durationMin = Number($('duration').value); recompose(); });
    $('sectionMin').addEventListener('change', () => { state.settings.sectionMin = Number($('sectionMin').value); recompose(); });
    $('volume').addEventListener('input', () => {
      state.settings.volume = Number($('volume').value) / 100;
      if (state.engine) state.engine.setVolume(state.settings.volume, state.engine.ctx.currentTime);
      autosave();
    });
    $('sleep').addEventListener('change', () => {
      const min = Number($('sleep').value);
      state.sleepAt = min ? Date.now() + min * 60000 : null;
      $('sleepStatus').textContent = min ? `Stops in ${AN.formatTime(min * 60)}` : '';
    });
    $('timeline').addEventListener('click', (e) => {
      const r = $('timeline').getBoundingClientRect();
      seekTo(((e.clientX - r.left) / r.width) * state.plan.duration);
    });
    $('save').addEventListener('click', () => {
      const name = $('mixName').value.trim() || defaultMixName();
      AN.storage.save(name, state.settings);
      $('mixName').value = '';
      renderLibrary();
      toast(`Saved “${name}”`);
    });
    $('mixName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save').click(); });
    $('share').addEventListener('click', () => copyShare(state.settings));
    $('export').addEventListener('click', () => {
      AN.download(new Blob([AN.storage.exportAll()], { type: 'application/json' }), 'ambient-noiser-mixes.json');
    });
    $('import').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async () => {
      const f = $('importFile').files[0];
      if (!f) return;
      try { const n = AN.storage.importJSON(await f.text()); renderLibrary(); toast(`Imported ${n} mix${n === 1 ? '' : 'es'}`); }
      catch (e) { toast(`Import failed: ${e.message}`); }
      $('importFile').value = '';
    });
    $('record').addEventListener('click', toggleRecord);
    $('wav').addEventListener('click', exportWav);

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' && e.key !== ' ') return;
      if (e.key === ' ' && tag !== 'button') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight') nudge(30);
      else if (e.key === 'ArrowLeft') nudge(-30);
      else if (e.key === 'q' || e.key === 'Q') setQuiet(!document.body.classList.contains('quiet'));
      else if (e.key === 'Escape' && document.body.classList.contains('quiet')) setQuiet(false);
      else if (e.key === 'n' || e.key === 'N') jumpMovement(1);
      else if (e.key === 'p' || e.key === 'P') jumpMovement(-1);
    });
    window.addEventListener('beforeunload', autosave);
  }

  window.AmbientNoiser = { state, ensureEngine, recompose, applySettings, setQuiet, jumpMovement };
  document.addEventListener('DOMContentLoaded', init);
})();
