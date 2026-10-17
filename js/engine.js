/*
 * Blackjack engine: cards, shoe, hand math, Hi-Lo count and the round flow.
 * Pure logic, no DOM, so it runs in the browser and in Node (tests/run-tests.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BJ = Object.assign(root.BJ || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const FACE_VALUES = { A: 11, J: 10, Q: 10, K: 10 };

  let nextId = 1;
  function makeCard(rank, suit) {
    return { id: nextId++, rank: String(rank), suit: suit || SUITS[nextId % 4] };
  }

  /** Blackjack value of a single card. Aces count 11 here; handTotal() demotes them. */
  function cardValue(card) {
    return FACE_VALUES[card.rank] || Number(card.rank);
  }

  /** Hi-Lo tag: 2–6 = +1, 7–9 = 0, 10/J/Q/K/A = −1. */
  function hiLo(card) {
    const v = cardValue(card);
    return v <= 6 ? 1 : v >= 10 ? -1 : 0;
  }

  /** Best total for a hand; `soft` means an ace is still counted as 11. */
  function handTotal(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      const v = cardValue(c);
      if (v === 11) { aces++; total += 1; } else total += v;
    }
    const soft = aces > 0 && total + 10 <= 21;
    return { total: soft ? total + 10 : total, soft };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && handTotal(cards).total === 21;
  }

  class Shoe {
    constructor(decks = 6, penetration = 0.75, rng = Math.random) {
      this.decks = decks;
      this.penetration = penetration;
      this.rng = rng;
      this.shuffle();
    }

    shuffle() {
      const cards = [];
      for (let d = 0; d < this.decks; d++) {
        for (const s of SUITS) for (const r of RANKS) cards.push(makeCard(r, s));
      }
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      this.cards = cards;
      this.total = cards.length;
    }

    draw() { return this.cards.pop(); }
    get remaining() { return this.cards.length; }
    get dealt() { return this.total - this.cards.length; }
    get decksRemaining() { return this.cards.length / 52; }
    get needsShuffle() { return this.dealt >= this.total * this.penetration; }

    /** Test helper: the next draws come out in exactly this order. */
    stack(list) {
      const cards = list.map((c) => (typeof c === 'object' ? c : makeCard(c)));
      this.cards.push(...cards.reverse());
    }
  }

  const DEFAULT_RULES = {
    decks: 6,
    h17: false,         // dealer hits soft 17
    das: true,          // double after split
    surrender: true,    // late surrender
    penetration: 0.75,  // reshuffle once this fraction of the shoe is dealt
    maxHands: 4,        // split up to 3 times
    bjPays: 1.5,        // 3:2
    resplitAces: false,
  };

  function newHand(bet) {
    return {
      cards: [], bet, done: false, doubled: false, surrendered: false,
      fromSplit: false, splitAces: false, result: null, payout: 0,
    };
  }

  /**
   * One player vs the dealer. Phases: betting → (insurance) → playing → dealer → done.
   * Bets leave the bankroll when placed and come back (with winnings) at settle().
   */
  class Game {
    constructor(opts = {}) {
      this.rules = Object.assign({}, DEFAULT_RULES, opts.rules);
      this.bankroll = opts.bankroll != null ? opts.bankroll : 1000;
      this.rng = opts.rng || Math.random;
      this.shoe = new Shoe(this.rules.decks, this.rules.penetration, this.rng);
      this.runningCount = 0;
      this.seq = 0;
      this.phase = 'betting';
      this.dealer = [];
      this.hands = [];
      this.active = 0;
      this.holeHidden = false;
      this.insurance = 0;
      this.result = null;
      this.shuffledThisRound = false;
    }

    setRules(rules) {
      const oldDecks = this.rules.decks;
      this.rules = Object.assign({}, this.rules, rules);
      if (oldDecks !== this.rules.decks) this.reshuffle();
      else this.shoe.penetration = this.rules.penetration;
    }

    reshuffle() {
      this.shoe = new Shoe(this.rules.decks, this.rules.penetration, this.rng);
      this.runningCount = 0;
      this.shuffledThisRound = true;
    }

    get decksRemaining() { return this.shoe.decksRemaining; }

    /** Running count ÷ decks remaining (floored at half a deck to avoid wild values). */
    get trueCount() {
      return this.runningCount / Math.max(this.shoe.decksRemaining, 0.5);
    }

    get hand() { return this.hands[this.active]; }

    draw(faceUp = true) {
      if (!this.shoe.remaining) this.reshuffle();
      const card = this.shoe.draw();
      card.seq = ++this.seq;
      card.faceDown = !faceUp;
      if (faceUp) this.runningCount += hiLo(card);
      return card;
    }

    deal(bet) {
      if (this.phase !== 'betting' && this.phase !== 'done') throw new Error('Round in progress');
      if (!(bet > 0) || bet > this.bankroll) throw new Error('Invalid bet');
      this.shuffledThisRound = false;
      if (this.shoe.needsShuffle) this.reshuffle();
      this.bankroll -= bet;
      this.insurance = 0;
      this.result = null;
      this.active = 0;
      const hand = newHand(bet);
      this.hands = [hand];
      this.dealer = [];
      hand.cards.push(this.draw());
      this.dealer.push(this.draw());
      hand.cards.push(this.draw());
      const hole = this.draw(false);
      hole.hole = true;
      this.dealer.push(hole);
      this.holeHidden = true;
      if (this.dealer[0].rank === 'A') {
        this.phase = 'insurance';
        return this;
      }
      return this.checkNaturals();
    }

    get canInsure() {
      return this.phase === 'insurance' && this.bankroll >= this.hands[0].bet / 2;
    }

    insure(take) {
      if (this.phase !== 'insurance') throw new Error('No insurance offered');
      if (take) {
        if (!this.canInsure) throw new Error('Cannot afford insurance');
        this.insurance = this.hands[0].bet / 2;
        this.bankroll -= this.insurance;
      }
      return this.checkNaturals();
    }

    /** Dealer peeks under an ace or ten; naturals end the round immediately. */
    checkNaturals() {
      if (isBlackjack(this.dealer) || isBlackjack(this.hands[0].cards)) {
        this.hands[0].done = true;
        this.revealHole();
        return this.settle();
      }
      this.phase = 'playing';
      return this;
    }

    revealHole() {
      if (!this.holeHidden) return;
      this.holeHidden = false;
      const hole = this.dealer[1];
      hole.faceDown = false;
      this.runningCount += hiLo(hole);
    }

    get canHit() {
      const h = this.hand;
      return this.phase === 'playing' && !h.done && !h.splitAces && handTotal(h.cards).total < 21;
    }

    get canStand() { return this.phase === 'playing'; }

    get canDouble() {
      const h = this.hand;
      return this.phase === 'playing' && h.cards.length === 2 && !h.splitAces &&
        (!h.fromSplit || this.rules.das) && this.bankroll >= h.bet;
    }

    get canSplit() {
      const h = this.hand;
      if (this.phase !== 'playing' || h.cards.length !== 2) return false;
      if (cardValue(h.cards[0]) !== cardValue(h.cards[1])) return false;
      if (this.hands.length >= this.rules.maxHands) return false;
      if (h.splitAces && !this.rules.resplitAces) return false;
      return this.bankroll >= h.bet;
    }

    get canSurrender() {
      const h = this.hand;
      return this.phase === 'playing' && this.rules.surrender && this.hands.length === 1 &&
        h.cards.length === 2 && !h.fromSplit;
    }

    require(ok, action) {
      if (!ok) throw new Error('Cannot ' + action + ' now');
    }

    hit() {
      this.require(this.canHit, 'hit');
      const h = this.hand;
      h.cards.push(this.draw());
      if (handTotal(h.cards).total >= 21) h.done = true;
      return this.advance();
    }

    stand() {
      this.require(this.canStand, 'stand');
      this.hand.done = true;
      return this.advance();
    }

    double() {
      this.require(this.canDouble, 'double');
      const h = this.hand;
      this.bankroll -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
      return this.advance();
    }

    split() {
      this.require(this.canSplit, 'split');
      const h = this.hand;
      this.bankroll -= h.bet;
      const aces = h.cards[0].rank === 'A';
      const other = newHand(h.bet);
      other.cards.push(h.cards.pop());
      h.fromSplit = other.fromSplit = true;
      h.splitAces = other.splitAces = aces;
      this.hands.splice(this.active + 1, 0, other);
      return this.advance();
    }

    surrender() {
      this.require(this.canSurrender, 'surrender');
      this.hand.surrendered = true;
      this.hand.done = true;
      return this.advance();
    }

    /**
     * Move to the next unfinished hand. A split hand gets its second card when it
     * becomes active (as at a real table); split aces get one card and stop.
     */
    advance() {
      while (this.active < this.hands.length) {
        const h = this.hands[this.active];
        if (h.cards.length === 1) h.cards.push(this.draw());
        if (h.splitAces || handTotal(h.cards).total >= 21) h.done = true;
        if (!h.done) { this.phase = 'playing'; return this; }
        this.active++;
      }
      this.active = this.hands.length - 1;
      return this.playDealer();
    }

    playDealer() {
      this.phase = 'dealer';
      this.revealHole();
      const live = this.hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21);
      if (live) {
        for (;;) {
          const t = handTotal(this.dealer);
          const hits = t.total < 17 || (t.total === 17 && t.soft && this.rules.h17);
          if (!hits) break;
          this.dealer.push(this.draw());
        }
      }
      return this.settle();
    }

    settle() {
      const dealerTotal = handTotal(this.dealer).total;
      const dealerBJ = isBlackjack(this.dealer);
      let returned = 0;
      let wagered = this.insurance;
      for (const h of this.hands) {
        const t = handTotal(h.cards).total;
        const natural = !h.fromSplit && isBlackjack(h.cards);
        let back;
        wagered += h.bet;
        if (h.surrendered) { h.result = 'surrender'; back = h.bet / 2; }
        else if (t > 21) { h.result = 'bust'; back = 0; }
        else if (natural && dealerBJ) { h.result = 'push'; back = h.bet; }
        else if (natural) { h.result = 'blackjack'; back = h.bet * (1 + this.rules.bjPays); }
        else if (dealerBJ) { h.result = 'lose'; back = 0; }
        else if (dealerTotal > 21 || t > dealerTotal) { h.result = 'win'; back = h.bet * 2; }
        else if (t === dealerTotal) { h.result = 'push'; back = h.bet; }
        else { h.result = 'lose'; back = 0; }
        h.payout = back - h.bet;
        returned += back;
      }
      let insuranceNet = 0;
      if (this.insurance) {
        const back = dealerBJ ? this.insurance * 3 : 0;
        returned += back;
        insuranceNet = back - this.insurance;
      }
      this.bankroll += returned;
      this.result = { net: returned - wagered, dealerTotal, dealerBJ, insuranceNet };
      this.phase = 'done';
      return this;
    }
  }

  return { SUITS, RANKS, DEFAULT_RULES, makeCard, cardValue, hiLo, handTotal, isBlackjack, Shoe, Game };
});
