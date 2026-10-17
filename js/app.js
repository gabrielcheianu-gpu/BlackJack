/* UI controller: renders the table, wires buttons, runs drills/quizzes, keeps stats. */
(function () {
  'use strict';

  const { Game, Shoe, handTotal, isBlackjack, hiLo, decide, shouldInsure, suggestBet, chartData, ILLUSTRIOUS_18 } = window.BJ;
  const $ = (id) => document.getElementById(id);

  // ---------- Persistence ----------
  const STORE_KEY = 'countTrainer.v1';
  const DEFAULT_SETTINGS = {
    decks: 6, penetration: 75, h17: false, surrender: true, das: true,
    showCount: true, quiz: 0.15, quizTC: false,
    trainer: true, deviations: false, betAdvice: true, unit: 10, maxSpread: 8,
    sound: true, haptics: true, speed: 1, startBank: 1000,
    drillSpeed: 1000, drillCount: 20, drillPairs: false,
  };
  const freshStats = () => ({
    hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, surrenders: 0, net: 0,
    countQuiz: { c: 0, t: 0 }, tcQuiz: { c: 0, t: 0 }, drill: { c: 0, t: 0 },
    strategy: { c: 0, t: 0 }, deviations: { c: 0, t: 0 },
    history: [], mistakes: [],
  });

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  const saved = load();
  const settings = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
  const stats = Object.assign(freshStats(), saved.stats);
  let bet = saved.bet != null ? saved.bet : settings.unit * 2;

  const rulesFromSettings = () => ({
    decks: settings.decks, penetration: settings.penetration / 100,
    h17: settings.h17, surrender: settings.surrender, das: settings.das,
  });
  const game = new Game({
    rules: rulesFromSettings(),
    bankroll: saved.bankroll != null ? saved.bankroll : settings.startBank,
  });
  if (!stats.history.length) stats.history.push(game.bankroll);

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ settings, stats, bankroll: game.bankroll, bet }));
    } catch (e) { /* storage full or blocked: keep playing */ }
  }

  let busy = false;          // true while cards are animating
  let pendingRules = false;  // rule change waiting for the round to end

  // ---------- Formatting ----------
  const money = (n) => {
    const abs = Math.abs(n);
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return (n < 0 ? '−$' : '$') + s;
  };
  const signed = (n, digits = 0) => {
    const v = Number(n.toFixed(digits));
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);
  };
  const ACTION_NAMES = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };
  const pct = (o) => (o.t ? Math.round((o.c / o.t) * 100) + '%' : '—');

  // ---------- Sound & haptics ----------
  let actx = null;
  function audio() {
    if (!settings.sound) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, opts = {}) {
    const ctx = audio();
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.when || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    gain.gain.setValueAtTime(opts.vol || 0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function swish(when = 0) {
    const ctx = audio();
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime + when);
  }
  const sfx = {
    deal: (when) => swish(when),
    chip: () => { tone(1900, 0.04, { type: 'triangle', vol: 0.1 }); tone(2500, 0.04, { type: 'triangle', vol: 0.08, when: 0.05 }); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.1, when: i * 0.09 })),
    lose: () => tone(240, 0.35, { type: 'sawtooth', vol: 0.05, slide: 130 }),
    bad: () => tone(170, 0.2, { type: 'square', vol: 0.06 }),
    good: () => { tone(880, 0.08, { vol: 0.1 }); tone(1320, 0.14, { vol: 0.1, when: 0.08 }); },
  };
  function buzz(pattern) {
    if (settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(kind, title, body, ms = 2800) {
    const el = $('toast');
    el.className = 'toast show ' + kind;
    el.innerHTML = '<div class="t-title">' + title + '</div>' + (body ? '<div>' + body + '</div>' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  $('toast').addEventListener('click', () => $('toast').classList.remove('show'));

  // ---------- Cards ----------
  const RED = new Set(['♥', '♦']);
  function cardEl(card, faceDown) {
    const el = document.createElement('div');
    el.className = 'card' + (RED.has(card.suit) ? ' red' : '') + (faceDown ? ' facedown' : '');
    const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
    const center = isFace
      ? '<span class="pip face-card"><span>' + card.rank + '<small>' + card.suit + '</small></span></span>'
      : '<span class="pip">' + card.suit + '</span>';
    const corner = card.rank + '<span class="s">' + card.suit + '</span>';
    el.innerHTML =
      '<div class="card-inner"><div class="face">' +
      '<span class="corner tl">' + corner + '</span>' + center +
      '<span class="corner br">' + corner + '</span>' +
      '</div><div class="back"></div></div>';
    el.setAttribute('aria-label', faceDown ? 'face-down card' : card.rank + card.suit);
    return el;
  }

  // ---------- Table rendering ----------
  const seen = new Map();   // card id -> was face down when last drawn
  let labelCache = {};      // last settled label text, shown while new cards fly in

  function totalText(cards, natural) {
    const t = handTotal(cards);
    if (natural && isBlackjack(cards)) return 'Blackjack';
    if (t.total > 21) return 'Bust ' + t.total;
    if (t.soft && t.total < 21) return (t.total - 10) + ' / ' + t.total;
    return String(t.total);
  }

  function dealerLabel() {
    if (!game.dealer.length) return '';
    if (game.holeHidden) return game.dealer[0].rank === 'A' ? 'A' : String(handTotal([game.dealer[0]]).total);
    return totalText(game.dealer, true);
  }

  const RESULT_TEXT = { win: 'WIN', blackjack: 'BLACKJACK', lose: 'LOSE', bust: 'BUST', push: 'PUSH', surrender: 'SURRENDER' };

  function animateDeal(el, delay) {
    const shoe = $('shoe').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = shoe.left + shoe.width / 2 - (r.left + r.width / 2);
    const dy = shoe.top + shoe.height / 2 - (r.top + r.height / 2);
    if (!el.animate) return;
    el.animate(
      [
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(25deg) scale(.7)', opacity: 0.85 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 380 * settings.speed, delay, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'backwards' }
    );
  }

  /** Rebuild the table DOM, animate new cards and flips in deal order; returns ms until done. */
  function render() {
    const events = [];
    const flips = [];

    const dealerBox = $('dealerCards');
    dealerBox.innerHTML = '';
    game.dealer.forEach((c) => {
      const prevDown = seen.get(c.id);
      const isNew = prevDown === undefined;
      const flip = !c.faceDown && (isNew ? !!c.hole : prevDown);
      const el = cardEl(c, c.faceDown || flip);
      dealerBox.appendChild(el);
      if (isNew) events.push({ type: 'deal', el, seq: c.seq, dealer: true });
      if (flip) flips.push({ el, seq: c.seq });
      seen.set(c.id, c.faceDown);
    });

    const area = $('playerHands');
    area.innerHTML = '';
    area.classList.toggle('multi', game.hands.length === 2);
    area.classList.toggle('many', game.hands.length >= 3);
    game.hands.forEach((h, i) => {
      const box = document.createElement('div');
      box.className = 'hand' + (game.phase === 'playing' && i === game.active && game.hands.length > 1 ? ' active' : '');
      const cards = document.createElement('div');
      cards.className = 'cards';
      h.cards.forEach((c) => {
        const el = cardEl(c, false);
        cards.appendChild(el);
        if (!seen.has(c.id)) events.push({ type: 'deal', el, seq: c.seq });
        seen.set(c.id, false);
      });
      box.appendChild(cards);
      box.insertAdjacentHTML('beforeend',
        '<div class="hand-label"><b data-label="h' + i + '">' + (labelCache['h' + i] || '') + '</b></div>' +
        '<div class="hand-bet" data-bet="' + i + '">' + money(h.bet) + (h.doubled ? ' · DBL' : '') + '</div>');
      area.appendChild(box);
    });
    $('dealerTotal').textContent = labelCache.d || '';

    events.sort((a, b) => a.seq - b.seq);
    // The hole card flips after the player's new cards and before any dealer draws.
    for (const f of flips) {
      const afterPlayer = events.reduce((m, e, idx) => (!e.dealer ? idx + 1 : m), 0);
      const own = events.findIndex((e) => e.el === f.el);
      events.splice(Math.max(afterPlayer, own + 1), 0, { type: 'flip', el: f.el });
    }

    const step = 230 * settings.speed;
    let t = 0;
    for (const e of events) {
      if (e.type === 'deal') {
        animateDeal(e.el, t);
        sfx.deal(t / 1000);
        t += step;
      } else {
        const el = e.el;
        setTimeout(() => el.classList.remove('facedown'), t + 120 * settings.speed);
        t += 450 * settings.speed;
      }
    }
    return events.length ? t + 200 * settings.speed : 0;
  }

  function updateLabels() {
    labelCache = { d: dealerLabel() };
    $('dealerTotal').textContent = labelCache.d;
    game.hands.forEach((h, i) => {
      const text = totalText(h.cards, !h.fromSplit);
      labelCache['h' + i] = text;
      const el = document.querySelector('[data-label="h' + i + '"]');
      if (el) el.textContent = text;
      if (game.phase === 'done' && h.result) {
        const box = el.closest('.hand');
        const badge = document.createElement('div');
        badge.className = 'result-badge ' + h.result;
        badge.textContent = RESULT_TEXT[h.result] + (h.payout ? ' ' + (h.payout > 0 ? '+' : '') + money(h.payout) : '');
        box.appendChild(badge);
      }
    });
  }

  function updateCount() {
    $('rc').textContent = signed(game.runningCount);
    $('tc').textContent = signed(game.trueCount, 1);
    $('decksLeft').textContent = game.decksRemaining.toFixed(1);
    $('bankroll').textContent = money(game.bankroll);
    $('shoeFill').style.width = (game.shoe.dealt / game.shoe.total) * 100 + '%';
    $('cutMark').style.left = game.rules.penetration * 100 + '%';
    document.body.classList.toggle('show-count', settings.showCount);
  }

  function setMessage(text, kind) {
    const el = $('message');
    el.textContent = text;
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function showPanel(name) {
    ['bet', 'play', 'ins', 'wait'].forEach((p) => { $(p + 'Controls').hidden = p !== name; });
  }

  function updateBetPanel() {
    if (bet > game.bankroll) bet = Math.floor(game.bankroll);
    $('betAmount').textContent = money(bet);
    document.querySelectorAll('[data-chip]').forEach((b) => { b.disabled = Number(b.dataset.chip) > game.bankroll - bet; });
    const adv = $('betAdvice');
    const tip = suggestBet(game.trueCount, settings.unit, settings.maxSpread);
    $('btnUseAdvice').hidden = !settings.betAdvice;
    if (!settings.betAdvice) { adv.textContent = ''; return; }
    adv.innerHTML = settings.showCount
      ? 'TC ' + signed(game.trueCount, 1) + ' → bet <b>' + tip.units + ' unit' + (tip.units > 1 ? 's' : '') + '</b> (' + money(tip.amount) + ')'
      : 'Suggested bet: <b>' + money(tip.amount) + '</b>';
  }

  function updateControls() {
    switch (game.phase) {
      case 'betting':
      case 'done':
        showPanel('bet');
        updateBetPanel();
        break;
      case 'insurance':
        showPanel('ins');
        $('btnInsYes').disabled = !game.canInsure;
        setMessage(isBlackjack(game.hands[0].cards) ? 'Blackjack! Even money?' : 'Insurance?');
        break;
      case 'playing': {
        showPanel('play');
        const can = { H: game.canHit, S: game.canStand, D: game.canDouble, P: game.canSplit, R: game.canSurrender };
        document.querySelectorAll('[data-act]').forEach((b) => { b.disabled = !can[b.dataset.act]; });
        setMessage(game.hands.length > 1 ? 'Hand ' + (game.active + 1) + ' of ' + game.hands.length : 'Your move');
        break;
      }
      default:
        showPanel('wait');
    }
  }

  function updateRuleText() {
    const r = game.rules;
    $('ruleText').textContent =
      r.decks + ' deck' + (r.decks > 1 ? 's' : '') + ' · Dealer ' + (r.h17 ? 'hits' : 'stands on') + ' soft 17' +
      (r.surrender ? ' · Late surrender' : '');
  }

  /** Render, wait for the animations, then refresh labels/controls and run `after`. */
  function refresh(after) {
    busy = true;
    if (game.phase === 'dealer' || game.phase === 'done') showPanel('wait');
    const ms = render();
    setTimeout(() => {
      busy = false;
      updateLabels();
      updateCount();
      if (after) after();
      else updateControls();
    }, ms);
  }

  // ---------- Round flow ----------
  function onDeal() {
    if (busy || (game.phase !== 'betting' && game.phase !== 'done')) return;
    if (pendingRules) applyRules();
    if (game.bankroll < 1) {
      toast('info', 'Out of chips', 'Reset your bankroll in Settings to keep playing.');
      return;
    }
    if (bet <= 0) {
      toast('info', 'Place a bet', 'Tap a chip to bet.');
      return;
    }
    audio();
    buzz(10);
    labelCache = {};
    seen.clear();
    game.deal(Math.min(bet, game.bankroll));
    if (game.shuffledThisRound) toast('info', 'New shoe', 'The shoe was shuffled — the count starts again at 0.');
    setMessage('');
    updateCount();
    refresh(afterAction);
  }

  function afterAction() {
    if (game.phase === 'done') roundOver();
    else updateControls();
  }

  function gradePlay(code) {
    const h = game.hand;
    const d = decide({
      cards: h.cards, up: game.dealer[0], rules: game.rules,
      canDouble: game.canDouble, canSplit: game.canSplit, canSurrender: game.canSurrender,
      trueCount: game.trueCount, useDeviations: settings.deviations,
    });
    const ok = code === d.action;
    const tcText = signed(game.trueCount, 1);
    stats.strategy.t++;
    if (ok) stats.strategy.c++;
    if (d.deviation) {
      stats.deviations.t++;
      if (ok) stats.deviations.c++;
    }
    if (ok) {
      if (d.deviation) {
        toast('good', '✓ Index play: ' + d.deviation.label, ACTION_NAMES[d.action] + ' because TC is ' + tcText + '.');
        sfx.good();
      }
      return;
    }
    let body = d.label + '.';
    if (d.deviation) {
      const above = game.trueCount >= d.deviation.index;
      body += ' Illustrious 18: ' + ACTION_NAMES[d.action].toLowerCase() + ' when TC ' + (above ? '≥ ' : '< ') +
        signed(d.deviation.index) + ' (TC is ' + tcText + ').';
    } else if (d.indexPlay && code === d.indexPlay.at) {
      body += ' The index play needs TC ≥ ' + signed(d.indexPlay.index) + ' (TC is ' + tcText + ').';
    } else if (d.indexPlay && code === d.indexPlay.below) {
      body += ' Below TC ' + signed(d.indexPlay.index) + ' you ' + ACTION_NAMES[code].toLowerCase() + ' — TC is ' + tcText + '.';
    }
    stats.mistakes.unshift({ label: d.label, you: ACTION_NAMES[code], correct: ACTION_NAMES[d.action], dev: !!d.deviation });
    stats.mistakes.length = Math.min(stats.mistakes.length, 25);
    toast('bad', '✗ Correct play: ' + ACTION_NAMES[d.action], body, 4200);
    sfx.bad();
    buzz([50, 40, 50]);
  }

  function onAct(code) {
    if (busy || game.phase !== 'playing') return;
    const can = { H: game.canHit, S: game.canStand, D: game.canDouble, P: game.canSplit, R: game.canSurrender };
    if (!can[code]) return;
    if (settings.trainer) gradePlay(code);
    buzz(8);
    ({ H: () => game.hit(), S: () => game.stand(), D: () => game.double(), P: () => game.split(), R: () => game.surrender() })[code]();
    refresh(afterAction);
  }

  function onInsure(take) {
    if (busy || game.phase !== 'insurance') return;
    if (take && !game.canInsure) return;
    if (settings.trainer) {
      const should = shouldInsure(game.trueCount, settings.deviations);
      const ok = take === should;
      stats.strategy.t++;
      if (ok) stats.strategy.c++;
      if (should) { stats.deviations.t++; if (ok) stats.deviations.c++; }
      if (!ok) {
        const body = should
          ? 'Illustrious 18: take insurance at TC ≥ +3 (TC is ' + signed(game.trueCount, 1) + ').'
          : 'Basic strategy never takes insurance' +
            (settings.deviations ? ' — only at TC ≥ +3 (TC is ' + signed(game.trueCount, 1) + ').' : '.');
        stats.mistakes.unshift({ label: 'Insurance', you: take ? 'Insure' : 'Decline', correct: should ? 'Insure' : 'Decline', dev: should });
        stats.mistakes.length = Math.min(stats.mistakes.length, 25);
        toast('bad', '✗ ' + (should ? 'Take insurance' : 'Decline insurance'), body, 4000);
        sfx.bad();
        buzz([50, 40, 50]);
      } else if (should) {
        toast('good', '✓ Index play: insurance', 'TC is ' + signed(game.trueCount, 1) + '.');
      }
    }
    game.insure(take);
    refresh(afterAction);
  }

  function roundOver() {
    const r = game.result;
    stats.hands++;
    for (const h of game.hands) {
      if (h.result === 'win' || h.result === 'blackjack') stats.wins++;
      else if (h.result === 'lose' || h.result === 'bust') stats.losses++;
      else if (h.result === 'push') stats.pushes++;
      else if (h.result === 'surrender') stats.surrenders++;
      if (h.result === 'blackjack') stats.blackjacks++;
    }
    stats.net += r.net;
    stats.history.push(game.bankroll);
    if (stats.history.length > 1000) stats.history.splice(0, stats.history.length - 1000);

    const playerBJ = game.hands[0].result === 'blackjack';
    if (r.dealerBJ && !playerBJ) setMessage('Dealer blackjack' + (r.net ? ' · ' + money(r.net) : ''), 'lose');
    else if (playerBJ) setMessage('Blackjack! +' + money(r.net), 'win');
    else if (r.net > 0) setMessage('You win +' + money(r.net), 'win');
    else if (r.net < 0) setMessage('You lose ' + money(r.net), 'lose');
    else setMessage('Push');
    if (r.net > 0) { sfx.win(); buzz([30, 40, 30]); } else if (r.net < 0) sfx.lose();

    save();
    showPanel('wait');
    setTimeout(() => maybeQuiz(finishRound), 650);
  }

  function finishRound() {
    if (game.shoe.needsShuffle) {
      game.reshuffle();
      toast('info', 'Cut card reached', 'New shoe shuffled — the count resets to 0.');
    }
    if (pendingRules) applyRules();
    updateCount();
    updateControls();
    save();
  }

  // ---------- Keypad (iOS number keyboards have no minus key) ----------
  function makeKeypad(host, onSubmit) {
    let digits = '';
    let neg = false;
    host.innerHTML =
      '<div class="keypad-display">0</div><div class="keypad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button data-k="' + n + '">' + n + '</button>').join('') +
      '<button data-k="neg">±</button><button data-k="0">0</button><button data-k="del">⌫</button>' +
      '<button class="submit" data-k="ok">Submit</button></div>';
    const display = host.querySelector('.keypad-display');
    const value = () => (neg ? -1 : 1) * Number(digits || 0);
    const show = () => { display.textContent = (neg && digits && digits !== '0' ? '−' : '') + (digits || '0'); };
    host.querySelector('.keypad').addEventListener('click', (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (!k) return;
      buzz(5);
      if (k === 'ok') return onSubmit(value());
      if (k === 'neg') neg = !neg;
      else if (k === 'del') digits = digits.slice(0, -1);
      else if (digits.length < 3) digits = digits === '0' ? k : digits + k;
      show();
    });
    return { reset() { digits = ''; neg = false; show(); }, el: host };
  }

  // ---------- Count quiz ----------
  let quizDone = null;
  let quizAnswered = false;
  let quizAskTC = false;
  const quizPad = makeKeypad($('quizKeypad'), (val) => {
    if (quizAnswered) return;
    quizAnswered = true;
    const fb = $('quizFeedback');
    let ok;
    let truth;
    if (quizAskTC) {
      ok = Math.abs(val - game.trueCount) < 1;
      truth = 'True count is ' + signed(game.trueCount, 1) + ' (RC ' + signed(game.runningCount) + ' ÷ ' +
        game.decksRemaining.toFixed(1) + ' decks)';
      stats.tcQuiz.t++;
      if (ok) stats.tcQuiz.c++;
    } else {
      ok = val === game.runningCount;
      truth = 'Running count is ' + signed(game.runningCount);
      stats.countQuiz.t++;
      if (ok) stats.countQuiz.c++;
    }
    fb.hidden = false;
    fb.className = 'quiz-feedback ' + (ok ? 'good' : 'bad');
    fb.textContent = ok ? '✓ Correct! ' + truth + '.' : '✗ You said ' + signed(val) + '. ' + truth + '.';
    if (ok) sfx.good(); else { sfx.bad(); buzz([50, 40, 50]); }
    quizPad.el.hidden = true;
    $('quizContinue').hidden = false;
    save();
  });

  function maybeQuiz(done) {
    if (!(Math.random() < settings.quiz)) return done();
    quizDone = done;
    quizAnswered = false;
    quizAskTC = settings.quizTC && Math.random() < 0.5;
    $('quizQ').textContent = quizAskTC ? "What's the true count?" : "What's the running count?";
    $('quizHint').textContent = quizAskTC
      ? 'Round to a whole number. About ' + (Math.round(game.decksRemaining * 2) / 2).toFixed(1) + ' decks remain.'
      : 'Hi-Lo: 2–6 = +1, 7–9 = 0, 10–A = −1';
    $('quizFeedback').hidden = true;
    $('quizContinue').hidden = true;
    quizPad.el.hidden = false;
    quizPad.reset();
    $('quizModal').hidden = false;
    document.body.classList.add('quiz-open');
  }
  $('quizContinue').addEventListener('click', () => {
    $('quizModal').hidden = true;
    document.body.classList.remove('quiz-open');
    const done = quizDone;
    quizDone = null;
    if (done) done();
  });

  // ---------- Count drill ----------
  let drillTimer = null;
  let drillCards = [];
  const drillPad = makeKeypad($('drillKeypad'), (val) => {
    const truth = drillCards.reduce((s, c) => s + hiLo(c), 0);
    const ok = val === truth;
    stats.drill.t++;
    if (ok) stats.drill.c++;
    save();
    $('drillAnswer').hidden = true;
    $('drillResult').hidden = false;
    const res = $('drillResultText');
    res.className = 'result-big ' + (ok ? 'good' : 'bad');
    res.textContent = ok ? '✓ Correct — the count is ' + signed(truth) : '✗ You said ' + signed(val) + ', the count is ' + signed(truth);
    if (ok) sfx.good(); else { sfx.bad(); buzz([50, 40, 50]); }
    const review = $('drillReview');
    review.innerHTML = '';
    let run = 0;
    drillCards.forEach((c) => {
      run += hiLo(c);
      const wrap = document.createElement('div');
      wrap.appendChild(cardEl(c, false));
      wrap.insertAdjacentHTML('beforeend', '<div class="tag">' + signed(run) + '</div>');
      review.appendChild(wrap);
    });
  });

  function drillShowSetup() {
    clearTimeout(drillTimer);
    $('drillSetup').hidden = false;
    $('drillStage').hidden = true;
    $('drillAnswer').hidden = true;
    $('drillResult').hidden = true;
    $('drillRecord').textContent = stats.drill.t
      ? 'Drill accuracy: ' + stats.drill.c + ' / ' + stats.drill.t + ' (' + pct(stats.drill) + ')'
      : '';
  }

  function drillStart() {
    audio();
    const n = Number(settings.drillCount);
    const per = settings.drillPairs ? 2 : 1;
    const shoe = new Shoe(1, 1);
    drillCards = [];
    for (let i = 0; i < n; i++) drillCards.push(shoe.draw());
    $('drillSetup').hidden = true;
    $('drillStage').hidden = false;
    let i = 0;
    const stage = $('drillCards');
    const step = () => {
      if (i >= n) {
        stage.innerHTML = '';
        $('drillStage').hidden = true;
        $('drillAnswer').hidden = false;
        drillPad.reset();
        return;
      }
      const group = drillCards.slice(i, i + per);
      i += group.length;
      stage.innerHTML = '';
      group.forEach((c) => stage.appendChild(cardEl(c, false)));
      $('drillProgress').textContent = i + ' / ' + n;
      sfx.deal(0);
      drillTimer = setTimeout(step, settings.drillSpeed);
    };
    step();
  }

  $('drillStart').addEventListener('click', drillStart);
  $('drillStop').addEventListener('click', drillShowSetup);
  $('drillAgain').addEventListener('click', drillShowSetup);
  $('drillSpeed').addEventListener('input', (e) => {
    settings.drillSpeed = Number(e.target.value);
    $('drillSpeedVal').textContent = (settings.drillSpeed / 1000).toFixed(2).replace(/0$/, '') + 's';
    save();
  });
  $('drillCount').addEventListener('change', (e) => { settings.drillCount = Number(e.target.value); save(); });
  $('drillPairs').addEventListener('change', (e) => { settings.drillPairs = e.target.checked; save(); });

  // ---------- Stats sheet ----------
  function historyChart(values) {
    const W = 320;
    const H = 140;
    const pad = 6;
    if (values.length < 2) return '<p class="note">Play a few hands to see your bankroll history.</p>';
    const stepN = Math.ceil(values.length / 200);
    const pts = values.filter((_, i) => i % stepN === 0 || i === values.length - 1);
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
    const line = pts.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    const up = pts[pts.length - 1] >= pts[0];
    const color = up ? '#3ecf7a' : '#ff6b6b';
    return (
      '<svg viewBox="0 0 ' + W + ' ' + (H + 18) + '" role="img" aria-label="Bankroll history">' +
      '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(pts[0]) + '" y2="' + y(pts[0]) +
      '" stroke="rgba(255,255,255,.25)" stroke-dasharray="4 4"/>' +
      '<polyline points="' + pad + ',' + (H - pad) + ' ' + line + ' ' + (W - pad) + ',' + (H - pad) +
      '" fill="' + color + '" fill-opacity=".12" stroke="none"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<text x="' + pad + '" y="' + (H + 14) + '" fill="rgba(255,255,255,.6)" font-size="11">Low ' + money(min) + '</text>' +
      '<text x="' + (W - pad) + '" y="' + (H + 14) + '" fill="rgba(255,255,255,.6)" font-size="11" text-anchor="end">High ' + money(max) + '</text>' +
      '</svg>'
    );
  }

  function statTile(k, v, s, frac) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
      (s ? '<div class="s">' + s + '</div>' : '') +
      (frac != null ? '<div class="bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div>' : '') + '</div>';
  }

  function renderStats() {
    const acc = (o) => (o.t ? o.c / o.t : null);
    const decided = stats.wins + stats.losses;
    const tiles = [
      statTile('Count quiz accuracy', pct(stats.countQuiz), stats.countQuiz.c + ' / ' + stats.countQuiz.t + ' running count', acc(stats.countQuiz)),
      statTile('Strategy accuracy', pct(stats.strategy), stats.strategy.c + ' / ' + stats.strategy.t + ' decisions', acc(stats.strategy)),
      statTile('Count drill', pct(stats.drill), stats.drill.c + ' / ' + stats.drill.t + ' drills', acc(stats.drill)),
      statTile('True count quiz', pct(stats.tcQuiz), stats.tcQuiz.c + ' / ' + stats.tcQuiz.t, acc(stats.tcQuiz)),
      statTile('Index plays', pct(stats.deviations), stats.deviations.c + ' / ' + stats.deviations.t + ' deviations', acc(stats.deviations)),
      statTile('Hands played', stats.hands.toLocaleString(), stats.blackjacks + ' blackjacks'),
      statTile('Win / loss / push', stats.wins + ' / ' + stats.losses + ' / ' + stats.pushes,
        (decided ? Math.round((stats.wins / decided) * 100) + '% of decided hands' : '') + (stats.surrenders ? ' · ' + stats.surrenders + ' surrendered' : '')),
      statTile('Net result', (stats.net > 0 ? '+' : '') + money(stats.net), 'Bankroll ' + money(game.bankroll)),
    ];
    const mistakes = stats.mistakes.length
      ? '<ul class="mistakes">' + stats.mistakes.slice(0, 12).map((m) =>
          '<li><span>' + m.label + (m.dev ? ' <small>(I18)</small>' : '') + '</span><span>you: ' + m.you + ' → ' + m.correct + '</span></li>').join('') + '</ul>'
      : '<p class="note">No strategy mistakes recorded. Nice.</p>';
    $('statsBody').innerHTML =
      '<div class="stat-grid">' + tiles.join('') + '</div>' +
      '<h3>Bankroll history</h3><div class="chart-box">' + historyChart(stats.history) + '</div>' +
      '<h3>Recent mistakes</h3>' + mistakes +
      '<button class="btn danger wide" id="btnResetStats2">Reset all stats</button>';
    $('btnResetStats2').addEventListener('click', resetStats);
  }

  // ---------- Strategy chart sheet ----------
  function renderChart() {
    const data = chartData(game.rules);
    const table = (title, rows) =>
      '<h3>' + title + '</h3><table class="strat"><thead><tr><th class="rowh"></th>' +
      data.ups.map((u) => '<th>' + u + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr><th class="rowh">' + r.label + '</th>' +
        r.cells.map((c) => '<td class="c' + c + '">' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
    const r = game.rules;
    const devRows = ILLUSTRIOUS_18.map((d) => {
      const play = d.insurance ? 'Insure' : ACTION_NAMES[d.at];
      const note = d.s17Only && r.h17 ? ' <small>(S17 only)</small>' : '';
      return '<tr><td>' + d.label + note + '</td><td>' + play + ' at TC ≥ ' + signed(d.index) + '</td></tr>';
    }).join('');
    $('chartBody').innerHTML =
      '<p class="note">' + r.decks + ' deck' + (r.decks > 1 ? 's' : '') + ', dealer ' + (r.h17 ? 'hits' : 'stands on') +
      ' soft 17, ' + (r.das ? '' : 'no ') + 'double after split, ' + (r.surrender ? 'late surrender' : 'no surrender') +
      '. Columns are the dealer\'s upcard.</p>' +
      '<div class="legend"><span class="cH">H Hit</span><span class="cS">S Stand</span><span class="cD">D Double, else hit</span>' +
      '<span class="cDs">Ds Double, else stand</span><span class="cP">P Split</span>' +
      (r.surrender ? '<span class="cR">R Surrender, else hit</span><span class="cRs">Rs Surrender, else stand</span><span class="cRp">Rp Surrender, else split</span>' : '') +
      '</div>' +
      table('Hard totals', data.hard) + table('Soft totals', data.soft) + table('Pairs', data.pairs) +
      '<h3>Illustrious 18 index plays</h3><p class="note">With deviations on, make these plays when the true count reaches the index; otherwise use the chart. Indices are for multi-deck, dealer stands on soft 17.</p>' +
      '<table class="dev-table"><tbody>' + devRows + '</tbody></table>' +
      '<h3>Bet spread</h3><p class="note">TC ≤ +1: 1 unit · +2: 2 · +3: 4 · +4: 6 · +5 and up: 8 (capped at your max spread).</p>';
  }

  // ---------- Sheets ----------
  function openSheet(name) {
    buzz(5);
    if (name === 'stats') renderStats();
    if (name === 'chart') renderChart();
    if (name === 'drill') drillShowSetup();
    if (name === 'settings') syncSettingsForm();
    $('sheet-' + name).hidden = false;
  }
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.open)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
    const sheet = b.closest('.sheet');
    sheet.hidden = true;
    if (sheet.id === 'sheet-drill') clearTimeout(drillTimer);
    updateCount();
    if (!busy) updateControls();
  }));

  // ---------- Settings ----------
  const BINDINGS = [
    ['setDecks', 'decks', 'int', true], ['setPen', 'penetration', 'int', true],
    ['setH17', 'h17', 'bool', true], ['setSurrender', 'surrender', 'bool', true], ['setDAS', 'das', 'bool', true],
    ['setShowCount', 'showCount', 'bool'], ['setQuiz', 'quiz', 'float'], ['setQuizTC', 'quizTC', 'bool'],
    ['setTrainer', 'trainer', 'bool'], ['setDeviations', 'deviations', 'bool'], ['setBetAdvice', 'betAdvice', 'bool'],
    ['setUnit', 'unit', 'int'], ['setSpread', 'maxSpread', 'int'],
    ['setSound', 'sound', 'bool'], ['setHaptics', 'haptics', 'bool'], ['setSpeed', 'speed', 'float'],
    ['setStartBank', 'startBank', 'int'],
  ];
  const midRound = () => game.phase !== 'betting' && game.phase !== 'done';

  function syncSettingsForm() {
    for (const [id, key, type] of BINDINGS) {
      const el = $(id);
      if (type === 'bool') el.checked = !!settings[key];
      else el.value = String(settings[key]);
    }
    $('decksVal').textContent = settings.decks;
    $('penVal').textContent = settings.penetration + '%';
    $('settingsNote').hidden = !pendingRules;
  }

  function applyRules() {
    const decksChanged = game.rules.decks !== settings.decks;
    game.setRules(rulesFromSettings());
    pendingRules = false;
    if (decksChanged) toast('info', 'New shoe', settings.decks + '-deck shoe shuffled — the count resets to 0.');
    updateRuleText();
    updateCount();
  }

  for (const [id, key, type, isRule] of BINDINGS) {
    const el = $(id);
    el.addEventListener(type === 'bool' ? 'change' : 'input', () => {
      settings[key] = type === 'bool' ? el.checked : type === 'int' ? parseInt(el.value, 10) : parseFloat(el.value);
      $('decksVal').textContent = settings.decks;
      $('penVal').textContent = settings.penetration + '%';
      if (isRule) {
        if (midRound()) { pendingRules = true; $('settingsNote').hidden = false; } else applyRules();
      }
      if (key === 'speed') document.documentElement.style.setProperty('--speed', settings.speed);
      if (key === 'sound' && settings.sound) audio();
      updateCount();
      if (!busy && !midRound()) updateBetPanel();
      save();
    });
  }

  function resetStats() {
    if (!confirm('Reset all stats? This cannot be undone.')) return;
    Object.assign(stats, freshStats());
    stats.history.push(game.bankroll);
    save();
    if (!$('sheet-stats').hidden) renderStats();
    toast('info', 'Stats reset', '');
  }
  $('btnResetStats').addEventListener('click', resetStats);

  $('btnResetBank').addEventListener('click', () => {
    if (midRound()) { toast('info', 'Finish the hand first', ''); return; }
    if (!confirm('Reset bankroll to ' + money(settings.startBank) + ' and shuffle a new shoe?')) return;
    game.bankroll = settings.startBank;
    game.reshuffle();
    game.phase = 'betting';
    game.dealer = [];
    game.hands = [];
    labelCache = {};
    seen.clear();
    stats.history.push(game.bankroll);
    bet = Math.min(bet || settings.unit, game.bankroll);
    render();
    setMessage('Place your bet');
    updateCount();
    updateControls();
    save();
    toast('info', 'Bankroll reset', money(game.bankroll) + ' and a fresh shoe.');
  });

  // ---------- Controls ----------
  // After a round, the first chip tap starts a fresh bet instead of adding to the last one.
  let betFresh = true;
  function prepNewBet() {
    if (betFresh) { bet = 0; betFresh = false; }
  }
  document.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    if (busy || midRound()) return;
    const v = Number(b.dataset.chip);
    if (game.phase === 'done') prepNewBet();
    bet = Math.min(bet + v, game.bankroll);
    sfx.chip();
    buzz(6);
    updateBetPanel();
    save();
  }));
  const clearBet = () => {
    if (busy || midRound()) return;
    bet = 0;
    betFresh = false;
    updateBetPanel();
    save();
  };
  $('betSpot').addEventListener('click', clearBet);
  $('btnClear').addEventListener('click', clearBet);
  $('btnUseAdvice').addEventListener('click', () => {
    if (busy || midRound()) return;
    bet = Math.min(suggestBet(game.trueCount, settings.unit, settings.maxSpread).amount, Math.floor(game.bankroll));
    betFresh = false;
    sfx.chip();
    updateBetPanel();
    save();
  });
  $('btnDeal').addEventListener('click', () => { betFresh = true; onDeal(); });
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onAct(b.dataset.act)));
  $('btnInsYes').addEventListener('click', () => onInsure(true));
  $('btnInsNo').addEventListener('click', () => onInsure(false));
  $('countPill').addEventListener('click', () => {
    settings.showCount = !settings.showCount;
    buzz(5);
    updateCount();
    updateBetPanel();
    save();
  });

  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---------- Boot ----------
  document.documentElement.style.setProperty('--speed', settings.speed);
  $('drillSpeed').value = settings.drillSpeed;
  $('drillSpeedVal').textContent = (settings.drillSpeed / 1000).toFixed(2).replace(/0$/, '') + 's';
  $('drillCount').value = String(settings.drillCount);
  $('drillPairs').checked = settings.drillPairs;
  updateRuleText();
  updateCount();
  updateControls();
  setMessage('Place your bet');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  // Exposed for debugging in the console.
  window.trainer = { game, settings, stats };
})();
