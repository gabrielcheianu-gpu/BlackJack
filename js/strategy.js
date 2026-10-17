/*
 * Basic strategy (multi-deck, late surrender), Illustrious 18 index plays and
 * bet-spread advice. Pure logic, shared by the app and the Node tests.
 *
 * Raw chart codes: H hit, S stand, P split, D double (else hit), Ds double (else stand),
 * R surrender (else hit), Rs surrender (else stand), Rp surrender (else split).
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const BJ = isNode ? require('./engine.js') : root.BJ;
  const api = factory(BJ);
  if (isNode) module.exports = api;
  else root.BJ = Object.assign(root.BJ, api);
})(typeof self !== 'undefined' ? self : this, function (BJ) {
  'use strict';

  const { cardValue, handTotal } = BJ;
  const between = (u, lo, hi) => u >= lo && u <= hi;

  // `u` is the dealer upcard value: 2–10, ace = 11.
  function pairCode(v, u, rules) {
    switch (v) {
      case 11: return 'P';
      case 10: return null;
      case 9: return u <= 9 && u !== 7 ? 'P' : null;
      case 8: return rules.h17 && rules.surrender && u === 11 ? 'Rp' : 'P';
      case 7: return u <= 7 ? 'P' : null;
      case 6: return (rules.das ? u <= 6 : between(u, 3, 6)) ? 'P' : null;
      case 5: return null;
      case 4: return rules.das && (u === 5 || u === 6) ? 'P' : null;
      default: return (rules.das ? u <= 7 : between(u, 4, 7)) ? 'P' : null; // 2s and 3s
    }
  }

  function surrenderCode(total, u, rules) {
    if (total === 16 && u >= 9) return 'R';
    if (total === 15 && u === 10) return 'R';
    if (rules.h17 && u === 11 && total === 15) return 'R';
    if (rules.h17 && u === 11 && total === 17) return 'Rs';
    return null;
  }

  function softCode(total, u, rules) {
    if (total >= 20) return 'S';
    if (total === 19) return rules.h17 && u === 6 ? 'Ds' : 'S';
    if (total === 18) {
      if (u >= 9) return 'H';
      if (between(u, 3, 6) || (rules.h17 && u === 2)) return 'Ds';
      return 'S';
    }
    if (total === 17) return between(u, 3, 6) ? 'D' : 'H';
    if (total >= 15) return between(u, 4, 6) ? 'D' : 'H';
    if (total >= 13) return between(u, 5, 6) ? 'D' : 'H';
    return 'H';
  }

  function hardCode(total, u, rules) {
    if (total >= 17) return 'S';
    if (total >= 13) return u <= 6 ? 'S' : 'H';
    if (total === 12) return between(u, 4, 6) ? 'S' : 'H';
    if (total === 11) return u <= 10 || rules.h17 ? 'D' : 'H';
    if (total === 10) return u <= 9 ? 'D' : 'H';
    if (total === 9) return between(u, 3, 6) ? 'D' : 'H';
    return 'H';
  }

  function isPair(cards) {
    return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
  }

  function rawPlay(cards, u, rules, canSplit) {
    const t = handTotal(cards);
    if (canSplit && isPair(cards)) {
      const p = pairCode(cardValue(cards[0]), u, rules);
      if (p) return p;
    }
    if (rules.surrender && !t.soft && cards.length === 2) {
      const r = surrenderCode(t.total, u, rules);
      if (r) return r;
    }
    return t.soft ? softCode(t.total, u, rules) : hardCode(t.total, u, rules);
  }

  /** Turn a chart code into a legal move given what the table allows right now. */
  function resolve(code, a) {
    switch (code) {
      case 'D': return a.canDouble ? 'D' : 'H';
      case 'Ds': return a.canDouble ? 'D' : 'S';
      case 'R': return a.canSurrender ? 'R' : 'H';
      case 'Rs': return a.canSurrender ? 'R' : 'S';
      case 'Rp': return a.canSurrender ? 'R' : a.canSplit ? 'P' : 'H';
      default: return code;
    }
  }

  // Illustrious 18 for multi-deck S17. Play `at` when TC >= index, otherwise `below`.
  const ILLUSTRIOUS_18 = [
    { label: 'Insurance vs A', insurance: true, up: 11, index: 3, text: 'Take insurance at TC ≥ +3' },
    { label: '16 vs 10', total: 16, up: 10, index: 0, at: 'S', below: 'H' },
    { label: '15 vs 10', total: 15, up: 10, index: 4, at: 'S', below: 'H' },
    { label: '10,10 vs 5', pair: 10, up: 5, index: 5, at: 'P', below: 'S' },
    { label: '10,10 vs 6', pair: 10, up: 6, index: 4, at: 'P', below: 'S' },
    { label: '10 vs 10', total: 10, up: 10, index: 4, at: 'D', below: 'H' },
    { label: '12 vs 3', total: 12, up: 3, index: 2, at: 'S', below: 'H' },
    { label: '12 vs 2', total: 12, up: 2, index: 3, at: 'S', below: 'H' },
    { label: '11 vs A', total: 11, up: 11, index: 1, at: 'D', below: 'H', s17Only: true },
    { label: '9 vs 2', total: 9, up: 2, index: 1, at: 'D', below: 'H' },
    { label: '10 vs A', total: 10, up: 11, index: 4, at: 'D', below: 'H' },
    { label: '9 vs 7', total: 9, up: 7, index: 3, at: 'D', below: 'H' },
    { label: '16 vs 9', total: 16, up: 9, index: 5, at: 'S', below: 'H' },
    { label: '13 vs 2', total: 13, up: 2, index: -1, at: 'S', below: 'H' },
    { label: '12 vs 4', total: 12, up: 4, index: 0, at: 'S', below: 'H' },
    { label: '12 vs 5', total: 12, up: 5, index: -2, at: 'S', below: 'H' },
    { label: '12 vs 6', total: 12, up: 6, index: -1, at: 'S', below: 'H' },
    { label: '13 vs 3', total: 13, up: 3, index: -2, at: 'S', below: 'H' },
  ];

  function findDeviation(cards, u, rules, canSplit, basic) {
    const t = handTotal(cards);
    for (const d of ILLUSTRIOUS_18) {
      if (d.insurance || d.up !== u) continue;
      if (d.s17Only && rules.h17) continue;
      if (d.pair) {
        if (canSplit && isPair(cards) && cardValue(cards[0]) === d.pair) return d;
        continue;
      }
      // Hard-total plays never override a split or a surrender.
      if (t.soft || t.total !== d.total || basic === 'P' || basic === 'R') continue;
      return d;
    }
    return null;
  }

  const UP_NAMES = { 11: 'A' };
  const upName = (u) => UP_NAMES[u] || String(u);

  function describeHand(cards, u, canSplit) {
    if (canSplit && isPair(cards)) {
      const v = cardValue(cards[0]);
      return 'Pair of ' + (v === 11 ? 'A' : v) + 's vs ' + upName(u);
    }
    const t = handTotal(cards);
    return (t.soft ? 'Soft ' : 'Hard ') + t.total + ' vs ' + upName(u);
  }

  /**
   * The correct play for a hand.
   * ctx: { cards, up, rules, canDouble, canSplit, canSurrender, trueCount, useDeviations }
   * Returns { action, basic, deviation, indexPlay, label }; `deviation` is set only when
   * the count changes the play, `indexPlay` whenever an index exists for this hand.
   * Actions are H/S/D/P/R.
   */
  function decide(ctx) {
    const u = cardValue(ctx.up);
    const basic = resolve(rawPlay(ctx.cards, u, ctx.rules, ctx.canSplit), ctx);
    const out = { action: basic, basic, deviation: null, label: describeHand(ctx.cards, u, ctx.canSplit) };
    if (ctx.useDeviations && ctx.trueCount != null) {
      const d = findDeviation(ctx.cards, u, ctx.rules, ctx.canSplit, basic);
      if (d) {
        out.indexPlay = d;
        const a = resolve(ctx.trueCount >= d.index ? d.at : d.below, ctx);
        if (a !== basic) { out.action = a; out.deviation = d; }
      }
    }
    return out;
  }

  function shouldInsure(trueCount, useDeviations) {
    return !!useDeviations && trueCount >= 3;
  }

  /** Simple Hi-Lo ramp: 1 unit at TC ≤ +1, then 2 units per true count, capped. */
  function suggestBet(trueCount, unit, maxSpread = 8) {
    const tc = Math.floor(trueCount);
    const units = tc < 2 ? 1 : Math.min(maxSpread, tc * 2 - 2);
    return { units, amount: units * unit };
  }

  /** Rows for the reference chart, built from the same logic the trainer grades with. */
  function chartData(rules) {
    const c = (r) => ({ rank: String(r) });
    const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const row = (label, cards, canSplit) => ({
      label, cells: ups.map((u) => rawPlay(cards, u, rules, canSplit)),
    });
    const hardHands = [
      ['5–8', [5, 3]], ['9', [5, 4]], ['10', [6, 4]], ['11', [7, 4]], ['12', [10, 2]],
      ['13', [10, 3]], ['14', [10, 4]], ['15', [10, 5]], ['16', [10, 6]], ['17', [10, 7]], ['18+', [10, 8]],
    ];
    return {
      ups: ups.map(upName),
      hard: hardHands.map(([l, cs]) => row(l, cs.map(c), false)),
      soft: [2, 3, 4, 5, 6, 7, 8, 9].map((n) => row('A,' + n, [c('A'), c(n)], false)),
      pairs: ['A', 10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => row(n + ',' + n, [c(n), c(n)], true)),
    };
  }

  return { ILLUSTRIOUS_18, rawPlay, resolve, decide, shouldInsure, suggestBet, chartData, describeHand };
});
