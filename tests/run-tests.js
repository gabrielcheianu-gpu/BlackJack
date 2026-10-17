/*
 * Logic tests for the engine and strategy. Run with:  node tests/run-tests.js
 * (Optional — the app itself doesn't need Node.)
 */
'use strict';
const assert = require('assert');
const BJ = require('../js/engine.js');
const S = require('../js/strategy.js');
const { Game, makeCard, handTotal, hiLo, isBlackjack } = BJ;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const cards = (...ranks) => ranks.map((r) => makeCard(r));

/** A game whose next draws are exactly `order` (deal order: P, D-up, P, D-hole, then hits). */
function rigged(order, opts = {}) {
  const g = new Game(Object.assign({ bankroll: 1000 }, opts));
  g.shoe.stack(order);
  return g;
}

console.log('\nHand totals');
test('hard totals', () => {
  assert.deepStrictEqual(handTotal(cards('10', '7')), { total: 17, soft: false });
  assert.deepStrictEqual(handTotal(cards('K', 'Q', '2')), { total: 22, soft: false });
});
test('soft ace counts 11', () => {
  assert.deepStrictEqual(handTotal(cards('A', '6')), { total: 17, soft: true });
});
test('ace drops to 1 when it would bust', () => {
  assert.deepStrictEqual(handTotal(cards('A', '6', '9')), { total: 16, soft: false });
});
test('two aces = soft 12, A A 9 = soft 21', () => {
  assert.deepStrictEqual(handTotal(cards('A', 'A')), { total: 12, soft: true });
  assert.deepStrictEqual(handTotal(cards('A', 'A', '9')), { total: 21, soft: true });
});
test('four aces = soft 14; A A A A 10 = hard 14', () => {
  assert.deepStrictEqual(handTotal(cards('A', 'A', 'A', 'A')), { total: 14, soft: true });
  assert.deepStrictEqual(handTotal(cards('A', 'A', 'A', 'A', '10')), { total: 14, soft: false });
});
test('blackjack only with two cards', () => {
  assert.ok(isBlackjack(cards('A', 'K')));
  assert.ok(!isBlackjack(cards('7', '7', '7')));
});

console.log('\nPayouts');
test('blackjack pays 3:2', () => {
  const g = rigged(['A', '9', 'K', '7'], { bankroll: 100 });
  g.deal(10);
  assert.strictEqual(g.phase, 'done');
  assert.strictEqual(g.hands[0].result, 'blackjack');
  assert.strictEqual(g.result.net, 15);
  assert.strictEqual(g.bankroll, 115);
});
test('3:2 on an odd bet keeps the half chip', () => {
  const g = rigged(['A', '9', 'K', '7'], { bankroll: 100 });
  g.deal(5);
  assert.strictEqual(g.bankroll, 107.5);
});
test('player and dealer blackjack push', () => {
  const g = rigged(['A', 'K', 'Q', 'A'], { bankroll: 100 });
  g.deal(10);
  assert.strictEqual(g.hands[0].result, 'push');
  assert.strictEqual(g.bankroll, 100);
});
test('dealer blackjack (ten up, peeked) takes the bet before you act', () => {
  const g = rigged(['9', 'K', '9', 'A'], { bankroll: 100 });
  g.deal(10);
  assert.strictEqual(g.phase, 'done');
  assert.strictEqual(g.hands[0].result, 'lose');
  assert.strictEqual(g.bankroll, 90);
});
test('regular win pays 1:1, push returns the bet', () => {
  let g = rigged(['10', '10', '9', '8'], { bankroll: 100 });
  g.deal(10); g.stand();
  assert.strictEqual(g.hands[0].result, 'win');
  assert.strictEqual(g.bankroll, 110);
  g = rigged(['10', '10', '8', '8'], { bankroll: 100 });
  g.deal(10); g.stand();
  assert.strictEqual(g.hands[0].result, 'push');
  assert.strictEqual(g.bankroll, 100);
});
test('double doubles the bet and draws exactly one card', () => {
  const g = rigged(['6', '6', '5', '10', '10', '9'], { bankroll: 100 });
  g.deal(10);
  g.double();
  assert.strictEqual(g.hands[0].cards.length, 3);
  assert.strictEqual(g.hands[0].bet, 20);
  // player 21 vs dealer 6+10+9 = 25 bust
  assert.strictEqual(g.hands[0].result, 'win');
  assert.strictEqual(g.bankroll, 120);
});
test('surrender returns half the bet', () => {
  const g = rigged(['10', '10', '6', '7'], { bankroll: 100 });
  g.deal(10);
  g.surrender();
  assert.strictEqual(g.hands[0].result, 'surrender');
  assert.strictEqual(g.bankroll, 95);
  assert.strictEqual(g.dealer.length, 2, 'dealer does not draw when no live hands');
});
test('bust loses even if dealer busts later', () => {
  const g = rigged(['10', '6', '6', '10', '10'], { bankroll: 100 });
  g.deal(10); g.hit();
  assert.strictEqual(g.hands[0].result, 'bust');
  assert.strictEqual(g.dealer.length, 2);
  assert.strictEqual(g.bankroll, 90);
});
test('insurance pays 2:1 when dealer has blackjack', () => {
  const g = rigged(['10', 'A', '9', 'K'], { bankroll: 100 });
  g.deal(10);
  assert.strictEqual(g.phase, 'insurance');
  g.insure(true);
  // main bet −10, insurance +10
  assert.strictEqual(g.result.net, 0);
  assert.strictEqual(g.bankroll, 100);
});
test('insurance is lost when dealer has no blackjack', () => {
  const g = rigged(['10', 'A', '9', '7'], { bankroll: 100 });
  g.deal(10);
  g.insure(true);
  assert.strictEqual(g.phase, 'playing');
  g.stand(); // 19 vs soft 18
  assert.strictEqual(g.result.insuranceNet, -5);
  assert.strictEqual(g.bankroll, 105);
});

