/* UI glue: settings, mixer, timeline, library, recording. */
(function () {
  const AN = window.AN;
  const $ = (id) => document.getElementById(id);
  const ACCENTS = {
    ambient: '#7cc4ff', lofi: '#f0a35e', focus: '#7ee0b8', space: '#b48cff',
    night: '#6aa0ff', nocturne: '#a8b4ff', synthwave: '#ff8ad1', jazz: '#e8c46a',
  };
  const DURATIONS = [30, 45, 60, 90, 120];
  const SECTION_MINS = [2, 3, 4, 5, 6, 8];

  const state = {
    settings: null, plan: null, engine: null, recorder: null, sleepAt: null,
    wavBusy: false, lastSectionIdx: -1, lastAriaSecond: -1, queue: [], queueIndex: 0,
    mixStartedAt: performance.now(), sleepStopAt: null,
  };
  const THEMES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light'], ['black', 'OLED black']];
  const DAYPARTS = [['', 'Off'], ['auto', 'Follow the clock'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening'], ['night', 'Night']];
  const POMODOROS = [[0, 'Off'], [25, '25 + 5 min'], [50, '50 + 10 min'], [90, '90 + 20 min']];
  const BREAK_DUCK = { drums: 0.12, melody: 0.3, arp: 0.2, bass: 0.55, pads: 0.85 };
  const VISUALS = [['on', 'On'], ['off', 'Off']];
  const QUEUE_EVERY = [[0, 'The whole loop'], [10, '10 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']];
  const CROSSFADES = [4, 8, 15, 30];
  const SLEEP_FADE = 20; // seconds of fade before the sleep timer stops playback
  const PRESETS = [
    ['Rainy window', { rain: 0.55, thunder: 0.12, wind: 0.1 }],
    ['Thunderstorm', { rain: 0.8, thunder: 0.6, wind: 0.35 }],
    ['Campfire night', { fire: 0.5, crickets: 0.35, wind: 0.1 }],
    ['Café', { cafe: 0.45, vinyl: 0.2 }],
    ['Seaside', { waves: 0.5, wind: 0.25, birds: 0.15 }],
    ['Forest creek', { creek: 0.45, birds: 0.3, wind: 0.15 }],
    ['Night train', { train: 0.45, rain: 0.2 }],
    ['Chimes on the porch', { chimes: 0.5, wind: 0.2, crickets: 0.2 }],
    ['Silence', {}],
  ];

  // ---------- init ----------
  function init() {
    const fromUrl = new URLSearchParams(location.search).get('mix');
    state.settings = (fromUrl && AN.storage.decodeShare(fromUrl)) || AN.storage.loadAutosave() || AN.defaultSettings('ambient');
    if (fromUrl) history.replaceState(null, '', location.pathname);
    state.plan = AN.compose(state.settings);

    initTheme();
    initVisuals();
    registerServiceWorker();
    buildStyles();
    buildSelect($('duration'), DURATIONS, (v) => `${v} min`, state.settings.durationMin);
    buildSelect($('sectionMin'), SECTION_MINS, (v) => `${v} min`, state.settings.sectionMin);
    buildSelect($('sleep'), [0, 25, 45, 60, 90, 120], (v) => (v ? `${v} min` : 'Off'), 0);
    buildSelect($('daypart'), DAYPARTS.map((d) => d[0]), (v) => DAYPARTS.find((d) => d[0] === v)[1], state.settings.daypart || '');
    buildSelect($('pomodoro'), POMODOROS.map((p) => p[0]), (v) => POMODOROS.find((p) => Number(p[0]) === Number(v))[1], 0);
    buildWavLengths();
    buildSelect($('queueEvery'), QUEUE_EVERY.map((q) => q[0]), (v) => QUEUE_EVERY.find((q) => Number(q[0]) === Number(v))[1], AN.storage.prefs().queueEvery || 0);
    buildSelect($('crossfade'), CROSSFADES, (v) => `${v} s`, AN.storage.prefs().crossfade || 8);
    state.queue = (AN.storage.prefs().queue || []).filter((id) => AN.storage.get(id));
    state.queueIndex = 0;
    buildPresets();
    buildMixer($('musicMixer'), AN.MUSIC_LAYERS);
    buildMixer($('ambienceMixer'), AN.AMBIENCE_LAYERS);
    $('seed').value = state.settings.seed;
    $('volume').value = Math.round(state.settings.volume * 100);
    applyAccent();
    renderPlan();
    renderLibrary();
    renderQueue();
    bind();
    if (AN.storage.prefs().quiet) setQuiet(true);
    if (!AN.Recorder.supported()) { $('record').disabled = true; $('recStatus').textContent = 'Recording not supported in this browser'; }
    requestAnimationFrame(tickUI);
    state.logic = AN.ticker(500, tickLogic);
  }

  /** Export lengths, capped at the loop length, plus the whole loop. */
  function buildWavLengths() {
    const total = state.settings.durationMin;
    const opts = [1, 3, 5, 10, 20, 30, 45, 60, 90, 120].filter((m) => m < total);
    opts.push(total);
    const current = Number($('wavMinutes').value) || 3;
    buildSelect($('wavMinutes'), opts, (v) => (v === total ? `Whole loop (${v} min, ~${Math.round(v * 10.1)} MB)` : `${v} min`),
      opts.includes(current) ? current : opts[Math.min(1, opts.length - 1)]);
  }

  function buildSelect(sel, values, label, current) {
    sel.innerHTML = '';
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label(v);
      if (String(v) === String(current)) o.selected = true; // values may be strings; Number() would compare NaN
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

  /** One-click environment combinations. Every texture not named is turned off. */
  function buildPresets() {
    const wrap = $('presets');
    wrap.innerHTML = '';
    for (const [name, levels] of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost sm';
      b.textContent = name;
      b.addEventListener('click', () => {
        const next = {};
        for (const l of AN.AMBIENCE_LAYERS) next[l.id] = levels[l.id] || 0;
        Object.assign(state.settings.levels, next);
        refreshMixer();
        if (state.engine) state.engine.applyLevels(next, state.engine.ctx.currentTime);
        autosave();
        toast(name === 'Silence' ? 'Environment off' : `Environment: ${name.toLowerCase()}`);
      });
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

  // ---------- visualiser ----------
  function initVisuals() {
    const stored = AN.storage.prefs().visuals;
    const pref = stored === 'on' || stored === 'off' ? stored : (prefersReducedMotion() ? 'off' : 'on');
    buildSelect($('visuals'), VISUALS.map((v) => v[0]), (v) => VISUALS.find((x) => x[0] === v)[1], pref);
    state.visual = new AN.Visualizer($('visual'), () => state.engine);
    state.visual.setEnabled(pref === 'on');
  }

  function applyVisuals() {
    const on = $('visuals').value === 'on';
    AN.storage.setPref('visuals', on ? 'on' : 'off');
    state.visual.setEnabled(on);
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ---------- offline ----------
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
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
    } catch { /* MediaMetadata unavailable */ }
    if (!state.mediaBound) {
      state.mediaBound = true;
      const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
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
      } catch { /* position state rejected */ }
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

  // ---------- steering ----------
  /** Jump to the nearest movement that is calmer (dir < 0) or brighter (dir > 0). */
  function steer(dir) {
    const engine = ensureEngine();
    if (!engine) return;
    const cur = AN.sectionAt(state.plan, engine.transport.now());
    const list = state.plan.sections;
    for (let k = 1; k <= list.length; k++) {
      const s = list[(cur.index + k) % list.length];
      const better = dir < 0 ? s.intensity < cur.intensity - 0.08 : s.intensity > cur.intensity + 0.08;
      if (better) {
        if (engine.transport.lock != null) setLock(false);
        seekTo(s.start);
        return toast(`${dir < 0 ? 'Calmer' : 'Lifting'}: ${s.name}`);
      }
    }
    toast(`Nothing ${dir < 0 ? 'calmer' : 'brighter'} in this piece — try a new seed`);
  }

  function setLock(on) {
    const engine = ensureEngine();
    if (!engine) return;
    const t = engine.transport;
    const cur = AN.sectionAt(state.plan, t.now());
    t.setLock(on ? cur.index : null);
    $('lock').classList.toggle('active', on);
    $('lock').textContent = on ? '🔒 Locked' : '🔓 Lock';
    if (on) toast(`Repeating “${cur.name}”`);
  }

  // ---------- focus timer ----------
  function setPomodoro(minutes) {
    const engine = state.engine;
    if (!minutes) {
      state.pomo = null;
      $('pomoStatus').textContent = '';
      document.body.classList.remove('pomo-break');
      if (engine) engine.setDuck({}, engine.ctx.currentTime);
      return;
    }
    const conf = { 25: 5, 50: 10, 90: 20 }[minutes] || Math.round(minutes / 5);
    state.pomo = { work: minutes * 60, brk: conf * 60, phase: 'work', endsAt: Date.now() + minutes * 60000, cycles: 0 };
    document.body.classList.remove('pomo-break');
    if (engine) engine.setDuck({}, engine.ctx.currentTime);
    toast(`Focus timer: ${minutes} min of work, then ${conf}`);
  }

  function tickPomodoro() {
    const p = state.pomo;
    if (!p) return;
    const engine = state.engine;
    const playing = !!(engine && engine.transport.playing);
    const left = (p.endsAt - Date.now()) / 1000;
    if (left <= 0) {
      const toBreak = p.phase === 'work';
      p.phase = toBreak ? 'break' : 'work';
      if (!toBreak) p.cycles++;
      p.endsAt = Date.now() + (toBreak ? p.brk : p.work) * 1000;
      document.body.classList.toggle('pomo-break', toBreak);
      if (engine) {
        engine.setDuck(toBreak ? BREAK_DUCK : {}, engine.ctx.currentTime);
        if (playing) engine.chime(!toBreak);
      }
      toast(toBreak ? 'Break — the music steps back' : 'Back to work');
    }
    const label = p.phase === 'work' ? 'Work' : 'Break';
    $('pomoStatus').textContent = `${label} ${AN.formatTime(Math.max(0, (p.endsAt - Date.now()) / 1000))}${p.cycles ? ` · ${p.cycles} done` : ''}`;
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

  function recompose(opts = {}) {
    const keepAt = opts.keep && state.engine ? state.engine.transport.now() : 0;
    state.plan = AN.compose(state.settings);
    if (state.engine) {
      state.engine.transport.setLock(null);
      $('lock').classList.remove('active');
      $('lock').textContent = '🔓 Lock';
      state.engine.applyLevels(state.settings.levels, state.engine.ctx.currentTime);
      state.engine.setPlan(state.plan, state.settings, Math.min(keepAt, state.plan.duration - 1));
    }
    state.lastSectionIdx = -1;
    renderPlan();
    buildWavLengths();
    autosave();
  }

  /** Point every control at state.settings without rebuilding the plan. */
  function syncControls() {
    $('seed').value = state.settings.seed;
    $('volume').value = Math.round(state.settings.volume * 100);
    $('daypart').value = state.settings.daypart || '';
    buildSelect($('duration'), DURATIONS.includes(state.settings.durationMin) ? DURATIONS : DURATIONS.concat([state.settings.durationMin]).sort((a, b) => a - b), (v) => `${v} min`, state.settings.durationMin);
    buildSelect($('sectionMin'), SECTION_MINS.includes(state.settings.sectionMin) ? SECTION_MINS : SECTION_MINS.concat([state.settings.sectionMin]).sort((a, b) => a - b), (v) => `${v} min`, state.settings.sectionMin);
    refreshMixer();
    applyAccent();
    buildWavLengths();
  }

  function applySettings(s) {
    state.settings = AN.storage.cleanSettings(s);
    syncControls();
    if (state.engine) state.engine.setVolume(state.settings.volume, state.engine.ctx.currentTime);
    recompose();
  }

  // ---------- engine ----------
  function ensureEngine() {
    if (state.engine) return state.engine;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { toast('Web Audio is not supported in this browser'); return null; }
    let ctx;
    try { ctx = new Ctx({ latencyHint: 'playback' }); } catch { ctx = new Ctx(); }
    state.ctx = ctx;
    state.output = new AN.Output(ctx);
    state.engine = newEngine();
    state.recorder = AN.Recorder.supported() ? new AN.Recorder(state.output) : null;
    return state.engine;
  }

  function newEngine() {
    const engine = new AN.Engine(state.ctx, state.plan, state.settings, { output: state.output });
    engine.transport.onLoop = (n) => toast(`Loop ${n + 1} — starting over, seamlessly`);
    return engine;
  }

  // ---------- queue ----------
  function saveQueue() {
    AN.storage.setPref('queue', state.queue);
    AN.storage.setPref('queueEvery', Number($('queueEvery').value) || 0);
    AN.storage.setPref('crossfade', Number($('crossfade').value) || 8);
  }

  function renderQueue() {
    const list = $('queueList');
    list.innerHTML = '';
    $('queueEmpty').hidden = state.queue.length > 0;
    $('queueNow').disabled = state.queue.length === 0;
    state.queue.forEach((id, i) => {
      const mix = AN.storage.get(id);
      if (!mix) return;
      const st = AN.STYLES[mix.settings.style] || AN.STYLES.ambient;
      const li = document.createElement('li');
      if (i === state.queueIndex % Math.max(1, state.queue.length)) li.className = 'next';
      li.innerHTML = `<span class="qname">${st.icon} ${escapeHtml(mix.name)}</span>
        <span class="qmeta">${st.name}</span>
        <button type="button" class="ghost sm up" title="Move up">↑</button>
        <button type="button" class="ghost sm out" title="Remove from queue">✕</button>`;
      li.querySelector('.up').addEventListener('click', () => {
        if (i === 0) return;
        [state.queue[i - 1], state.queue[i]] = [state.queue[i], state.queue[i - 1]];
        saveQueue(); renderQueue();
      });
      li.querySelector('.out').addEventListener('click', () => {
        state.queue.splice(i, 1);
        if (state.queueIndex > state.queue.length) state.queueIndex = 0;
        saveQueue(); renderQueue();
      });
      list.appendChild(li);
    });
  }

  function enqueue(id) {
    if (state.queue.includes(id)) return toast('Already in the queue');
    state.queue.push(id);
    saveQueue();
    renderQueue();
    const mix = AN.storage.get(id);
    toast(`Queued “${mix ? mix.name : 'mix'}”`);
  }

  /** Bring the next queued mix in over `fade` seconds, both pieces sounding at once. */
  function crossfadeTo(settings, fade) {
    const engine = ensureEngine();
    if (!engine) return;
    const old = engine;
    state.settings = AN.storage.cleanSettings(settings);
    state.plan = AN.compose(state.settings);
    state.editing = null;
    const next = newEngine();
    state.engine = next;
    $('lock').classList.remove('active');
    $('lock').textContent = '🔓 Lock';
    next.transport.play({ fade });
    old.transport.dispose(fade);
    state.crossfadeUntil = performance.now() + fade * 1000;
    state.mixStartedAt = performance.now();
    syncControls();
    renderPlan();
    updatePlayButton();
  }

  function advanceQueue() {
    if (!state.queue.length) return;
    const fade = Number($('crossfade').value) || 8;
    const id = state.queue[state.queueIndex % state.queue.length];
    state.queueIndex = (state.queueIndex + 1) % state.queue.length;
    const mix = AN.storage.get(id);
    if (!mix) {
      state.queue = state.queue.filter((q) => q !== id);
      saveQueue(); renderQueue();
      return;
    }
    crossfadeTo(mix.settings, fade);
    renderQueue();
    toast(`Crossfading into “${mix.name}”`);
  }

  function tickQueue() {
    if (!state.queue.length || !state.engine || !state.engine.transport.playing) return;
    if (state.crossfadeUntil && performance.now() < state.crossfadeUntil) return;
    const fade = Number($('crossfade').value) || 8;
    const every = Number($('queueEvery').value) || 0;
    if (every) {
      if (performance.now() - (state.mixStartedAt || 0) >= every * 60000) advanceQueue();
      return;
    }
    const t = state.engine.transport;
    if (t.duration > fade * 3 && t.duration - t.now() <= fade) advanceQueue();
  }

  function togglePlay() {
    const engine = ensureEngine();
    if (!engine) return;
    if (!engine.transport.playing) state.mixStartedAt = performance.now();
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
    if (engine.transport.lock != null) setLock(false); // going somewhere else releases the repeat
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
    $('planSummary').textContent = `${plan.sections.length} movements · ${plan.styleName} · key of ${AN.theory.keyName(plan.keyRoot)} · ~${plan.tempo} bpm${plan.daypartName ? ` · ${plan.daypartName.toLowerCase()}` : ''}${plan.editCount ? ` · ${plan.editCount} edited` : ''}`;
    $('resetEdits').hidden = !plan.editCount;
    const list = $('sectionList');
    list.innerHTML = '';
    for (const s of plan.sections) {
      const li = document.createElement('li');
      li.dataset.index = s.index;
      li.className = s.edited ? 'edited' : '';
      li.innerHTML = `<button type="button" class="jump" title="Jump here">${AN.formatTime(s.start)}</button>
        <span class="swatch" style="background:hsl(${s.hue} 45% ${28 + s.intensity * 30}%)"></span>
        <span class="sname">${escapeHtml(s.name)}${s.edited ? ' <span class="pill">edited</span>' : ''}</span>
        <button type="button" class="edit" title="Change this movement">✎</button>
        <span class="sinfo">${s.keyName} ${s.mode} · ${escapeHtml(s.chordNames.join(' – '))} · ${s.tempo} bpm · ${AN.formatTime(s.length)}</span>`;
      li.querySelector('.jump').addEventListener('click', () => seekTo(s.start));
      li.querySelector('.edit').addEventListener('click', () => openEditor(s.index));
      list.appendChild(li);
      if (state.editing === s.index) li.appendChild(buildEditor(s));
    }
    updateNow(0, true);
  }

  function updateNow(pos, force) {
    const s = AN.sectionAt(state.plan, pos);
    const playing = !!(state.engine && state.engine.transport.playing);
    $('elapsed').textContent = AN.formatTime(pos);
    $('playhead').style.left = `${(pos / state.plan.duration) * 100}%`;
    const second = Math.round(pos);
    if (second !== state.lastAriaSecond) { // once a second, not once a frame
      state.lastAriaSecond = second;
      const tl = $('timeline');
      tl.setAttribute('aria-valuemax', Math.round(state.plan.duration));
      tl.setAttribute('aria-valuenow', second);
      tl.setAttribute('aria-valuetext', `${AN.formatTime(pos)} of ${AN.formatTime(state.plan.duration)}, ${s.name}`);
    }
    const remaining = s.end - pos;
    const next = state.plan.sections[(s.index + 1) % state.plan.sections.length];
    $('nextMood').textContent = playing ? `Next: ${next.name} in ${AN.formatTime(remaining)}` : 'Press play — or pick a movement below';
    if (force || s.index !== state.lastSectionIdx) {
      state.lastSectionIdx = s.index;
      document.documentElement.style.setProperty('--mood-hue', s.hue);
      if (state.visual) state.visual.setSection(s);
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

  /** Drawing only. Paused by the browser in background tabs, which is fine. */
  function tickUI() {
    const engine = state.engine;
    updateNow(engine ? engine.transport.now() : 0, false);
    if (state.recorder && state.recorder.recording) {
      $('recStatus').textContent = `Recording… ${AN.formatTime(state.recorder.elapsed)}`;
    }
    requestAnimationFrame(tickUI);
  }

  /** Everything that must keep working while the tab is hidden. */
  function tickLogic() {
    tickPomodoro();
    tickQueue();
    tickSleep();
  }

  function tickSleep() {
    const engine = state.engine;
    if (state.sleepStopAt) { // fading out
      if (Date.now() >= state.sleepStopAt) {
        state.sleepStopAt = null;
        // leave the master at zero: play() ramps it back up from silence
        if (engine) engine.transport.pause();
        updatePlayButton();
        $('sleepStatus').textContent = '';
        toast('Sleep timer: stopped');
      } else {
        $('sleepStatus').textContent = `Fading out… ${AN.formatTime((state.sleepStopAt - Date.now()) / 1000)}`;
      }
      return;
    }
    if (!state.sleepAt || !engine || !engine.transport.playing) return;
    const left = (state.sleepAt - Date.now()) / 1000;
    if (left > 0) {
      $('sleepStatus').textContent = `Stops in ${AN.formatTime(left)}`;
      return;
    }
    state.sleepAt = null;
    $('sleep').value = '0';
    engine.transport.fadeOut(SLEEP_FADE);
    state.sleepStopAt = Date.now() + SLEEP_FADE * 1000;
  }

  // ---------- per-movement editing ----------
  function openEditor(index) {
    state.editing = state.editing === index ? null : index;
    renderPlan();
    const open = document.querySelector('#sectionList .editor');
    if (open) open.scrollIntoView({ block: 'nearest' });
  }

  function editOf(index) {
    if (!state.settings.edits) state.settings.edits = {};
    return state.settings.edits[index] || (state.settings.edits[index] = {});
  }

  function setEdit(index, key, value) {
    const e = editOf(index);
    if (value === '' || value == null) delete e[key]; else e[key] = value;
    if (!Object.keys(e).length) delete state.settings.edits[index];
    state.settings = AN.storage.cleanSettings(state.settings);
    recompose({ keep: true });
  }

  function buildEditor(section) {
    const wrap = document.createElement('div');
    wrap.className = 'editor';
    const e = (state.settings.edits && state.settings.edits[section.index]) || {};
    const field = (label, options, current, onChange) => {
      const l = document.createElement('label');
      l.innerHTML = `<span>${label}</span>`;
      const sel = document.createElement('select');
      for (const [value, text] of options) {
        const o = document.createElement('option');
        o.value = value; o.textContent = text;
        if (String(value) === String(current == null ? '' : current)) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      l.appendChild(sel);
      wrap.appendChild(l);
    };

    field('Mood', [['', `Auto (${section.moodId})`]].concat(Object.keys(AN.MOODS).map((m) => [m, m])),
      e.mood, (v) => setEdit(section.index, 'mood', v));
    field('Key', [['', `Auto (${section.keyName})`]].concat(AN.theory.NOTE_NAMES.map((nm, i) => [i, nm])),
      e.keyRoot, (v) => setEdit(section.index, 'keyRoot', v === '' ? '' : Number(v)));
    field('Mode', [['', `Auto (${section.mode})`]].concat(Object.keys(AN.theory.MODES).map((m) => [m, m])),
      e.mode, (v) => setEdit(section.index, 'mode', v));
    field('Length', [['', `Auto (${Math.round(section.length / 60)} min)`]].concat([1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((m) => [m, `${m} min`])),
      e.minutes, (v) => setEdit(section.index, 'minutes', v === '' ? '' : Number(v)));

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'ghost sm';
    reset.textContent = 'Reset movement';
    reset.disabled = !Object.keys(e).length;
    reset.addEventListener('click', () => {
      if (state.settings.edits) delete state.settings.edits[section.index];
      recompose({ keep: true });
    });
    wrap.appendChild(reset);
    return wrap;
  }

  function resetAllEdits() {
    state.settings.edits = {};
    state.editing = null;
    recompose({ keep: true });
    toast('All movement edits cleared');
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
          <button type="button" class="ghost sm enqueue" title="Add to the queue">＋</button>
          <button type="button" class="ghost sm share" title="Copy share link">Link</button>
          <button type="button" class="ghost sm del" title="Delete">✕</button>
        </div>`;
      li.querySelector('.load').addEventListener('click', () => { applySettings(m.settings); toast(`Loaded “${m.name}”`); });
      li.querySelector('.enqueue').addEventListener('click', () => enqueue(m.id));
      li.querySelector('.share').addEventListener('click', () => copyShare(m.settings));
      li.querySelector('.del').addEventListener('click', () => {
        if (!confirm(`Delete “${m.name}”?`)) return;
        AN.storage.remove(m.id);
        state.queue = state.queue.filter((q) => q !== m.id);
        saveQueue();
        renderLibrary();
        renderQueue();
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
    catch { prompt('Copy this link', url); }
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
    if (!engine.transport.playing) {
      state.mixStartedAt = performance.now();
      engine.transport.play();
      updatePlayButton();
    }
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
    state.wavCancel = false;
    $('wav').disabled = true;
    $('wavCancel').hidden = false;
    $('wavProgress').hidden = false;
    $('wavProgress').value = 0;
    $('wavStatus').textContent = `Rendering ${minutes} min…`;
    const started = performance.now();
    try {
      const blob = await AN.renderWav(state.settings, minutes * 60, {
        shouldCancel: () => state.wavCancel,
        onProgress: (fraction, done) => {
          $('wavProgress').value = fraction;
          const elapsed = (performance.now() - started) / 1000;
          const left = fraction > 0 ? elapsed / fraction - elapsed : 0;
          $('wavStatus').textContent = `Rendered ${AN.formatTime(done)} of ${minutes}:00${left > 2 ? ` · about ${AN.formatTime(left)} left` : ''}`;
        },
      });
      AN.download(blob, `${fileStem()}-${minutes}min.wav`);
      $('wavStatus').textContent = `Done in ${((performance.now() - started) / 1000).toFixed(0)} s · ${(blob.size / 1048576).toFixed(0)} MB`;
    } catch (e) {
      $('wavStatus').textContent = e.message === 'cancelled' ? 'Export cancelled' : `Failed: ${e.message}`;
    } finally {
      state.wavBusy = false;
      state.wavCancel = false;
      $('wav').disabled = false;
      $('wavCancel').hidden = true;
      $('wavProgress').hidden = true;
    }
  }

  // ---------- misc ----------
  function resumeIfInterrupted() {
    const engine = state.engine;
    if (document.hidden || !engine || !engine.transport.playing) return;
    if (engine.ctx.state === 'suspended' && engine.ctx.resume) {
      engine.ctx.resume().then(() => engine.transport.schedule()).catch(() => { /* needs a fresh gesture */ });
    }
  }

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
    $('visuals').addEventListener('change', applyVisuals);
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
    $('calmer').addEventListener('click', () => steer(-1));
    $('lift').addEventListener('click', () => steer(1));
    $('skip').addEventListener('click', () => jumpMovement(1));
    $('lock').addEventListener('click', () => setLock(!$('lock').classList.contains('active')));
    $('daypart').addEventListener('change', () => {
      state.settings.daypart = $('daypart').value || null;
      recompose();
      const name = state.plan.daypartName;
      toast(name ? `Coloured for ${name.toLowerCase()}` : 'Time of day off');
    });
    $('pomodoro').addEventListener('change', () => setPomodoro(Number($('pomodoro').value)));
    $('sleep').addEventListener('change', () => {
      const min = Number($('sleep').value);
      if (state.sleepStopAt && state.engine) { // cancel a fade already under way
        state.sleepStopAt = null;
        state.engine.setVolume(state.settings.volume, state.engine.ctx.currentTime);
      }
      state.sleepAt = min ? Date.now() + min * 60000 : null;
      $('sleepStatus').textContent = min ? `Stops in ${AN.formatTime(min * 60)}` : '';
    });
    $('timeline').addEventListener('click', (e) => {
      const r = $('timeline').getBoundingClientRect();
      seekTo(((e.clientX - r.left) / r.width) * state.plan.duration);
    });
    $('timeline').addEventListener('keydown', (e) => {
      const keys = {
        Home: () => seekTo(0),
        End: () => seekTo(state.plan.duration - 1),
        PageUp: () => nudge(-300),
        PageDown: () => nudge(300),
        ArrowUp: () => jumpMovement(1),
        ArrowDown: () => jumpMovement(-1),
      };
      if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });
    $('save').addEventListener('click', () => {
      const name = $('mixName').value.trim() || defaultMixName();
      const saved = AN.storage.save(name, state.settings);
      renderLibrary();
      if (!saved) return toast('Could not save — this browser is blocking local storage');
      $('mixName').value = '';
      toast(`Saved “${name}”`);
    });
    $('mixName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save').click(); });
    $('share').addEventListener('click', () => copyShare(state.settings));
    $('card').addEventListener('click', async () => {
      try {
        const blob = await AN.shareCard(state.plan, state.settings);
        AN.download(blob, `${fileStem()}.png`);
        toast('Image saved');
      } catch (e) { toast(`Could not draw the image: ${e.message}`); }
    });
    $('resetEdits').addEventListener('click', resetAllEdits);
    $('queueEvery').addEventListener('change', () => { saveQueue(); state.mixStartedAt = performance.now(); });
    $('crossfade').addEventListener('change', saveQueue);
    $('queueNow').addEventListener('click', () => { ensureEngine(); advanceQueue(); });
    $('queueClear').addEventListener('click', () => { state.queue = []; state.queueIndex = 0; saveQueue(); renderQueue(); });
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
    $('wavCancel').addEventListener('click', () => { state.wavCancel = true; $('wavStatus').textContent = 'Cancelling…'; });

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
    // mobile suspends the audio context on interruptions; pick playback back up
    document.addEventListener('visibilitychange', resumeIfInterrupted);
    window.addEventListener('focus', resumeIfInterrupted);
  }

  window.AmbientNoiser = {
    state, ACCENTS, ensureEngine, recompose, applySettings, setQuiet, jumpMovement, steer, setLock, setPomodoro,
    openEditor, setEdit, resetAllEdits, enqueue, advanceQueue, crossfadeTo, renderQueue,
  };
  document.addEventListener('DOMContentLoaded', init);
})();
