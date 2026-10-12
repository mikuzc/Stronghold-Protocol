// 三阶远征 (this project's deliberate deviation, docs/design/match.md): the third chess form 王牌 `_c` and its merge
// rung (3 普通 → 精锐, 3 精锐 → 王牌), the per-mode pool every base needs to walk the whole ladder, the selectable round
// cap and the boss cadence "R14 and then every 7 rounds". Every official mode must be untouched by all of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPEDITION_CAPS } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { mergeProgress, mergeTarget, completesMerge } from '../../public/js/ui/gameLogic/shop.js';
import { isBossRoundOf, bossRoundShown } from '../../public/js/ui/gameLogic/camera.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, chessOfTier } from './harness.js';
import { runFull } from './fullmatchRun.js';

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
  assert.equal(exp.mode.hiddenRound, 31, 'the hidden core is the default cap\'s final boss');
  assert.equal(exp.hiddenRound, 31, '... and gamedata recomputes it from the cap');
  assert.equal(exp.mode.expedition.hiddenFinal, true);
  const off = new GameData(DATA, 'mode_single_normal');
  assert.equal(off.threeTier, false);
  assert.equal(off.mode.threeTier, undefined);
  assert.equal(off.mode.bossRounds, undefined);
  assert.equal(off.mode.poolCopies, undefined);
  // an elite outside a 三阶远征 mode stays terminal: no target, no merge count
  assert.equal(off.mergeTargetOf('chess_char_1_01_b'), null);
  assert.equal(off.mergeCount('chess_char_1_01_b'), 0);
});

test('三阶远征: the three caps set the last round, every one is a 最终攻势, and only the last one ends the run', () => {
  for (const entry of EXPEDITION_CAPS) {
    const gd = new GameData(DATA, 'mode_single_expedition', { expeditionCap: entry.id });
    assert.equal(gd.expeditionCapEntry.id, entry.id);
    assert.equal(gd.expeditionCap, entry.rounds, `${entry.id}: rounds`);
    assert.equal(gd.expeditionSealed, entry.sealed, `${entry.id}: sealed`);
    assert.equal(gd.lastRound, entry.rounds);
    const rounds = gd.bossRounds;
    assert.equal(gd.bossRound, entry.rounds, 'the last boss round is the cap');
    assert.ok(rounds.includes(entry.rounds), `cap ${entry.id} is a boss round`);
    assert.equal(rounds[0], 14, 'the official first 最终攻势 stays at R14');
    // every round at 14 + 7k is a boss round, and only the last one finishes the match
    for (const r of rounds) {
      assert.equal(gd.isBossRound(r), true, `R${r} is a 最终攻势`);
      assert.equal(gd.isBossFight(r), true, `R${r} is a boss fight`);
      assert.equal(gd.isFinalFightRound(r), r === entry.rounds, `R${r} ends the match only at the cap`);
    }
    assert.equal(gd.isFinalFightRound(entry.rounds), true, 'the cap round ends the run');
    // the 隐秘核心 is the FINAL boss, one round after the cap, and it ends the run too
    assert.equal(gd.hiddenRound, entry.rounds + 1, `${entry.id}: the 隐秘核心 follows the cap`);
    assert.equal(gd.isBossFight(gd.hiddenRound), true, `${entry.id}: the 隐秘核心 is a boss fight`);
    assert.equal(gd.isFinalFightRound(gd.hiddenRound), true, `${entry.id}: the 隐秘核心 finishes the match`);
    assert.equal(gd.roundCfg(gd.hiddenRound).isHidden, true, `${entry.id}: a hidden template`);
    assert.equal(gd.isFinalFightRound(entry.rounds + 2), false, `${entry.id}: nothing follows it`);
    // a normal round is neither
    assert.equal(gd.isBossFight(16), false);
    assert.equal(gd.isFinalFightRound(16), false);
    // the round data exists for every round the cap allows
    for (const r of [1, 13, 15, 16, 29, entry.rounds]) {
      assert.ok(gd.roundCfg(r), `R${r} has a round config`);
      assert.ok(gd.enemyScale(r).hpMul >= 0.5, `R${r} has an enemy scale`);
    }
  }
  // an unknown id falls back to the mode's own default cap
  const bogus = new GameData(DATA, 'mode_single_expedition', { expeditionCap: 'nope' });
  assert.equal(bogus.expeditionCapEntry.id, '30');
  assert.equal(bogus.lastRound, 30);
  // no cap option and no expedition entry → the official answer
  const off = new GameData(DATA, 'mode_single_normal', { expeditionCap: 'endless' });
  assert.equal(off.expeditionCap, null);
  assert.equal(off.expeditionCapEntry, null);
  assert.equal(off.expeditionSealed, false);
  assert.equal(off.lastRound, 14);
  assert.deepEqual(off.bossRounds, [14]);
  assert.equal(off.isFinalFightRound(14), true);
  assert.equal(off.isFinalFightRound(15), true, 'the official hidden round still finishes the match');
});