console.log('\nDealer rules');
test('S17: dealer stands on soft 17', () => {
  const g = rigged(['10', 'A', '8', '6'], { rules: { h17: false } });
  g.deal(10); g.insure(false); g.stand();
  assert.strictEqual(g.dealer.length, 2);
  assert.strictEqual(g.hands[0].result, 'win');
});
test('H17: dealer hits soft 17', () => {
  const g = rigged(['10', 'A', '8', '6', '3'], { rules: { h17: true } });
  g.deal(10); g.insure(false); g.stand();
  assert.strictEqual(g.dealer.length, 3);
  assert.strictEqual(handTotal(g.dealer).total, 20);
  assert.strictEqual(g.hands[0].result, 'lose');
});
test('dealer hits hard 16, stands on hard 17', () => {
  const g = rigged(['10', '10', '8', '6', 'A'], {});
  g.deal(10); g.stand();
  assert.strictEqual(handTotal(g.dealer).total, 17);
  assert.strictEqual(g.hands[0].result, 'win');
});

console.log('\nSplitting');
test('split makes two hands, each with the original bet', () => {
  // P 8, D 10, P 8, D 7(hole), then 3 → hand1, 10 → hand2
  const g = rigged(['8', '10', '8', '7', '3', '10', '10'], { bankroll: 100 });
  g.deal(10);
  assert.ok(g.canSplit);
  g.split();
  assert.strictEqual(g.hands.length, 2);
  assert.strictEqual(g.bankroll, 80);
  assert.deepStrictEqual(g.hands[0].cards.map((c) => c.rank), ['8', '3']);
  assert.strictEqual(g.hands[1].cards.length, 1, 'second hand waits for its card');
  g.hit(); // 8,3,10 = 21 → auto-stand, moves to hand 2 which draws its second card
  assert.strictEqual(g.active, 1);
  assert.deepStrictEqual(g.hands[1].cards.map((c) => c.rank), ['8', '10']);
});
test('double after split allowed only with DAS', () => {
  let g = rigged(['8', '10', '8', '7', '3'], { rules: { das: true } });
  g.deal(10); g.split();
  assert.ok(g.canDouble);
  g = rigged(['8', '10', '8', '7', '3'], { rules: { das: false } });
  g.deal(10); g.split();
  assert.ok(!g.canDouble);
});
test('split aces get one card each and cannot be hit or resplit', () => {
  const g = rigged(['A', '9', 'A', '8', 'A', 'K'], { bankroll: 100 });
  g.deal(10);
  g.split();
  // A + A (no resplit, no more cards), A + K → both hands done, dealer plays 17
  assert.strictEqual(g.phase, 'done');
  assert.deepStrictEqual(g.hands.map((h) => h.cards.length), [2, 2]);
  assert.strictEqual(g.hands.length, 2);
});
test('21 after splitting aces is not blackjack (pays 1:1)', () => {
  const g = rigged(['A', '9', 'A', '8', 'K', '5'], { bankroll: 100 });
  g.deal(10);
  g.split();
  assert.strictEqual(g.hands[0].result, 'win');
  assert.strictEqual(g.hands[0].payout, 10);
  assert.notStrictEqual(g.hands[0].result, 'blackjack');
  // hand 2: A,5 = soft 16 vs dealer 17 → lose. Net 0.
  assert.strictEqual(g.bankroll, 100);
});
test('resplit up to four hands, then no more', () => {
  const g = rigged(['8', '10', '8', '7', '8', '8', '8'], { bankroll: 1000 });
  g.deal(10);
  g.split(); // hand1 gets 8 → 8,8
  assert.ok(g.canSplit); g.split();
  assert.ok(g.canSplit); g.split();
  assert.strictEqual(g.hands.length, 4);
  assert.ok(!g.canSplit, 'max 4 hands');
});
test('surrender not allowed after split', () => {
  const g = rigged(['8', '10', '8', '7', '3'], {});
  g.deal(10); g.split();
  assert.ok(!g.canSurrender);
});
test('cannot split or double without enough chips', () => {
  const g = rigged(['8', '10', '8', '7'], { bankroll: 15 });
  g.deal(10);
  assert.ok(!g.canSplit);
  assert.ok(!g.canDouble);
});

