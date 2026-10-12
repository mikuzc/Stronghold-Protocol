// 三阶远征 (this project's deliberate deviation, docs/design/match.md): the third chess form 王牌 `_c` and its merge
// rung (3 普通 → 精锐, 3 精锐 → 王牌), the per-mode pool every base needs to walk the whole ladder, the selectable round
// cap and the boss cadence "R14 and then every 7 rounds". Every official mode must be untouched by all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPEDITION_CAPS } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, chessOfTier } from './harness.js';

/** A 三阶远征 match at the first round's prep, funds topped up and the bench emptied. */
function prep(o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'EXPEDITION', seed: 11, ...o }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

/** A tier-1 base whose family has a 王牌 and whose pool the match can draw a full ladder from. */
const ladderBase = (m) => chessOfTier(1, (c) => c.position === 'MELEE' && !!m.gd.aceIdOf(c.chessId)).find((id) => m.pool.has(id));

const ladders = (ps, base, elite, ace) => ({
  normals: ps.countCopies(base),
  elites: ps.countCopies(elite),
  aces: ps.countCopies(ace),
});

test('三阶远征: the mode carries the flag and the official modes do not', () => {
  const exp = new GameData(DATA, 'mode_single_expedition');
  assert.equal(exp.threeTier, true);
  assert.equal(exp.mode.hiddenRound, null, 'the hidden core is not part of the expedition');
  const off = new GameData(DATA, 'mode_single_normal');
  assert.equal(off.threeTier, false);
  assert.equal(off.mode.threeTier, undefined);
  assert.equal(off.mode.bossRounds, undefined);
  assert.equal(off.mode.poolCopies, undefined);
  // an elite outside a 三阶远征 mode stays terminal: no target, no merge count
  assert.equal(off.mergeTargetOf('chess_char_1_01_b'), null);
  assert.equal(off.mergeCount('chess_char_1_01_b'), 0);
});

test('三阶远征: the selectable cap sets the last round, is always a 最终攻势, and only the last one ends the run', () => {
  for (const [cap, expected] of [[30, [14, 21, 28, 30]], [60, [14, 21, 28, 30, 35, 42, 49, 56, 60]], [99, null]]) {
    const gd = new GameData(DATA, 'mode_single_expedition', { expeditionCap: cap });
    assert.equal(gd.expeditionCap, cap);
    assert.equal(gd.lastRound, cap);
    const rounds = gd.bossRounds;
    assert.equal(gd.bossRound, cap, 'the last boss round is the cap');
    assert.ok(rounds.includes(cap), `cap ${cap} is a boss round`);
    assert.equal(rounds[0], 14, 'the official first 最终攻势 stays at R14');
    if (expected) assert.deepEqual(rounds, expected);
    // every round at 14 + 7k is a boss round, and only the last one finishes the match
    for (const r of rounds) {
      assert.equal(gd.isBossRound(r), true, `R${r} is a 最终攻势`);
      assert.equal(gd.isBossFight(r), true, `R${r} is a boss fight`);
      assert.equal(gd.isFinalFightRound(r), r === cap, `R${r} ends the match only at the cap`);
    }
    // a normal round is neither
    assert.equal(gd.isBossFight(16), false);
    assert.equal(gd.isFinalFightRound(16), false);
    // the round data exists for every round the cap allows
    for (const r of [1, 13, 15, 16, 29, cap]) {
      assert.ok(gd.roundCfg(r), `R${r} has a round config`);
      assert.ok(gd.enemyScale(r).hpMul >= 0.5, `R${r} has an enemy scale`);
    }
  }
  // no cap option and no expedition entry → the official answer
  const off = new GameData(DATA, 'mode_single_normal', { expeditionCap: 60 });
  assert.equal(off.expeditionCap, null);
  assert.equal(off.lastRound, 14);
  assert.deepEqual(off.bossRounds, [14]);
  assert.equal(off.isFinalFightRound(14), true);
  assert.equal(off.isFinalFightRound(15), true, 'the official hidden round still finishes the match');
});

test('三阶远征: the pool carries a whole ladder for every base, and the official pool is untouched', () => {
  const exp = new GameData(DATA, 'mode_single_expedition');
  const off = new GameData(DATA, 'mode_single_normal');
  const short = [];
  for (const id of exp.visibleChess) {
    // 3 普通 → 精锐, then 3 精锐 → 王牌: one ladder needs mergeCount(the elite rung) × the normal rung's need
    const need = exp.mergeCount(exp.goldenIdOf(id)) * Math.max(1, exp.mergeCount(id));
    if (exp.poolCopies(id) < need) short.push(`${id}: ${exp.poolCopies(id)} < ${need}`);
  }
  assert.deepEqual(short, [], 'every visible base must supply a full 3 × 3 ladder');
  // the official mode keeps the exported table exactly (the 5阶 8 / 6阶 5 that cannot)
  assert.equal(off.poolCopies('chess_char_5_01_a'), 8);
  assert.equal(exp.poolCopies('chess_char_5_01_a') >= 9, true);
  assert.equal(off.poolCopies('chess_char_6_01_a'), 5);
  assert.equal(exp.poolCopies('chess_char_6_01_a') >= 9, true);
});