test('无限 (sealed) freezes the enemy curve at the seal round; 无尽 (endless) keeps it rising', () => {
  const sealed = new GameData(DATA, 'mode_single_expedition', { expeditionCap: 'sealed' });
  const endless = new GameData(DATA, 'mode_single_expedition', { expeditionCap: 'endless' });
  assert.equal(sealed.expeditionSealed, true);
  assert.equal(endless.expeditionSealed, false);
  assert.equal(sealed.lastRound, endless.lastRound, 'both run the same number of rounds');
  const at30 = sealed.enemyScale(30);
  // the seal starts AT the round: R30 keeps its own numbers (it is not clamped early), R31 onward reuse them
  assert.notDeepEqual(at30, sealed.enemyScale(29), 'R30 is not clamped to an earlier round');
  assert.deepEqual(sealed.enemyScale(31), at30, 'R31 onward reuse the R30 numbers');
  for (const r of [31, 50, 99]) {
    assert.deepEqual(sealed.enemyScale(r), at30, `sealed R${r} stays at the R30 numbers`);
    assert.ok(endless.enemyScale(r).hpMul > at30.hpMul, `endless R${r} keeps rising`);
    assert.ok(endless.enemyScale(r).atkMul > at30.atkMul, `endless R${r} keeps rising (atk)`);
  }
  // the seal must not leak into an official mode: its own rounds read exactly as they always did
  const off = new GameData(DATA, 'mode_single_normal', { expeditionCap: 'sealed' });
  assert.equal(off.expeditionSealed, false);
  assert.deepEqual(off.enemyScale(14), new GameData(DATA, 'mode_single_normal').enemyScale(14));
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

test('the client boss-round helpers read every 最终攻势, and fall back to the official scalars', () => {
  // a 三阶远征 frame: the list is the authority, so the boss-prep camera and the team frame fire at R21 / R28 too
  const exp = { round: 21, bossRound: 30, hiddenRound: null, bossRounds: [14, 21, 28, 30] };
  assert.equal(isBossRoundOf(exp, 14), true);
  assert.equal(isBossRoundOf(exp, 21), true);
  assert.equal(isBossRoundOf(exp, 28), true);
  assert.equal(isBossRoundOf(exp, 20), false);
  assert.equal(isBossRoundOf(exp, 30), true);
  // the boss card names the NEXT one, not the last
  assert.equal(bossRoundShown({ ...exp, round: 15 }, null), 21);
  assert.equal(bossRoundShown({ ...exp, round: 21 }, null), 21);
  assert.equal(bossRoundShown({ ...exp, round: 29 }, null), 30);
  // a frame or a fixture without the list keeps the official answer
  const official = { round: 14, bossRound: 14, hiddenRound: 15 };
  assert.equal(isBossRoundOf(official, 14), true);
  assert.equal(isBossRoundOf(official, 15), true, 'the hidden round is a boss fight');
  assert.equal(isBossRoundOf(official, 13), false);
  assert.equal(isBossRoundOf(official, 21), false);
  assert.equal(bossRoundShown(official, { bossRound: 14 }), 14);
  // the mode record alone is enough once the frame is gone (a dev fixture)
  assert.equal(bossRoundShown({ round: 16, bossRounds: [14, 21] }, { bossRound: 21, bossRounds: [14, 21] }), 21);
  assert.equal(bossRoundShown({}, undefined), 14, 'the historical fallback');
});

test('the 三阶远征 round cap is validated at the wire and is the only accepted shape', () => {
  for (const c of EXPEDITION_CAPS) assert.equal(validateC2S({ t: 'room.setExpeditionCap', cap: c.id }), null, `cap ${c.id}`);
  for (const bad of [0, 1, 30, 45, 100, -30, '45', '', 'SEALED', '30 ', null, undefined, 30.5]) {
    assert.notEqual(validateC2S({ t: 'room.setExpeditionCap', cap: bad }), null, `cap ${JSON.stringify(bad)} rejected`);
  }
});

test('三阶远征 end to end: a whole match runs through R30 with the real sim, zero errors, invariants at every phase', () => {
  // Boosted LP so the run is not cut short by ordinary leaks — the point is the ROUND LOOP: the intermediate 最终攻势
  // at R14 / R21 / R28 must each resume to the next round instead of finishing the match. roundsPassed >= 29 is that
  // evidence (a defeat in the R14 boss would report 13).
  for (const seed of [1, 2]) {
    const { res } = runFull({ mode: 'solo', difficulty: 'EXPEDITION', humans: 1, bots: 0, seed, boostLp: 4000, expeditionCap: '30' });
    assert.ok(res, `seed ${seed}: the match ended`);
    assert.ok(res.roundsPassed >= 29, `seed ${seed}: reached the final 最终攻势 (roundsPassed ${res.roundsPassed})`);
  }
});

test('the client merge helpers read the 王牌 rung only in a threeTier match', () => {
  const base = 'chess_char_1_02_a', elite = 'chess_char_1_02_b', ace = 'chess_char_1_02_c';
  assert.equal(DATA.chess[elite].aceChessId, ace, 'the fixture links the elite to its 王牌');
  const getChess = (id) => DATA.chess[id] || null;
  const priv = (threeTier) => ({
    threeTier,
    board: [{ kind: 'chess', id: elite, golden: true, row: 3, col: 2, dir: 'UP' }],
    hand: [{ kind: 'chess', id: elite, golden: true }, { kind: 'chess', id: base }],
    temp: [],
  });
  // 三阶远征: two 精锐 owned, so one more completes the 王牌 — and the tile is an ELITE's
  const on = priv(true);
  assert.deepEqual(mergeProgress(on, elite, getChess), { copies: 2, need: 3, ace: true });
  assert.deepEqual(mergeTarget(on, elite, getChess), { row: 3, col: 2, dir: 'UP' });
  assert.equal(completesMerge(on, { kind: 'chess', id: elite }, { getChess }), true);
  // an official match: the elite stays terminal, exactly as before this change
  const off = priv(false);
  assert.deepEqual(mergeProgress(off, elite, getChess), { copies: 0, need: 3 });
  assert.equal(mergeProgress(off, elite, getChess).ace, undefined);
  assert.equal(mergeTarget(off, elite, getChess), null);
  assert.equal(completesMerge(off, { kind: 'chess', id: elite }, { getChess }), false);
  // the normal rung is untouched either way, and the 王牌 itself never merges
  assert.deepEqual(mergeProgress(on, base, getChess), { copies: 1, need: 3 });
  assert.equal(completesMerge(on, { kind: 'chess', id: base }, { getChess }), false);
  assert.equal(mergeProgress(on, ace, getChess).copies, 0);
  assert.equal(completesMerge(on, { kind: 'chess', id: ace }, { getChess }), false);
  // the private frame is what carries the flag to the client
  assert.equal(typeof on.threeTier, 'boolean');
});

test('三阶远征: one tier-6 item draft follows every 最终攻势, on the ordinary 机变 flow', () => {
  for (const [modeId, solo] of [['mode_single_expedition', true], ['mode_multi_expedition', false]]) {
    const mode = DATA.config.modes[modeId];
    const sch = DATA.choices.schedule[modeId];
    assert.ok(sch, `${modeId}: a choices schedule`);
    // the two must agree (the engine enters the draft on config.spRounds, the cards come from the schedule)
    assert.deepEqual(sch.spRounds, mode.spRounds, `${modeId}: spRounds in sync`);
    assert.ok(sch.spRounds.length > 0);
    for (const r of sch.spRounds) {
      // right after a 最终攻势, and never ON a boss or hidden round (a draft would replace that round's prep)
      assert.equal(mode.rounds[String(r - 1)].isBoss, true, `${modeId}: R${r} follows a boss`);
      assert.equal(mode.rounds[String(r)].isBoss, false, `${modeId}: R${r} is not a boss round`);
      assert.equal(mode.bossRounds.includes(r), false, `${modeId}: R${r} is not a 最终攻势`);
      assert.equal(mode.expedition && mode.rounds[String(r)].isHidden, false, `${modeId}: R${r} is not the 隐秘核心`);
      const spec = sch.rounds[String(r)];
      assert.deepEqual(spec.families, [{ family: 'supply', weight: 100 }], `${modeId}: R${r} is a 道具补给 draft`);
      assert.equal(spec.cards, solo ? 3 : 6, `${modeId}: R${r} card count`);
      assert.deepEqual(spec.supplyTiers, [6, 6], `${modeId}: R${r} draws TIER-6 items`);
    }
    // the official modes keep their own cadence untouched
    assert.deepEqual(DATA.choices.schedule.mode_single_normal.spRounds, DATA.config.modes.mode_single_normal.spRounds);
  }
  assert.equal(DATA.choices.schedule.mode_single_normal.spRounds.includes(15), false, 'the official cadence is unchanged');
});

test('人事部文档: the effect AND the card face differ per mode, and each is correct on its side', async () => {
  const { store } = await import('../../public/js/store.js');
  const { itemDescOverride } = await import('../../public/js/ui/shopBar.js');
  const ITEM = 'chess_item_6_08_e_a';
  // data: only the two 三阶远征 modes override the card face; every official mode keeps the official text
  const expOv = DATA.config.modes.mode_single_expedition.itemDescOverrides;
  assert.ok(expOv && typeof expOv[ITEM] === 'string', 'the expedition overrides 人事部文档');
  assert.deepEqual(DATA.config.modes.mode_multi_expedition.itemDescOverrides, expOv);
  for (const id of ['mode_single_normal', 'mode_single_hard', 'mode_multi_normal', 'mode_training_1']) {
    assert.equal(DATA.config.modes[id].itemDescOverrides, undefined, `${id} keeps the official card face`);
  }
  assert.match(DATA.items[ITEM].desc, /9/, 'the official record still says 9');
  // client: the override wins only while the frame carries it
  const before = store.get();
  try {
    assert.equal(itemDescOverride(ITEM), null, 'no match → the official text');
    store.set({ match: { private: { itemDesc: expOv } } });
    assert.equal(itemDescOverride(ITEM), expOv[ITEM], 'the 三阶远征 text wins');
    assert.equal(itemDescOverride('chess_item_1_01_e_a'), null, 'an item the mode does not override keeps its own text');
    store.set({ match: { private: {} } });
    assert.equal(itemDescOverride(ITEM), null, 'an official frame carries no itemDesc');
  } finally {
    store.set({ match: before.match ?? null });
  }
});

test('the reward and trophy tables cover the expedition, and every official row is unchanged', () => {
  const rw = DATA.config.rewards.baseByRoundsPassed;
  const rounds = rw.map((r) => r.round);
  assert.deepEqual(rounds, [...rounds].sort((a, b) => a - b), 'rewardFor takes the LAST row, so the table must ascend');
  // the official rows keep their official counts
  for (const [r, n] of Object.entries({ 1: 10, 10: 100, 11: 120, 12: 140, 13: 160, 14: 200 })) {
    assert.equal(rw.find((x) => x.round === Number(r)).count, n, `R${r}`);
  }
  // every round a 三阶远征 run can report has a row, and past R14 the table keeps growing
  for (const cap of EXPEDITION_CAPS) {
    for (const passed of [cap.rounds, cap.rounds + 1]) {
      assert.ok(rw.filter((x) => x.round <= passed).pop(), `a reward row covers ${passed} rounds`);
    }
  }
  assert.equal(rw.find((x) => x.round === 15).count, 200, 'R15 is the OFFICIAL hidden round: it keeps the official 200');
  assert.ok(rw.find((x) => x.round === 31).count > 200, 'a 30-cap clear pays more than the R14 row');
  assert.equal(rw.find((x) => x.round === 99).count, 1880, 'the largest row (the 无尽/无限 cap round)');
  // trophies: `trophiesFor` stops at the FIRST row covering roundsPassed, so the official prefix must be intact
  const tr = DATA.config.trophies.byRoundsPassed;
  assert.deepEqual(tr.slice(0, 5).map((r) => r.maxRound), [4, 8, 11, 13, 14], 'the official prefix is unchanged');
  assert.deepEqual(tr[4], { maxRound: 14, FUNNY: 3, NORMAL: 4, HARD: 5, ABYSS: 6 });
  const maxRounds = tr.map((r) => r.maxRound);
  assert.deepEqual(maxRounds, [...maxRounds].sort((a, b) => a - b), 'ascending');
  for (const cap of EXPEDITION_CAPS) {
    assert.ok(tr.some((r) => r.maxRound >= cap.rounds + 1), `a trophy row covers ${cap.rounds + 1}`);
  }
  // an official run still reads its own row (R14 solo 标准 walks the official 14 rows only)
  const officialRow = tr.find((r) => 14 <= r.maxRound);
  assert.equal(officialRow.maxRound, 14, 'an R14 official clear still lands on the official row');
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