console.log('\nCounting');
test('Hi-Lo tags', () => {
  assert.deepStrictEqual(cards('2', '3', '4', '5', '6').map(hiLo), [1, 1, 1, 1, 1]);
  assert.deepStrictEqual(cards('7', '8', '9').map(hiLo), [0, 0, 0]);
  assert.deepStrictEqual(cards('10', 'J', 'Q', 'K', 'A').map(hiLo), [-1, -1, -1, -1, -1]);
});
test('hole card is not counted until revealed', () => {
  const g = rigged(['5', '6', '4', 'K', '10'], {});
  g.deal(10);
  assert.strictEqual(g.runningCount, 3, '5, 6, 4 visible; K hidden');
  g.stand(); // reveal K (−1); dealer 16 hits 10 (−1)
  assert.strictEqual(g.runningCount, 1);
});
test('true count = running count ÷ decks remaining', () => {
  const g = new Game({ rules: { decks: 2 } });
  g.runningCount = 6;
  assert.strictEqual(g.shoe.remaining, 104);
  assert.strictEqual(g.trueCount, 3);
});
test('count resets on reshuffle at the cut card', () => {
  const g = new Game({ rules: { decks: 1, penetration: 0.5 } });
  g.runningCount = 4;
  while (!g.shoe.needsShuffle) g.shoe.draw();
  g.deal(10);
  assert.ok(g.shuffledThisRound);
  // only the newly dealt visible cards count
  const visible = [...g.hands[0].cards, g.dealer[0], ...(g.holeHidden ? [] : [g.dealer[1]])];
  assert.strictEqual(g.runningCount, visible.reduce((s, c) => s + hiLo(c), 0));
});
test('a full shuffled shoe counts to zero', () => {
  const g = new Game({ rules: { decks: 6 } });
  assert.strictEqual(g.shoe.cards.reduce((s, c) => s + hiLo(c), 0), 0);
  assert.strictEqual(g.shoe.remaining, 312);
});

console.log('\nRandom play (20,000 rounds): money and count invariants');
test('bankroll always equals start + sum of round results; count matches visible cards', () => {
  let seed = 12345;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const g = new Game({ bankroll: 1e9, rng, rules: { decks: 6, penetration: 0.8 } });
  let expected = 1e9;
  let counted = 0; // independent count of every face-up card since the last shuffle
  const tallied = new Set();
  const tally = () => {
    const all = [...g.dealer, ...g.hands.flatMap((h) => h.cards)];
    for (const c of all) if (!c.faceDown && !tallied.has(c.id)) { tallied.add(c.id); counted += hiLo(c); }
  };
  for (let i = 0; i < 20000; i++) {
    const before = g.shoe;
    g.deal(10 + (i % 5) * 10);
    if (g.shoe !== before) { counted = 0; tallied.clear(); }
    if (g.phase === 'insurance') g.insure(rng() < 0.2 && g.canInsure);
    let guard = 0;
    while (g.phase === 'playing') {
      const d = S.decide({
        cards: g.hand.cards, up: g.dealer[0], rules: g.rules,
        canDouble: g.canDouble, canSplit: g.canSplit, canSurrender: g.canSurrender,
        trueCount: g.trueCount, useDeviations: true,
      });
      ({ H: () => g.hit(), S: () => g.stand(), D: () => g.double(), P: () => g.split(), R: () => g.surrender() })[d.action]();
      if (++guard > 50) throw new Error('round did not finish');
    }
    assert.strictEqual(g.phase, 'done');
    tally();
    expected += g.result.net;
    assert.ok(Math.abs(g.bankroll - expected) < 1e-6, 'bankroll drift at round ' + i);
    assert.strictEqual(g.runningCount, counted, 'count drift at round ' + i);
    for (const h of g.hands) {
      const t = handTotal(h.cards).total;
      if (h.result === 'bust') assert.ok(t > 21);
      if (h.result === 'blackjack') assert.ok(!h.fromSplit && h.cards.length === 2 && t === 21);
      if (h.splitAces) assert.strictEqual(h.cards.length, 2);
    }
    const dt = handTotal(g.dealer).total;
    const live = g.hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21);
    const playerNatural = g.hands[0].result === 'blackjack';
    if (live && !playerNatural && !isBlackjack(g.dealer)) assert.ok(dt >= 17, 'dealer stopped below 17: ' + JSON.stringify(g.hands.map((h) => h.result)));
  }
});