test('三阶远征: 3 普通 → 精锐 and 3 精锐 → 王牌 in one cascade, conserving the pool copies', () => {
  const { m, ps } = prep();
  const base = ladderBase(m);
  assert.ok(base, 'a tier-1 base with a 王牌');
  const elite = m.gd.goldenIdOf(base);
  const ace = m.gd.aceIdOf(base);
  assert.ok(elite && ace, `${base} has both higher forms`);
  const cap = m.pool.cap(base);
  assert.ok(cap >= 9, `pool ${cap}`);

  for (let i = 1; i <= 2; i++) { ps.acquireChess(base); assert.deepEqual(ladders(ps, base, elite, ace), { normals: i, elites: 0, aces: 0 }, `after ${i} normal(s)`); }
  ps.acquireChess(base);
  assert.deepEqual(ladders(ps, base, elite, ace), { normals: 0, elites: 1, aces: 0 }, '3 普通 → 1 精锐');

  for (let i = 0; i < 3; i++) ps.acquireChess(base);
  assert.deepEqual(ladders(ps, base, elite, ace), { normals: 0, elites: 2, aces: 0 }, 'the second 精锐');
  for (let i = 0; i < 3; i++) ps.acquireChess(base);
  assert.deepEqual(ladders(ps, base, elite, ace), { normals: 0, elites: 0, aces: 1 }, 'the third 精锐 became the 王牌');
  assert.equal(ps.stats.merges, 4, 'three 精锐 merges and the 王牌 merge');
  // the ace holds every copy its ladder consumed, and gives them all back when it is destroyed
  const piece = [...ps.hand.filter(Boolean), ...ps.board.values()].find((p) => p && p.id === ace);
  assert.ok(piece, 'the ace is owned');
  assert.equal(piece.poolCopies, 9);
  assert.equal(m.pool.left(base), cap - 9);
  ps.returnCopies(piece);
  assert.equal(m.pool.left(base), cap);
  // destroy it: returnCopies only gives the pool copies back, the owner drops the piece (as a sale/destroy does)
  const handIdx = ps.hand.indexOf(piece);
  if (handIdx >= 0) ps.hand[handIdx] = null;
  ps.board.delete([...ps.board.entries()].find(([, p]) => p === piece)?.[0] ?? '');
  ps.recompute();
  ps.acquireChess(base);
  assert.deepEqual(ladders(ps, base, elite, ace), { normals: 1, elites: 0, aces: 0 }, 'the ladder starts over');
});

test('三阶远征: an ace never merges further, and holding three elites is impossible (it cascades at once)', () => {
  const { m, ps } = prep();
  const base = ladderBase(m);
  const elite = m.gd.goldenIdOf(base);
  const ace = m.gd.aceIdOf(base);
  assert.equal(m.gd.mergeCount(ace), 0, 'the 王牌 is terminal');
  assert.equal(m.gd.mergeTargetOf(ace), null);
  assert.equal(ps.completesChessMerge(ace), false);
  // the elite rung refuses to merge until the third elite exists
  assert.equal(ps.completesChessMerge(elite), false);
  for (let i = 0; i < 9; i++) ps.acquireChess(base);
  assert.equal(ps.countCopies(elite), 0, 'never three at once');
  assert.equal(ps.countCopies(ace), 1);
  assert.equal(ps.completesChessMerge(ace), false);
});

test('the official mode keeps its two forms: 9 普通 give three 精锐 and never a 王牌', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 11 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const m = h.m;
  const base = chessOfTier(1, (c) => c.position === 'MELEE' && !!DATA.chess[c.chessId].goldenId).find((id) => m.pool.has(id));
  const elite = m.gd.goldenIdOf(base);
  const ace = DATA.chess[elite].aceChessId;
  assert.ok(ace, 'the data still links the elite to its 王牌');
  assert.equal(m.gd.aceIdOf(base), null, 'but the official mode cannot reach it');
  for (let i = 0; i < 9; i++) ps.acquireChess(base);
  assert.equal(ps.countCopies(base), 0);
  assert.equal(ps.countCopies(elite), 3, 'three separate 精锐, no merge between them');
  assert.equal(ps.countCopies(ace), 0);
});
