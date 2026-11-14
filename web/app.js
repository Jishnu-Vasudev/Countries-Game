(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const DATA = window.COUNTRY_DATA;
  const ALL = DATA.countries;
  const { match, byCode } = Match.createMatcher(ALL);
  const REGIONS = [['Africa', 'AF'], ['Asia', 'AS'], ['Europe', 'EU'], ['North America', 'NA'], ['South America', 'SA'], ['Oceania', 'OC']];
  const DEFAULTS = { min: 5, map: true, errors: 'live', penalty: false, typos: true, rivals: false };
  const SILENCE_MS = 14000;
  const HEARTBEAT_MS = 4000;
  const COLLECT_MS = 5000;
  const COUNTDOWN_MS = 3000;

  const me = { id: Math.random().toString(36).slice(2, 12), name: '', rank: 0 };
  let channel = null;
  let players = new Map();     // id -> { id, name, rank, seen, f, w, u, last, done }
  let settings = { ...DEFAULTS };
  let phase = 'home';          // home | lobby | countdown | play | wait | results
  let game = null;             // { id, settings, endAt, roster, found, order, wrong, unclear, entries, last }
  let joining = null;
  let timers = [];
  let openRows = new Set();

  /* Helpers */
  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage may be blocked */ } }
  };
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const buzz = pattern => { if (navigator.vibrate) navigator.vibrate(pattern); };
  const hue = id => [...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  const avatar = p => `<span class="avatar" style="background:hsl(${hue(p.id)} 45% 38%)">${esc((p.name[0] || '?').toUpperCase())}</span>`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function show(screen) {
    document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === screen));
    phase = screen;
  }

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function mapMarkup() {
    let out = `<svg class="map-svg" viewBox="0 0 ${DATA.w} ${DATA.h}" aria-hidden="true"><path class="bg" d="${DATA.bg}"/>`;
    ALL.filter(c => c.d).forEach(c => { out += `<path data-c="${c.c}" d="${c.d}"/>`; });
    ALL.filter(c => c.p).forEach(c => { out += `<circle data-c="${c.c}" cx="${c.p[0]}" cy="${c.p[1]}" r="5"/>`; });
    return out + '</svg>';
  }

  function paintMap(container, code, cls) {
    const el = container.querySelector(`[data-c="${code}"]`);
    if (el) el.classList.add(cls);
  }

  /* Players and roles */
  function self() {
    return { id: me.id, name: me.name, rank: me.rank };
  }

  function livePlayers() {
    const now = Date.now();
    return [...players.values()].filter(p => p.id === me.id || now - p.seen < SILENCE_MS).sort((a, b) => a.rank - b.rank);
  }

  function hostId() {
    const list = livePlayers();
    return list.length ? list[0].id : me.id;
  }

  const isHost = () => hostId() === me.id;

  function touchPlayer(id, name, rank) {
    let p = players.get(id);
    if (!p) { p = { id, name: 'Player', rank: Infinity, seen: 0, f: [], w: [], u: [], last: 0, done: false }; players.set(id, p); }
    if (typeof name === 'string' && name.trim()) p.name = name.trim().slice(0, 16);
    if (typeof rank === 'number' && isFinite(rank)) p.rank = rank;
    p.seen = Date.now();
    return p;
  }

  function cleanSettings(s) {
    s = s || {};
    return {
      min: Math.min(10, Math.max(1, Math.round(Number(s.min)) || DEFAULTS.min)),
      map: !!s.map,
      errors: s.errors === 'after' ? 'after' : 'live',
      penalty: !!s.penalty,
      typos: !!s.typos,
      rivals: !!s.rivals
    };
  }

  function resetProgress(p) {
    p.f = []; p.w = []; p.u = []; p.last = 0; p.done = false;
  }

  const scoreOf = (p, rules) => Math.max(0, p.f.length - (rules.penalty ? p.w.length : 0));

  /* Room lifecycle */
  const handlers = {
    onMessage,
    onStatus(online) { $('netBar').classList.toggle('show', !online); },
    onReconnect() {
      heartbeat();
      if (game) pushProgress(phase === 'wait' || phase === 'results');
    }
  };

  function nameOrComplain() {
    const name = $('nameInput').value.trim();
    if (!name) { $('homeError').textContent = 'Enter your name first'; $('nameInput').focus(); return null; }
    store.set('name', name);
    return name.slice(0, 16);
  }

  function setBusy(busy) {
    $('createBtn').disabled = busy;
    $('joinBtn').disabled = busy;
  }

  async function createRoom() {
    const name = nameOrComplain();
    if (!name) return;
    me.name = name;
    me.rank = 0;
    $('homeError').textContent = '';
    setBusy(true);
    try {
      channel = await Net.createRoom(handlers);
      settings = { ...DEFAULTS };
      enterRoom();
    } catch (e) {
      $('homeError').textContent = 'Could not connect. Check your internet and try again.';
    }
    setBusy(false);
  }

  async function joinRoom() {
    const name = nameOrComplain();
    if (!name) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (!Net.isValidCode(code)) { $('homeError').textContent = 'That room code doesn’t look right'; return; }
    me.name = name;
    me.rank = Date.now();
    $('homeError').textContent = '';
    setBusy(true);
    try {
      channel = await Net.joinRoom(code, handlers);
    } catch (e) {
      $('homeError').textContent = 'Could not connect. Check your internet and try again.';
      setBusy(false);
      return;
    }
    // Ask a few times in case the host's phone is briefly slow.
    let tries = 0;
    const ask = () => channel && channel.send({ t: 'hello', from: me.id, n: me.name, r: me.rank });
    ask();
    joining = setInterval(() => {
      if (++tries < 4) return ask();
      stopJoining();
      failJoin('Room not found. Check the code with your host.');
    }, 2000);
  }

  function stopJoining() {
    clearInterval(joining);
    joining = null;
  }

  function failJoin(text) {
    if (channel) channel.close();
    channel = null;
    $('homeError').textContent = text;
    setBusy(false);
  }

  function enterRoom() {
    players = new Map();
    touchPlayer(me.id, me.name, me.rank);
    timers.forEach(clearInterval);
    timers = [setInterval(heartbeat, HEARTBEAT_MS), setInterval(refreshPresence, 2000)];
    $('roomCode').textContent = channel.code;
    heartbeat();
    showLobby();
  }

  function leaveRoom() {
    stopJoining();
    timers.forEach(clearInterval);
    timers = [];
    clearInterval(tick);
    if (channel) {
      if (game && !game.finished) { game.finished = true; pushProgress(true); }
      channel.send({ t: 'bye', from: me.id });
      channel.close();
    }
    channel = null;
    game = null;
    players = new Map();
    $('netBar').classList.remove('show');
    show('home');
  }

  function heartbeat() {
    if (!channel) return;
    touchPlayer(me.id, me.name, me.rank);
    channel.send({ t: 'hb', from: me.id, n: me.name, r: me.rank, g: game ? game.id : 0, ph: phase });
  }

  function refreshPresence() {
    if (phase === 'lobby') renderLobby();
    if (phase === 'results') renderAgainControls();
  }

  /* Network messages */
  function onMessage(m) {
    if (typeof m.from !== 'string' || m.from === me.id) return;
    if (m.to && m.to !== me.id) return;

    if (joining) {
      if (m.t === 'room' && m.to === me.id) acceptRoom(m);
      else if (m.t === 'busy' && m.to === me.id) { stopJoining(); failJoin('This room is mid-game. Join when the round ends.'); }
      return;
    }

    switch (m.t) {
      case 'hello': onHello(m); break;
      case 'hb': onHeartbeat(m); break;
      case 'bye': players.delete(m.from); if (phase === 'lobby') renderLobby(); break;
      case 'set': if (m.from === hostId()) { settings = cleanSettings(m.s); if (phase === 'lobby') renderLobby(); } break;
      case 'start': onStart(m); break;
      case 'lobby': if (phase === 'results' || phase === 'wait') showLobby(); break;
      case 'p': onProgress(m); break;
    }
  }

  function onHello(m) {
    touchPlayer(m.from, m.n, m.r);
    if (phase === 'lobby') renderLobby();
    if (!isHost()) return;
    if (game && !game.finished) { channel.send({ t: 'busy', from: me.id, to: m.from }); return; }
    channel.send({
      t: 'room', from: me.id, to: m.from, s: settings,
      players: livePlayers().map(p => ({ id: p.id, n: p.name, r: p.rank }))
    });
  }

  function acceptRoom(m) {
    stopJoining();
    setBusy(false);
    enterRoom();
    settings = cleanSettings(m.s);
    if (Array.isArray(m.players)) m.players.forEach(p => { if (p && typeof p.id === 'string') touchPlayer(p.id, p.n, p.r); });
    renderLobby();
  }

  function onHeartbeat(m) {
    const known = players.has(m.from);
    touchPlayer(m.from, m.n, m.r);
    if (phase === 'lobby' && !known) renderLobby();
    if (!isHost()) return;
    // A player who was offline when the round started or ended gets caught up here.
    if (phase === 'play' && game && m.g !== game.id && game.roster.includes(m.from)) {
      channel.send(startMessage(m.from, Math.max(0, game.endAt - Date.now()), 0));
    } else if (phase === 'lobby' && (m.ph === 'results' || m.ph === 'wait')) {
      channel.send({ t: 'lobby', from: me.id, to: m.from });
    }
  }

  function onProgress(m) {
    if (!game || m.g !== game.id) return;
    const p = touchPlayer(m.from, m.n, m.r);
    const strings = (list, limit) => Array.isArray(list) ? list.filter(s => typeof s === 'string').slice(0, limit).map(s => s.slice(0, 40)) : [];
    p.f = [...new Set(strings(m.f, ALL.length))].filter(c => byCode.has(c));
    p.w = strings(m.w, 200);
    p.u = strings(m.u, 50);
    p.last = Number(m.l) || 0;
    p.done = p.done || !!m.d;
    if (phase === 'play') renderRivals();
    if (phase === 'wait' && game.roster.every(id => id === me.id || (players.get(id) || {}).done)) showResults();
    if (phase === 'results') renderBoard();
  }

  /* Lobby */
  function showLobby() {
    clearInterval(tick);
    game = null;
    players.forEach(resetProgress);
    show('lobby');
    renderLobby();
  }

  function renderLobby() {
    const host = isHost();
    const list = livePlayers();
    const owner = hostId();
    $('playerCount').textContent = `(${list.length})`;
    $('playerList').innerHTML = list.map(p => `<li>${avatar(p)}<span>${esc(p.name)}${p.id === me.id ? ' <span class="muted">(you)</span>' : ''}</span>${p.id === owner ? '<span class="tag">HOST</span>' : ''}</li>`).join('');
    $('rulesNote').textContent = host ? '' : '(host sets these)';
    $('startBtn').style.display = host ? '' : 'none';
    $('startBtn').textContent = list.length > 1 ? `Start game` : 'Start solo';
    $('waitHost').style.display = host ? 'none' : '';
    if (!document.activeElement || document.activeElement.type !== 'range') renderSettings(host);
  }

  function segment(key, title, options, help, host) {
    const buttons = options.map(([value, label]) => `<button data-key="${key}" data-value="${value}" class="${String(settings[key]) === String(value) ? 'on' : ''}">${label}</button>`).join('');
    return `<div><div class="setting-title">${title}</div><div class="seg ${host ? '' : 'locked'}">${buttons}</div>${help ? `<div class="setting-help">${help}</div>` : ''}</div>`;
  }

  function renderSettings(host) {
    const errorsHelp = settings.errors === 'after'
      ? 'Blind round: entries are not marked, the map stays blank. All is revealed at the end.'
      : 'Wrong entries are flagged as soon as you submit them.';
    $('settings').innerHTML = `
      <div><div class="setting-title"><span>Time</span><span>${plural(settings.min, 'minute')}</span></div>
      <input id="minutes" type="range" min="1" max="10" step="1" value="${settings.min}" ${host ? '' : 'disabled'} aria-label="Minutes"></div>
      ${segment('map', 'World map', [[true, 'Show'], [false, 'Hide']], '', host)}
      ${segment('errors', 'Show mistakes', [['live', 'During game'], ['after', 'After game']], errorsHelp, host)}
      ${segment('penalty', 'Wrong answer costs', [[false, 'Nothing'], [true, '−1 point']], '', host)}
      ${segment('typos', 'Spelling', [[true, 'Forgive typos'], [false, 'Exact only']], '', host)}
      ${segment('rivals', 'Others’ scores in game', [[false, 'Hide'], [true, 'Show']], '', host)}`;
    const slider = $('minutes');
    slider.oninput = () => { settings.min = Number(slider.value); slider.previousElementSibling.lastElementChild.textContent = plural(settings.min, 'minute'); };
    slider.onchange = () => { sendSettings(); slider.blur(); renderLobby(); };
  }

  function sendSettings() {
    channel.send({ t: 'set', from: me.id, s: settings });
  }

  $('settings').addEventListener('click', e => {
    const b = e.target.closest('button[data-key]');
    if (!b || !isHost()) return;
    const raw = b.dataset.value;
    settings[b.dataset.key] = raw === 'true' ? true : raw === 'false' ? false : raw;
    sendSettings();
    renderLobby();
  });

  /* Game flow */
  function startMessage(to, remaining, countdown) {
    return { t: 'start', from: me.id, to, id: game.id, s: game.settings, roster: game.roster, ms: remaining, cd: countdown };
  }

  function hostStart() {
    if (!isHost() || !channel) return;
    const id = Math.random().toString(36).slice(2, 10);
    beginGame({ id, s: settings, roster: livePlayers().map(p => p.id), ms: settings.min * 60000, cd: COUNTDOWN_MS });
    channel.send(startMessage(undefined, settings.min * 60000, COUNTDOWN_MS));
  }

  function onStart(m) {
    if (typeof m.id !== 'string' || (game && game.id === m.id)) return;
    if (phase !== 'lobby' && phase !== 'results' && phase !== 'wait') return;
    const roster = Array.isArray(m.roster) ? m.roster.filter(id => typeof id === 'string') : [];
    beginGame({ id: m.id, s: m.s, roster, ms: Number(m.ms) || 0, cd: Number(m.cd) || 0 });
  }

  let tick;

  function beginGame({ id, s, roster, ms, cd }) {
    const rules = cleanSettings(s);
    players.forEach(resetProgress);
    openRows = new Set();
    game = {
      id, settings: rules, roster, endAt: Date.now() + cd + ms,
      found: new Set(), order: [], wrong: [], unclear: [], entries: 0, last: 0,
      startedAt: Date.now() + cd, finished: false
    };
    setupPlayScreen();
    if (cd > 0) runCountdown(cd);
    else enterPlay();
  }

  function setupPlayScreen() {
    const rules = game.settings;
    $('playMap').style.display = rules.map ? '' : 'none';
    $('playMap').innerHTML = rules.map ? mapMarkup() : '';
    $('entries').innerHTML = '';
    $('rivals').innerHTML = '';
    $('feedback').textContent = '';
    $('feedback').className = 'feedback';
    $('guessInput').value = '';
    updateScore();
    renderRegions();
  }

  function runCountdown(ms) {
    show('countdown');
    const finishAt = Date.now() + ms;
    const step = () => {
      if (phase !== 'countdown' || !game) return;
      const left = finishAt - Date.now();
      if (left <= 0) return enterPlay();
      $('countNum').textContent = Math.ceil(left / 1000);
      setTimeout(step, 100);
    };
    step();
  }

  function enterPlay() {
    show('play');
    buzz(60);
    $('guessInput').focus();
    clearInterval(tick);
    tick = setInterval(updateTimer, 200);
    updateTimer();
    renderRivals();
  }

  function updateTimer() {
    if (!game) return;
    const left = game.endAt - Date.now();
    if (left <= 0) return finishGame();
    const secs = Math.ceil(left / 1000);
    $('timer').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('urgent', secs <= 15);
  }

  function finishGame() {
    if (!game || game.finished) return;
    game.finished = true;
    clearInterval(tick);
    buzz([80, 60, 80]);
    $('guessInput').blur();
    pushProgress(true);
    show('wait');
    const ready = () => game.roster.every(id => id === me.id || (players.get(id) || {}).done);
    if (ready()) return showResults();
    setTimeout(() => { if (phase === 'wait') showResults(); }, COLLECT_MS);
  }

  let pushTimer = null;
  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; pushProgress(false); }, 1000);
  }

  function pushProgress(done) {
    if (!channel || !game) return;
    const m = players.get(me.id) || touchPlayer(me.id, me.name, me.rank);
    m.f = game.order.slice(); m.w = game.wrong.slice(); m.u = game.unclear.slice(); m.last = game.last; m.done = m.done || done;
    channel.send({ t: 'p', from: me.id, n: me.name, r: me.rank, g: game.id, f: m.f, w: m.w.slice(0, 200), u: m.u.slice(0, 50), l: m.last, d: m.done });
  }

  /* Guessing */
  function feedback(text, cls) {
    const el = $('feedback');
    el.textContent = text;
    el.className = 'feedback ' + cls;
  }

  function addChip(text, cls) {
    const chip = document.createElement('span');
    chip.className = 'chip ' + cls;
    chip.textContent = text;
    const box = $('entries');
    box.insertBefore(chip, box.firstChild);
  }

  function shakeInput() {
    const input = $('guessInput');
    input.classList.remove('shake');
    void input.offsetWidth;
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 320);
  }

  function submitGuess() {
    if (!game || phase !== 'play') return;
    const input = $('guessInput');
    const raw = input.value.trim();
    input.focus();
    if (!raw) return;
    const rules = game.settings;
    const blind = rules.errors === 'after';
    const r = match(raw, game.found, rules.typos);
    if (r.status === 'empty') return;
    const sameRaw = list => list.some(x => Match.normalize(x) === Match.normalize(raw));

    if (r.status === 'ok') {
      game.found.add(r.code);
      game.order.push(r.code);
      game.last = Date.now() - game.startedAt;
    } else if (r.status === 'wrong') {
      if (!sameRaw(game.wrong)) game.wrong.push(raw);
    } else if (r.status === 'ambiguous' && blind) {
      if (!sameRaw(game.unclear)) game.unclear.push(raw);
    }

    if (blind) {
      game.entries++;
      input.value = '';
      addChip(raw, 'neutral');
      feedback('Recorded', 'info');
      buzz(12);
      updateScore();
      schedulePush();
      return;
    }

    if (r.status === 'ok') {
      const c = byCode.get(r.code);
      input.value = '';
      addChip(`${c.f} ${c.n}`, '');
      feedback(r.corrected ? `Close enough: ${c.n}` : c.n, 'ok');
      if (rules.map) paintMap($('playMap'), r.code, 'found');
      buzz(15);
      updateScore();
      renderRegions();
    } else if (r.status === 'dup') {
      input.value = '';
      feedback(`Already got ${byCode.get(r.code).n}`, 'info');
      buzz(30);
    } else if (r.status === 'ambiguous') {
      feedback(`Which one? ${r.options.slice(0, 3).join(' or ')}`, 'info');
      buzz(30);
    } else {
      input.value = '';
      addChip(raw, 'wrong');
      feedback(r.hint ? `${raw}: ${r.hint.toLowerCase()}` : `“${raw}” isn’t a country`, 'bad');
      shakeInput();
      buzz([40, 30, 40]);
      updateScore();
    }
    schedulePush();
  }

  function updateScore() {
    if (!game) return;
    const blind = game.settings.errors === 'after';
    const points = Math.max(0, game.order.length - (game.settings.penalty ? game.wrong.length : 0));
    $('score').textContent = blind ? game.entries : points;
    $('scoreOf').textContent = blind ? 'entered' : `/ ${ALL.length}`;
  }

  function renderRegions() {
    const el = $('regions');
    if (!game || game.settings.errors === 'after') { el.innerHTML = ''; return; }
    el.innerHTML = REGIONS.map(([name, short]) => {
      const total = ALL.filter(c => c.r === name).length;
      const got = game.order.filter(code => byCode.get(code).r === name).length;
      return `<div class="region ${got === total ? 'complete' : ''}"><b>${got}</b>${short}/${total}</div>`;
    }).join('');
  }

  function renderRivals() {
    const el = $('rivals');
    if (!game || !game.settings.rivals) { el.innerHTML = ''; return; }
    el.innerHTML = game.roster.filter(id => id !== me.id).map(id => players.get(id)).filter(Boolean)
      .map(p => `<span>${esc(p.name)} ${scoreOf(p, game.settings)}</span>`).join('');
  }

  /* Results */
  function standings() {
    const rules = game.settings;
    const rows = game.roster.map(id => players.get(id)).filter(Boolean);
    const counts = new Map();
    rows.forEach(p => p.f.forEach(c => counts.set(c, (counts.get(c) || 0) + 1)));
    rows.forEach(p => { p.score = scoreOf(p, rules); p.unique = rows.length > 1 ? p.f.filter(c => counts.get(c) === 1).length : 0; });
    rows.sort((a, b) => b.score - a.score || a.last - b.last);
    let rank = 0;
    rows.forEach((p, i) => {
      if (i === 0 || p.score !== rows[i - 1].score || p.last !== rows[i - 1].last) rank = i + 1;
      p.place = rank;
    });
    return rows;
  }

  function showResults() {
    show('results');
    const box = $('resultMap');
    box.innerHTML = mapMarkup();
    ALL.forEach(c => paintMap(box, c.c, game.found.has(c.c) ? 'found' : 'miss'));

    $('resultRegions').innerHTML = REGIONS.map(([name]) => {
      const total = ALL.filter(c => c.r === name).length;
      const got = game.order.filter(code => byCode.get(code).r === name).length;
      return `<div class="rbar"><span>${name}</span><div class="track"><i style="width:${(got / total) * 100}%"></i></div><span class="num">${got}/${total}</span></div>`;
    }).join('');

    const missed = ALL.filter(c => !game.found.has(c.c));
    $('missedBox').style.display = missed.length ? '' : 'none';
    $('missedBox').open = false;
    $('missedTitle').textContent = `Countries you missed (${missed.length})`;
    $('missedList').innerHTML = REGIONS.map(([name]) => {
      const here = missed.filter(c => c.r === name);
      return here.length ? `<h3>${name}</h3><p>${here.map(c => esc(c.n)).join(', ')}</p>` : '';
    }).join('');
    renderBoard();
  }

  function renderBoard() {
    if (!game) return;
    const rules = game.settings;
    const rows = standings();
    const top = rows.filter(p => p.place === 1);
    const banner = $('banner');
    if (!rows.length || rows[0].score === 0) {
      banner.innerHTML = '<div class="who">No winner</div><div class="what">Nobody scored this round</div>';
    } else if (rows.length === 1) {
      banner.innerHTML = `<div class="who">${plural(rows[0].score, 'point')}</div><div class="what">out of ${ALL.length} countries in ${plural(rules.min, 'minute')}</div>`;
    } else if (top.length > 1) {
      banner.innerHTML = `<div class="who">It’s a tie!</div><div class="what">${top.map(p => esc(p.name)).join(' and ')} with ${plural(top[0].score, 'point')}</div>`;
    } else {
      const you = top[0].id === me.id;
      banner.innerHTML = `<div class="who">${you ? 'You win!' : esc(top[0].name) + ' wins!'}</div><div class="what">with ${plural(top[0].score, 'point')}</div>`;
    }

    $('board').innerHTML = rows.map(p => {
      const bits = [`${p.f.length} correct`, `${p.w.length} wrong`];
      if (p.unique) bits.push(`${p.unique} unique`);
      if (!p.done) bits.push('left early');
      const foundText = p.f.map(c => byCode.get(c).n).map(esc).join(', ') || 'None';
      const wrong = p.w.length ? `<h3>Wrong${rules.penalty ? ' (−1 each)' : ''}</h3><div class="bad-list">${p.w.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : '';
      const unclear = p.u.length ? `<h3>Unclear, not counted</h3><div class="unclear">${p.u.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : '';
      return `<li class="${p.place === 1 && p.score > 0 ? 'first' : ''}"><details data-id="${esc(p.id)}" ${openRows.has(p.id) ? 'open' : ''}>
        <summary><span class="rank">${p.place}</span>${avatar(p)}<div class="who-col"><div class="who-name">${esc(p.name)}${p.id === me.id ? ' (you)' : ''}</div><div class="who-sub">${bits.join(' · ')}</div></div><span class="final">${p.score}</span></summary>
        <div class="detail"><h3>Correct</h3><div>${foundText}</div>${wrong}${unclear}</div></details></li>`;
    }).join('');

    renderAgainControls();
  }

  function renderAgainControls() {
    const host = isHost();
    $('againBtn').style.display = host ? '' : 'none';
    $('againWait').style.display = host ? 'none' : '';
  }

  $('board').addEventListener('toggle', e => {
    const id = e.target.dataset && e.target.dataset.id;
    if (!id) return;
    if (e.target.open) openRows.add(id); else openRows.delete(id);
  }, true);

  function playAgain() {
    if (!channel) return;
    channel.send({ t: 'lobby', from: me.id });
    showLobby();
  }

  /* Share, dialogs, Android back button */
  function shareCode() {
    const code = channel.code;
    const text = `Join my Countries game. Room code: ${code}`;
    if (window.AndroidBridge) return window.AndroidBridge.share(text);
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Code copied'), () => toast(code));
    else toast(code);
  }

  function askQuit() {
    $('dialogText').textContent = 'Quit this game? Your answers so far stay on the scoreboard.';
    $('dialog').classList.add('show');
  }

  window.appBack = function () {
    if ($('dialog').classList.contains('show')) { $('dialog').classList.remove('show'); return true; }
    if (phase === 'play' || phase === 'countdown') { askQuit(); return true; }
    if (phase !== 'home') { leaveRoom(); return true; }
    return false;
  };

  /* Wire up */
  $('homeMap').innerHTML = mapMarkup();
  ['FR', 'BR', 'IN', 'JP', 'KE', 'CA', 'AU', 'DE', 'EG', 'MX'].forEach(c => paintMap($('homeMap'), c, 'found'));
  $('nameInput').value = store.get('name');
  $('createBtn').onclick = createRoom;
  $('joinBtn').onclick = joinRoom;
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  $('lobbyLeave').onclick = leaveRoom;
  $('resultsLeave').onclick = leaveRoom;
  $('shareBtn').onclick = shareCode;
  $('startBtn').onclick = hostStart;
  $('againBtn').onclick = playAgain;
  $('quitBtn').onclick = askQuit;
  $('dialogNo').onclick = () => { $('dialog').classList.remove('show'); $('guessInput').focus(); };
  $('dialogYes').onclick = () => { $('dialog').classList.remove('show'); leaveRoom(); };
  $('guessForm').addEventListener('submit', e => { e.preventDefault(); submitGuess(); });
  $('guessForm').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && phase === 'play') updateTimer(); });
})();