console.log('\nBasic strategy & deviations');
const rules6 = Object.assign({}, BJ.DEFAULT_RULES);
const play = (ranks, up, extra = {}) => S.decide(Object.assign({
  cards: cards(...ranks), up: makeCard(up), rules: rules6,
  canDouble: true, canSplit: true, canSurrender: true, trueCount: 0, useDeviations: false,
}, extra));
test('spot checks', () => {
  assert.strictEqual(play(['10', '6'], '10').action, 'R');
  assert.strictEqual(play(['10', '6'], '10', { canSurrender: false }).action, 'H');
  assert.strictEqual(play(['10', '2'], '4').action, 'S');
  assert.strictEqual(play(['10', '2'], '3').action, 'H');
  assert.strictEqual(play(['6', '5'], 'A').action, 'H');
  assert.strictEqual(play(['6', '5'], 'A', { rules: Object.assign({}, rules6, { h17: true }) }).action, 'D');
  assert.strictEqual(play(['A', '7'], '9').action, 'H');
  assert.strictEqual(play(['A', '7'], '2').action, 'S');
  assert.strictEqual(play(['A', '7'], '5').action, 'D');
  assert.strictEqual(play(['A', '7'], '5', { canDouble: false }).action, 'S');
  assert.strictEqual(play(['8', '8'], 'A').action, 'P');
  assert.strictEqual(play(['A', 'A'], '10').action, 'P');
  assert.strictEqual(play(['9', '9'], '7').action, 'S');
  assert.strictEqual(play(['K', 'Q'], '6').action, 'S');
  assert.strictEqual(play(['5', '5'], '9').action, 'D');
  assert.strictEqual(play(['4', '4'], '5').action, 'P');
  assert.strictEqual(play(['4', '4'], '5', { rules: Object.assign({}, rules6, { das: false }) }).action, 'H');
});
test('Illustrious 18 kicks in at the index', () => {
  const ns = { canSurrender: false, useDeviations: true };
  assert.strictEqual(play(['10', '6'], '10', Object.assign({ trueCount: -0.5 }, ns)).action, 'H');
  assert.strictEqual(play(['10', '6'], '10', Object.assign({ trueCount: 0 }, ns)).action, 'S');
  assert.strictEqual(play(['K', 'Q'], '6', { useDeviations: true, trueCount: 4.2 }).action, 'P');
  assert.strictEqual(play(['K', 'Q'], '6', { useDeviations: true, trueCount: 3.9 }).action, 'S');
  assert.strictEqual(play(['10', '2'], '4', { useDeviations: true, trueCount: -1 }).action, 'H');
  assert.strictEqual(play(['10', '3'], '2', { useDeviations: true, trueCount: -1 }).action, 'S');
  assert.strictEqual(play(['10', '3'], '2', { useDeviations: true, trueCount: -1.2 }).action, 'H');
  assert.ok(S.shouldInsure(3, true) && !S.shouldInsure(2.9, true) && !S.shouldInsure(5, false));
});
test('bet spread advice', () => {
  assert.strictEqual(S.suggestBet(0.5, 10).units, 1);
  assert.strictEqual(S.suggestBet(2.4, 10).units, 2);
  assert.strictEqual(S.suggestBet(3, 10).amount, 40);
  assert.strictEqual(S.suggestBet(9, 10, 8).units, 8);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
