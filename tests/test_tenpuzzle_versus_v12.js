// テンパズル v1.2 分割 4-4（対戦本体）の2ウィンドウ対戦テスト：Firebase エミュレータ（auth + database）＋ Playwright の複数コンテキスト。
// 実行: npm install && npm run test:versus （= firebase emulators:exec --only auth,database --project demo-tp-lobby "node tests/test_tenpuzzle_versus_v12.js"）
// 時間の短縮：1問の制限時間をテストだけ 8 秒にする（クライアントは差し替え口 __TP_FB_TEST__.timing.roundMs、ルールは締切の定数 61000 を 9000 に置き換えた
//   テスト用の写し。置き換えた以外は firebase/tenpuzzle-rules.cjs と同一であることを V00 で確認）。本番の定数・ルールファイルは変えない。
// 組セットの固定：作れない組の位置などを決めるため、ホストに __TP_FB_TEST__.seedHex を渡して seed の乱数部分を固定する。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const fragment = require('../firebase/tenpuzzle-rules.cjs');
const HTML = path.join(__dirname, '..', 'prototype-tenpuzzle-v12.html');
const NS = 'demo-tp-lobby', DB = 'http://127.0.0.1:9000';
const SDK = path.join(__dirname, '..', 'node_modules', 'firebase');
const ROUND_MS = 8000, FORFEIT_MS = 6000;
// テスト用のルールの写し：締切の定数 61000→9000、切断の猶予の定数 30000→6000 だけを置き換える（それ以外は本番のルールと同一：V00 で確認）
const GRACE_EXPR = "offlineAt').val() + 30000";
const TEST_RULES = JSON.stringify(fragment).split('61000').join(String(ROUND_MS + 1000)).split(GRACE_EXPR).join("offlineAt').val() + " + FORFEIT_MS);
const TEST_CFG = { config: { apiKey: 'fake-api-key', authDomain: 'localhost', databaseURL: 'https://' + NS + '.firebaseio.com', projectId: NS, appId: '1:1:web:1' },
  emulator: { auth: 'http://127.0.0.1:9099', dbHost: '127.0.0.1', dbPort: 9000 }, timing: { roundMs: ROUND_MS, forfeitMs: FORFEIT_MS } };
// CORE（Node 側で組セットを先に計算するため）
const H = fs.readFileSync(HTML, 'utf8');
const TP = (() => { const m = H.match(/\/\/ ===== CORE_START =====([\s\S]*?)\/\/ ===== CORE_END =====/); const mod = { exports: {} }; new Function('module', m[1])(mod); return mod.exports; })();
const POOL = JSON.parse(H.match(/id="pool-data"[^>]*>([\s\S]*?)<\/script>/)[1]);

let pass = 0, fail = 0; const failures = [], queue = [], groups = {};
function test(name, fn) { queue.push({ name, fn }); const g = name.split(' ')[0].replace(/[0-9]+$/, ''); groups[g] = (groups[g] || 0) + 1; }
const dbGet = async (p) => (await fetch(DB + '/' + p + '.json?ns=' + NS + '&access_token=owner')).json();
const dbPut = async (p, v) => { const r = await fetch(DB + '/' + p + '.json?ns=' + NS + '&access_token=owner', { method: 'PUT', body: JSON.stringify(v) }); assert.strictEqual(r.status, 200); };
const dbClear = async () => { await fetch(DB + '/.json?ns=' + NS + '&access_token=owner', { method: 'DELETE' }); };
async function setRules(json) { const r = await fetch(DB + '/.settings/rules.json?ns=' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: '{"rules":{"games":{"tenpuzzle":' + json + '}}}' }); assert.strictEqual(r.status, 200, await r.text()); }

let browser;
async function player(opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.route('https://www.gstatic.com/firebasejs/12.12.0/*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SDK, path.basename(route.request().url()))) }));
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(({ cfg, name, mode }) => {
    try { if (!sessionStorage.getItem('__i')) { localStorage.clear(); sessionStorage.setItem('__i', '1'); if (name) localStorage.setItem('tenpuzzle_name', name); localStorage.setItem('tenpuzzle_settings_v1', JSON.stringify({ controlMode: mode, bgm: false })); } } catch (e) { /* 続行 */ }
    window.__TP_FB_TEST__ = JSON.parse(JSON.stringify(cfg));
  }, { cfg: TEST_CFG, name: opts.name || '', mode: opts.mode || 'B' });
  await page.goto('file://' + HTML); await page.waitForFunction(() => !!window.__TP_UI);
  return { ctx, page, errs, name: opts.name };
}
const closeAll = async (ps) => { for (const p of ps) { try { await p.ctx.close(); } catch (e) { /* 閉じ済み */ } } };
const text = (p, sel) => p.page.locator(sel).innerText();
async function openOnline(p) { await p.page.click('#onlineBtnTitle'); await p.page.waitForSelector('#ol-create:not([disabled])', { timeout: 15000 }); }
// 部屋を作って参加し、モードを選び、両者 ready → 開始。pred(sets) を満たす seed を選ぶ（seedHex を固定）
async function startMatch(a, b, mode, pred) {
  await openOnline(a); await a.page.click('#ol-create'); await a.page.waitForSelector('#ol-code-big'); const code = (await text(a, '#ol-code-big')).trim();
  await openOnline(b); await b.page.click('#ol-join-open'); await b.page.fill('#ol-code', code); await b.page.click('#ol-join'); await b.page.waitForSelector('#ol-code-big');
  await a.page.click('#ol-mode-' + mode); await b.page.waitForSelector('#ol-mode-' + mode + '.on');
  let hex = null;
  for (let k = 0; k < 20000; k++) { const hx = (k.toString(16) + '0000000000000000').slice(0, 16); const sets = TP.versusSets(POOL, code + ':' + hx + ':1', mode); if (!pred || pred(sets)) { hex = hx; break; } }
  assert(hex, 'seed が見つからない'); await a.page.evaluate(hx => { window.__TP_FB_TEST__.seedHex = hx; }, hex);
  await a.page.click('#ol-ready'); await b.page.click('#ol-ready'); await a.page.waitForSelector('#ol-start:not([disabled])'); await a.page.click('#ol-start');
  const sets = TP.versusSets(POOL, code + ':' + hex + ':1', mode);
  return { code, sets, seed: code + ':' + hex + ':1' };
}
const view = (p) => p.page.evaluate(() => { const v = window.__TP_UI.vsView(); return { ok: v.ok, phase: v.phase, i: v.round ? v.round.i : null, label: v.round ? v.round.label : null, suddenN: v.state ? v.state.suddenN : null, scores: v.scores, outcome: v.outcome, finished: v.finished, revealI: v.reveal ? v.reveal.i : null, endedBy: v.state ? v.state.endedBy : null }; });
async function waitPlay(p, i, ms) { await p.page.waitForFunction(i => { const v = window.__TP_UI.vsView(); return v.ok && v.phase === 'play' && v.round.i === i && window.__TP_UI.VSS.i === i && !!document.querySelector('#vs-label') && !!document.querySelector('#vs-timer'); }, i, { timeout: ms || 20000 }); }
async function waitFinished(p, ms) { await p.page.waitForFunction(() => { const v = window.__TP_UI.vsView(); return v.ok && v.phase === 'finished'; }, null, { timeout: ms || 30000 }); await p.page.waitForSelector('#vs-final'); }
// 解き方（操作方法B：カード i, j → 記号）を Node 側で探す
function findPlan(digits) {
  const start = TP.newBoard(digits);
  function rec(b) {
    if (b.cards.length === 1) return TP.isWin(b) ? [] : null;
    for (let i = 0; i < b.cards.length; i++) for (let j = 0; j < b.cards.length; j++) { if (i === j) continue; for (const op of ['+', '-', '*', '/']) {
      const c = TP.restoreBoard(TP.serializeBoard(b), digits); const r = TP.merge(c, i, j, op); if (!r.ok) continue; const rest = rec(c); if (rest) return [[i, j, op]].concat(rest); } }
    return null;
  }
  return rec(start);
}
const playMoves = (p, moves) => p.page.evaluate(ms => { const U = window.__TP_UI; ms.forEach(([i, j, op]) => { U.handle('vs-card', { dataset: { i: String(i) } }); U.handle('vs-card', { dataset: { i: String(j) } }); U.handle('vs-op', { dataset: { op } }); }); return U.VSS.board.cards.length; }, moves);
async function solveRound(p, sets, i) { const plan = findPlan(POOL.find(e => TP.keyOf(e.digits) === sets[i].key).digits); assert(plan, 'no plan'); await playMoves(p, plan); }
const declare = (p) => p.page.evaluate(() => window.__TP_UI.handle('vs-declare'));
async function bothConsistent(a, b) {
  const va = await view(a), vb = await view(b); assert.deepStrictEqual(va.scores, vb.scores, 'スコアが両画面で一致'); assert.strictEqual(va.finished, vb.finished);
  if (va.finished) { assert(['win', 'lose', 'draw'].includes(va.outcome)); if (va.outcome === 'draw') assert.strictEqual(vb.outcome, 'draw'); else assert.strictEqual(va.outcome === 'win', vb.outcome === 'lose'); }
  return [va, vb];
}
const withPlayers = (names, fn, opts) => async () => {
  await dbClear(); const ps = []; opts = opts || {};
  try { for (const n of names) ps.push(await player({ name: n, mode: opts.mode })); await fn(ps); for (const p of ps) assert.deepStrictEqual(p.errs, [], 'pageerror: ' + p.name); } finally { await closeAll(ps); }
};

// ---------------- 準備 ----------------
test('V00 テスト用のルールは、締切の定数（61000→9000）と切断の猶予の定数（30000→6000）を置き換えただけで firebase/tenpuzzle-rules.cjs と同一', () => {
  const real = JSON.stringify(fragment);
  assert.strictEqual(TEST_RULES.split(String(ROUND_MS + 1000)).join('61000').split("offlineAt').val() + " + FORFEIT_MS).join(GRACE_EXPR), real);
  assert.strictEqual((real.match(/61000/g) || []).length, 24); assert.strictEqual(real.split(GRACE_EXPR).length - 1, 8);
  assert(!real.includes(String(ROUND_MS + 1000))); assert(!real.includes("offlineAt').val() + " + FORFEIT_MS));
});

// ---------------- フル試合 ----------------
test('M01 1組勝負：開始は両画面同時（差<200ms）。A が解く → 両画面で A の勝ち・スコア一致。DB の result は A 名義の solve', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1);
  await waitPlay(a, 0); await waitPlay(b, 0);
  const ta = await a.page.evaluate(() => window.__TP_UI.VSS.log.find(x => x.sig.startsWith('play:0')).t), tb = await b.page.evaluate(() => window.__TP_UI.VSS.log.find(x => x.sig.startsWith('play:0')).t);
  assert(Math.abs(ta - tb) < 200, '開始時刻の差 ' + (ta - tb) + 'ms');
  assert.strictEqual(await a.page.locator('#vs-declare').count(), 0, '1組勝負では「作れません」を出さない');
  await solveRound(a, m.sets, 0);
  await waitFinished(a); await waitFinished(b);
  const [va, vb] = await bothConsistent(a, b); assert.strictEqual(va.outcome, 'win'); assert.strictEqual(vb.outcome, 'lose');
  assert((await text(a, '#vs-final')).includes('勝ち')); assert((await text(b, '#vs-final')).includes('負け'));
  const room = await dbGet('games/tenpuzzle/rooms/' + m.code); const aUid = await a.page.evaluate(() => window.__TP_UI.OL.uid);
  assert.strictEqual(room.rounds[0].result.by, aUid); assert.strictEqual(room.rounds[0].result.kind, 'solve'); assert.strictEqual(room.rounds[1], undefined, '最終ラウンドの後に次の startAt を書かない');
  assert(TP.verifySolveExpr(room.rounds[0].result.expr, POOL.find(e => TP.keyOf(e.digits) === m.sets[0].key).digits).ok);
}));
test('M02 3組勝負：A・B・A の順に解く → 4対2で A の勝ち。各ラウンドの開示（勝者の式・難易度・点）を経て、両画面のスコア・勝敗・各ラウンドの結果が一致', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3);
  for (const [i, who] of [[0, a], [1, b], [2, a]]) {
    await waitPlay(a, i); await waitPlay(b, i); assert.strictEqual(await a.page.locator('#vs-declare').count(), 0); assert((await text(a, '#vs-label')).includes('第' + (i + 1) + '問 / 3'));
    await solveRound(who, m.sets, i);
    if (i < 2) { await (who === a ? b : a).page.waitForSelector('#vs-reveal'); const other = who === a ? b : a; assert((await text(other, '#vs-reveal-who')).includes(who === a ? 'あきら' : 'べにこ')); assert((await text(other, '#vs-reveal-pts')).includes((i + 1) + '点')); assert((await text(other, '#vs-reveal-tier')).includes(m.sets[i].tier)); }
  }
  await waitFinished(a); await waitFinished(b); const [va] = await bothConsistent(a, b); assert.strictEqual(va.outcome, 'win');
  const myScore = await a.page.evaluate(() => window.__TP_UI.vsView().myScore); assert.strictEqual(myScore, 4);
  assert.strictEqual(await a.page.locator('#vs-rows .r').count(), 3); assert.strictEqual(await b.page.locator('#vs-rows .r').count(), 3);
  assert((await text(a, '#vs-row-0')).includes('あなた')); assert((await text(b, '#vs-row-0')).includes('あきら')); assert((await text(a, '#vs-row-1')).includes('べにこ')); assert((await text(b, '#vs-row-1')).includes('あなた'));
}));
test('M03 5組勝負（作れない組あり）：お手つき（A が解ける組で宣言 → 10秒操作不可、B の画面に「お手つき中」）→ B が解く。作れない組は B が正しく宣言して5点。両画面のスコア・勝敗が一致', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 5, sets => sets.findIndex(x => x.tier === '作れない') === 1);
  await waitPlay(a, 0); await waitPlay(b, 0);
  assert.strictEqual(await a.page.locator('#vs-declare').count(), 1, '5組の本戦では「作れません」を出す');
  await declare(a); await b.page.waitForFunction(() => /お手つき中/.test((document.querySelector('#vs-opplock') || {}).textContent || ''), null, { timeout: 5000 });
  assert(/お手つき！/.test(await text(a, '#vs-mylock'))); const before = await a.page.evaluate(() => window.__TP_UI.VSS.board.cards.length);
  await a.page.evaluate(() => { const U = window.__TP_UI; U.handle('vs-card', { dataset: { i: '0' } }); U.handle('vs-card', { dataset: { i: '1' } }); U.handle('vs-op', { dataset: { op: '+' } }); });
  assert.strictEqual(await a.page.evaluate(() => window.__TP_UI.VSS.board.cards.length), before, 'お手つき中は操作できない');
  const lockDb = await dbGet('games/tenpuzzle/rooms/' + m.code + '/live/' + await a.page.evaluate(() => window.__TP_UI.OL.uid) + '/lockUntil'); assert(lockDb > Date.now() + 5000, 'live.lockUntil ≈ now+10000');
  assert.strictEqual(await dbGet('games/tenpuzzle/rooms/' + m.code + '/rounds/0/result'), null, '誤った宣言では結果を書かない');
  await solveRound(b, m.sets, 0);
  await waitPlay(a, 1); await waitPlay(b, 1); await declare(b);
  await a.page.waitForSelector('#vs-reveal'); assert((await text(a, '#vs-reveal-expr')).includes('作れない組でした')); assert((await text(a, '#vs-reveal-pts')).includes('5点'));
  for (let i = 2; i < 5; i++) { await waitPlay(a, i, 25000); await waitPlay(b, i, 25000); await solveRound(i % 2 ? b : a, m.sets, i); }
  await waitFinished(a); await waitFinished(b); const [va, vb] = await bothConsistent(a, b);
  const res = await dbGet('games/tenpuzzle/rooms/' + m.code + '/rounds'); assert.strictEqual(res[1].result.kind, 'declare');
  const expect = TP.versusReduce({ mode: 5, players: va.scores ? await a.page.evaluate(() => window.__TP_UI.vsView().players) : null, plan: m.sets.map(x => x.pts) }, [0, 1, 2, 3, 4].map(i => res[i].result));
  assert.deepStrictEqual(va.scores, expect.scores); assert.strictEqual(vb.outcome, expect.winner === await b.page.evaluate(() => window.__TP_UI.OL.uid) ? 'win' : 'lose');
}));
test('M04 先着の競合：両者がほぼ同時に解く → 勝者は1人だけ。両画面で同じ勝者、負けた側は「タッチの差」', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await waitPlay(b, 0);
  const plan = findPlan(POOL.find(e => TP.keyOf(e.digits) === m.sets[0].key).digits); const head = plan.slice(0, -1), last = plan.slice(-1);
  await playMoves(a, head); await playMoves(b, head);
  await Promise.all([playMoves(a, last), playMoves(b, last)]);
  await waitFinished(a); await waitFinished(b); const [va, vb] = await bothConsistent(a, b);
  assert.notStrictEqual(va.outcome, vb.outcome); const room = await dbGet('games/tenpuzzle/rooms/' + m.code);
  const winnerPage = va.outcome === 'win' ? a : b; assert.strictEqual(room.rounds[0].result.by, await winnerPage.page.evaluate(() => window.__TP_UI.OL.uid));
  const loser = va.outcome === 'win' ? b : a; const lmsg = await loser.page.evaluate(() => window.__TP_UI.VSS.msg); assert(/タッチの差/.test(lmsg), lmsg);
}));
test('M05 時間切れ → 延長戦：1組で誰も解かない → 両画面で「時間切れ」と解の一例 → 「延長戦 1回目」（versusReduce の suddenN と一致、作れませんは出さない）→ B が解いて決着', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await waitPlay(b, 0);
  await a.page.waitForSelector('#vs-reveal', { timeout: ROUND_MS + 8000 }); await b.page.waitForSelector('#vs-reveal');
  assert((await text(a, '#vs-reveal-who')).includes('時間切れ')); assert((await text(b, '#vs-reveal-expr')).includes('答えの一例'));
  const r0 = await dbGet('games/tenpuzzle/rooms/' + m.code + '/rounds/0/result'); assert.strictEqual(r0.kind, 'timeout'); assert.strictEqual(r0.by, undefined);
  await waitPlay(a, 1); await waitPlay(b, 1); const va = await view(a), vb = await view(b);
  assert.strictEqual(va.label, '延長戦 1回目'); assert.strictEqual(vb.label, '延長戦 1回目'); assert.strictEqual(va.suddenN, 1); assert((await text(b, '#vs-label')).includes('延長戦 1回目'));
  assert.strictEqual(await a.page.locator('#vs-declare').count(), 0, '延長戦では「作れません」を出さない');
  const sd = TP.suddenDeathSet(POOL, m.seed, 1, m.sets.map(x => x.key)); await solveRound(b, [sd], 0);
  await waitFinished(a); await waitFinished(b); const [fa, fb] = await bothConsistent(a, b); assert.strictEqual(fb.outcome, 'win'); assert.strictEqual(fa.endedBy, 'suddenDeath');
}));
test('M06 時間切れの進行は片方が落ちていても止まらない：B のタブを閉じても、A が timeout を書いて次の問題へ進む', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0); await b.ctx.close();
  await waitPlay(a, 1, ROUND_MS + 12000); const r0 = await dbGet('games/tenpuzzle/rooms/' + m.code + '/rounds/0/result'); assert.strictEqual(r0.kind, 'timeout');
  assert((await text(a, '#vs-label')).includes('第2問 / 3'));
}));
test('M07 延長戦の上限：1組で本戦＋延長戦3回が全部時間切れ → 両画面で「引き分け」。延長戦の表示は 1→2→3 回目で reducer と一致', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); const seen = new Set();
  for (let i = 1; i <= 3; i++) { await waitPlay(a, i, ROUND_MS + 15000); await waitPlay(b, i, 5000); const va = await view(a); assert.strictEqual(va.label, '延長戦 ' + i + '回目'); assert.strictEqual(va.suddenN, i); seen.add(va.label); }
  await waitFinished(a, ROUND_MS + 20000); await waitFinished(b, 10000); const [fa, fb] = await bothConsistent(a, b);
  assert.strictEqual(fa.outcome, 'draw'); assert.strictEqual(fb.outcome, 'draw'); assert.strictEqual(fa.endedBy, 'drawLimit'); assert((await text(a, '#vs-final')).includes('引き分け')); assert.strictEqual(seen.size, 3);
  const rounds = await dbGet('games/tenpuzzle/rooms/' + m.code + '/rounds'); assert.strictEqual(Object.keys(rounds).length, 4); assert.strictEqual(rounds[4], undefined);
}));
test('M08 操作方法A でもフル試合が完走する（ソロと同じ入力 UI：数字 → 記号 → 数字）', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await waitPlay(b, 0);
  const ok = await a.page.evaluate(() => { const U = window.__TP_UI; function dfs() { const n = U.VSS.board.cards.length; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; for (const op of ['+', '-', '*', '/']) { const h0 = U.VSS.board.history.length; U.handle('vs-card', { dataset: { i: String(i) } }); U.handle('vs-op', { dataset: { op } }); U.handle('vs-card', { dataset: { i: String(j) } }); if (U.VSS.done) return true; if (U.VSS.board.history.length > h0) { if (dfs()) return true; U.handle('vs-undo'); } else { TP.clearInputA(U.VSS.a); } } } return false; } return dfs(); });
  assert.strictEqual(ok, true); await waitFinished(a); await waitFinished(b); const [va] = await bothConsistent(a, b); assert.strictEqual(va.outcome, 'win');
}, { mode: 'A' }));

// ---------------- 同期・表示 ----------------
test('S01 相手の残り枚数：A が1回合体すると、B の画面の「あいて」が のこり3まい になる（live.cards）', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0);
  const plan = findPlan(POOL.find(e => TP.keyOf(e.digits) === m.sets[0].key).digits); await playMoves(a, plan.slice(0, 1));
  await b.page.waitForFunction(() => /のこり3まい/.test((document.querySelector('#vs-oppcards') || {}).textContent || ''), null, { timeout: 5000 });
  await a.page.evaluate(() => window.__TP_UI.handle('vs-undo')); await b.page.waitForFunction(() => /のこり4まい/.test((document.querySelector('#vs-oppcards') || {}).textContent || ''), null, { timeout: 5000 });
}));
test('S02 相手の式を検証できないとき（=10 にならない・数字が違う）は「検証できませんでした」と表示（結果は覆さない）', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0);
  const aUid = await a.page.evaluate(() => window.__TP_UI.OL.uid);
  await dbPut('games/tenpuzzle/rooms/' + m.code + '/rounds/0/result', { by: aUid, kind: 'solve', expr: '1+1', at: Date.now() }); await dbPut('games/tenpuzzle/rooms/' + m.code + '/rounds/1/startAt', Date.now() + 5000);
  await b.page.waitForSelector('#vs-verify'); assert((await text(b, '#vs-verify')).includes('検証できませんでした')); assert((await text(b, '#vs-reveal-who')).includes('あきら'));
  assert.strictEqual(await b.page.evaluate(() => window.__TP_UI.vsView().oppScore), 1, '結果自体は覆さない');
}));
test('S03 途中参加の防止：試合中の部屋（ゲストが抜けて枠が空いた）に入ると「対戦中です」と表示して退出する', withPlayers(['あきら', 'べにこ', 'さんた'], async ([a, b, c]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0);
  const bUid = await b.page.evaluate(() => window.__TP_UI.OL.uid); await b.ctx.close(); await dbPut('games/tenpuzzle/rooms/' + m.code + '/players/' + bUid, null);
  await openOnline(c); await c.page.click('#ol-join-open'); await c.page.fill('#ol-code', m.code); await c.page.click('#ol-join');
  await c.page.waitForFunction(() => /対戦中です/.test((document.querySelector('#ol-msg') || {}).textContent || ''), null, { timeout: 10000 }); assert.strictEqual(await c.page.locator('#vs-label, #ol-code-big').count(), 0);
  const players = await dbGet('games/tenpuzzle/rooms/' + m.code + '/players'); assert.deepStrictEqual(Object.keys(players), [await a.page.evaluate(() => window.__TP_UI.OL.uid)]);
}));
test('S04 ソロ・デイリーの記録に対戦が混ざらない：試合の前後でセーブ・デイリー記録（localStorage）が変わらない', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const snap = (p) => p.page.evaluate(() => JSON.stringify({ save: localStorage.getItem('tenpuzzle_save_v1'), daily: localStorage.getItem('tenpuzzle_daily_v1'), total: window.__TP_UI.getSave().total, keys: Object.keys(localStorage).sort() }));
  const a0 = await snap(a); const m = await startMatch(a, b, 1); await waitPlay(a, 0); await solveRound(a, m.sets, 0); await waitFinished(a);
  assert.strictEqual(await snap(a), a0);
}));
test('S05 結果画面の「ロビーに戻る」：部屋から出てオンラインのメニューに戻る（再戦は 4-5）。ホストが出ればゲストも部屋をとじて戻る', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await solveRound(a, m.sets, 0); await waitFinished(a); await waitFinished(b);
  const aUid = await a.page.evaluate(() => window.__TP_UI.OL.uid);
  await a.page.click('#vs-lobby'); await a.page.waitForSelector('#ol-create');
  const players = await dbGet('games/tenpuzzle/rooms/' + m.code + '/players'); assert(!players || !(aUid in players), 'A は部屋から出た');
  await b.page.waitForSelector('#ol-create', { timeout: 10000 }); // ホストが抜けた → ゲストも部屋をとじてメニューへ（4-3 の動作）
}));

// ================= 4-5：切断・不戦勝・再接続・再戦 =================
const uidOf = (p) => p.page.evaluate(() => window.__TP_UI.OL.uid);
const roomOf = (code) => dbGet('games/tenpuzzle/rooms/' + code);
async function waitOffline(p, ms) { await p.page.waitForSelector('#vs-offline', { timeout: ms || 15000 }); }
async function reducerOf(code) {
  const room = await roomOf(code); const pl = [room.meta.host, room.meta.guest]; const res = []; for (let i = 0; i < 8 && room.rounds[i] && room.rounds[i].result; i++) res.push(room.rounds[i].result);
  const sets = TP.versusSchedule(POOL, room.match.seed, room.match.mode, Math.max(room.match.mode, res.length + 1)); return TP.versusReduce({ mode: room.match.mode, players: pl, plan: sets.slice(0, room.match.mode).map(x => x.pts) }, res);
}

test('D01 試合中に片方のタブを閉じる → 相手画面に切断表示と猶予カウントダウン → 猶予（テストでは6秒）後に不戦勝が成立。残った側は勝ち、結果が versusReduce と一致', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0);
  const bUid = await uidOf(b), aUid = await uidOf(a); await b.page.close();
  await waitOffline(a); const t0 = await a.page.evaluate(() => Number(document.querySelector('#vs-offline-sec').textContent)); assert(t0 >= 1 && t0 <= 6, '猶予カウントダウン ' + t0);
  assert((await text(a, '#vs-offline')).includes('相手の接続が切れました'));
  const off = await roomOf(m.code); assert.strictEqual(off.players[bUid].online, false); assert.strictEqual(typeof off.players[bUid].offlineAt, 'number');
  await waitFinished(a, 25000); const va = await view(a); assert.strictEqual(va.outcome, 'win'); assert.strictEqual(va.endedBy, 'forfeit');
  assert((await text(a, '#vs-final-note')).includes('不戦勝'));
  const room = await roomOf(m.code); assert.strictEqual(room.rounds[0].result.kind, 'forfeit'); assert.strictEqual(room.rounds[0].result.by, aUid); assert.strictEqual(room.rounds[1], undefined, '不戦勝のあとに次の startAt は書かない');
  const st = await reducerOf(m.code); assert.strictEqual(st.winner, aUid); assert.strictEqual(st.endedBy, 'forfeit'); assert.deepStrictEqual(va.scores, st.scores);
}));
test('D02 猶予内に開き直すと、同じ部屋・同じ試合に復帰して対戦が続く（B が about:blank に移って戻る）。相手の切断表示は消え、在席は online:true に戻る', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await waitPlay(b, 0); const bUid = await uidOf(b);
  await b.page.goto('about:blank'); await waitOffline(a);
  await b.page.goto('file://' + HTML); await b.page.waitForFunction(() => !!window.__TP_UI); await waitPlay(b, 0, 15000);
  await a.page.waitForFunction(() => !document.querySelector('#vs-offline'), null, { timeout: 8000 });
  const room = await roomOf(m.code); assert.strictEqual(room.players[bUid].online, true); assert.strictEqual(room.players[bUid].offlineAt, undefined); assert.strictEqual(await uidOf(b), bUid, '同じ uid（匿名認証が端末に保たれる）');
  assert.strictEqual((await view(b)).label, '第1問 / 1'); assert.strictEqual(room.rounds[0].result, undefined, '不戦勝は成立していない');
  await solveRound(b, m.sets, 0); await waitFinished(a); await waitFinished(b); const [va] = await bothConsistent(a, b); assert.strictEqual(va.outcome, 'lose'); assert.strictEqual(va.endedBy, 'score');
}));
test('D03 試合途中の退出ボタン：確認ダイアログ →「つづける」で戻る →「やめる」で自分の online:false＋offlineAt を書いて部屋を出る → 相手に不戦勝が成立', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0); const bUid = await uidOf(b);
  await b.page.click('#vs-quit'); await b.page.waitForSelector('#vs-confirm'); assert((await text(b, '#vs-confirm')).includes('不戦勝'));
  await b.page.click('#vs-quit-no'); await b.page.waitForFunction(() => !document.querySelector('#vs-confirm')); assert.strictEqual(await b.page.locator('#vs-label').count(), 1, '対戦に戻る');
  assert.strictEqual((await roomOf(m.code)).players[bUid].online, true);
  await b.page.click('#vs-quit'); await b.page.click('#vs-quit-yes'); await b.page.waitForSelector('#ol-create');
  const room = await roomOf(m.code); assert.strictEqual(room.players[bUid].online, false); assert.strictEqual(typeof room.players[bUid].offlineAt, 'number'); assert(bUid in room.players, '相手が不戦勝を請求できるよう players は消さない');
  assert.strictEqual(await b.page.evaluate(() => sessionStorage.getItem('tenpuzzle_online_room')), null, '自分から出たので自動で戻らない');
  await waitOffline(a); await waitFinished(a, 25000); const va = await view(a); assert.strictEqual(va.outcome, 'win'); assert.strictEqual(va.endedBy, 'forfeit');
  const st = await reducerOf(m.code); assert.strictEqual(st.endedBy, 'forfeit'); assert.deepStrictEqual(va.scores, st.scores);
}));
test('D04 在席の書き込み：参加中は online:true・offlineAt なし。タブを閉じるとサーバー時刻の offlineAt つきで online:false（onDisconnect がルールを通る形）', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); const bUid = await uidOf(b);
  let room = await roomOf(m.code); assert.strictEqual(room.players[bUid].online, true); assert.strictEqual(room.players[bUid].offlineAt, undefined);
  const before = Date.now(); await b.page.close(); await waitOffline(a);
  room = await roomOf(m.code); assert.strictEqual(room.players[bUid].online, false); assert(Math.abs(room.players[bUid].offlineAt - before) < 10000, 'offlineAt はサーバー時刻（TIMESTAMP）');
}));
test('D05 切断中の相手には試合を始められない（ロビー）：ロビーで B が切断 → A の画面に切断表示、「はじめる」は無効', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  await openOnline(a); await a.page.click('#ol-create'); await a.page.waitForSelector('#ol-code-big'); const code = (await text(a, '#ol-code-big')).trim();
  await openOnline(b); await b.page.click('#ol-join-open'); await b.page.fill('#ol-code', code); await b.page.click('#ol-join'); await b.page.waitForSelector('#ol-code-big');
  await a.page.click('#ol-ready'); await b.page.click('#ol-ready'); await a.page.waitForSelector('#ol-start:not([disabled])');
  await b.page.close(); await a.page.waitForSelector('#ol-offline', { timeout: 10000 }); assert.strictEqual(await a.page.locator('#ol-start[disabled]').count(), 1);
}));
test('R01 再戦：両者が「もう一局」→ ホストが rounds を一括削除し、新しい seed・試合番号+1 で次の試合が始まる。組セットは前の試合と違う。スコアはリセット、rematch フラグは下りる', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await solveRound(a, m.sets, 0); await waitFinished(a); await waitFinished(b);
  const next = 'f'.repeat(16); await a.page.evaluate(h => { window.__TP_FB_TEST__.rematchSeedHex = h; }, next);
  await a.page.click('#vs-rematch'); await b.page.waitForSelector('#vs-rematch-note'); assert((await text(b, '#vs-rematch-note')).includes('のぞんでいます')); assert((await text(a, '#vs-rematch-note')).includes('待っています'));
  await b.page.click('#vs-rematch');
  await waitPlay(a, 0, 20000); await waitPlay(b, 0, 20000);
  const room = await roomOf(m.code); assert.strictEqual(room.match.no, 2); assert.strictEqual(room.match.seed, m.code + ':' + next + ':2'); assert.notStrictEqual(room.match.seed, m.seed); assert.strictEqual(room.match.mode, 1);
  assert.deepStrictEqual(Object.keys(room.rounds[0]), ['startAt']); assert.strictEqual(room.rounds[1], undefined);
  const newSets = TP.versusSets(POOL, room.match.seed, 1); assert.notStrictEqual(newSets[0].key, m.sets[0].key, '組が前の試合と違う');
  const va = await view(a), vb = await view(b); assert.deepStrictEqual(va.scores, [0, 0]); assert.deepStrictEqual(vb.scores, [0, 0]);
  assert.strictEqual(await a.page.evaluate(() => window.__TP_UI.vsView().round.key), newSets[0].key); assert.strictEqual(await b.page.evaluate(() => window.__TP_UI.vsView().round.key), newSets[0].key);
  await a.page.waitForFunction(() => window.__TP_UI.OL.room.players && Object.values(window.__TP_UI.OL.room.players).every(p => p.rematch === false), null, { timeout: 8000 });
  await solveRound(b, newSets, 0); await waitFinished(a); await waitFinished(b); const [fa] = await bothConsistent(a, b); assert.strictEqual(fa.outcome, 'lose', '2試合目もフルに遊べる');
}));
test('R02 片方だけが「もう一局」を押しても始まらない（待っている側に「相手の応答を待っています」、相手側に「のぞんでいます」）。取り消しもできる', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await solveRound(a, m.sets, 0); await waitFinished(a); await waitFinished(b);
  await b.page.click('#vs-rematch'); await a.page.waitForSelector('#vs-rematch-note'); assert((await text(a, '#vs-rematch-note')).includes('のぞんでいます')); await a.page.waitForTimeout(1500);
  let room = await roomOf(m.code); assert.strictEqual(room.match.no, 1); assert(room.rounds[0].result, '前の試合の結果は残っている'); assert.strictEqual(await a.page.locator('#vs-final').count(), 1);
  await b.page.click('#vs-rematch'); await a.page.waitForFunction(() => !document.querySelector('#vs-rematch-note')); room = await roomOf(m.code); assert.strictEqual(Object.values(room.players).filter(p => p.rematch).length, 0);
}));
test('R03 どちらかが「ロビーに戻る」を選ぶと再戦は成立しない：ゲストが出る → ホストの画面に「相手が部屋を出ました」・「もう一局」は出ない', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await solveRound(a, m.sets, 0); await waitFinished(a); await waitFinished(b);
  await a.page.click('#vs-rematch'); await b.page.click('#vs-lobby'); await b.page.waitForSelector('#ol-create');
  await a.page.waitForSelector('#vs-rematch-note'); assert((await text(a, '#vs-rematch-note')).includes('部屋を出ました')); assert.strictEqual(await a.page.locator('#vs-rematch').count(), 0);
  await a.page.waitForTimeout(1200); const room = await roomOf(m.code); assert.strictEqual(room.match.no, 1); assert(room.rounds[0].result);
}));
test('U01 再読み込みで同じ部屋に戻る：出題中・結果画面のどちらも正しい画面に復帰（sessionStorage の部屋コード・役割・uid）', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 1); await waitPlay(a, 0); await waitPlay(b, 0);
  const saved = JSON.parse(await b.page.evaluate(() => sessionStorage.getItem('tenpuzzle_online_room'))); assert.strictEqual(saved.code, m.code); assert.strictEqual(saved.role, 'guest'); assert.strictEqual(saved.uid, await uidOf(b));
  await b.page.reload(); await b.page.waitForFunction(() => !!window.__TP_UI); await waitPlay(b, 0, 15000); assert.strictEqual((await view(b)).label, '第1問 / 1'); assert.strictEqual(await uidOf(b), saved.uid);
  await solveRound(a, m.sets, 0); await waitFinished(a); await waitFinished(b);
  await b.page.reload(); await b.page.waitForFunction(() => !!window.__TP_UI); await b.page.waitForSelector('#vs-final', { timeout: 15000 }); assert.strictEqual((await view(b)).outcome, 'lose'); assert.strictEqual(await b.page.locator('#vs-rematch').count(), 1);
}));
test('U02 戻れなかった場合（部屋が消えている）はオンラインのメニューに戻り、自動で戻る記録は消える', withPlayers(['あきら', 'べにこ'], async ([a, b]) => {
  const m = await startMatch(a, b, 3); await waitPlay(a, 0); await waitPlay(b, 0);
  await a.page.close(); await dbPut('games/tenpuzzle/rooms/' + m.code, null);
  await b.page.reload(); await b.page.waitForFunction(() => !!window.__TP_UI); await b.page.waitForSelector('#ol-create', { timeout: 15000 });
  assert((await text(b, '#ol-msg')).includes('もどれませんでした')); assert.strictEqual(await b.page.evaluate(() => sessionStorage.getItem('tenpuzzle_online_room')), null);
}));
test('U03 ソロの起動は影響を受けない：記録が壊れている・オンライン未使用なら、再読み込みしてもタイトルのまま', async () => {
  const p = await player({ name: 'ひとり' });
  try { await p.page.evaluate(() => sessionStorage.setItem('tenpuzzle_online_room', '{broken')); await p.page.reload(); await p.page.waitForFunction(() => !!window.__TP_UI); assert.strictEqual(await p.page.evaluate(() => window.__TP_UI.ui.screen), 'title'); assert.strictEqual(await p.page.evaluate(() => sessionStorage.getItem('tenpuzzle_online_room')), null);
    await p.page.reload(); await p.page.waitForFunction(() => !!window.__TP_UI); assert.strictEqual(await p.page.evaluate(() => window.__TP_UI.ui.screen), 'title'); } finally { await closeAll([p]); }
});
test('U04 版表記は v1.2（タイトルと <title>）', async () => {
  assert(/<title>テンパズル v1\.2<\/title>/.test(H));
});

(async () => {
  await setRules(TEST_RULES); browser = await chromium.launch();
  const only = process.env.TP_ONLY ? new RegExp(process.env.TP_ONLY) : null;
  for (const t of queue) {
    if (only && !only.test(t.name)) continue;
    try { await t.fn(); pass++; console.log('ok   ' + t.name); }
    catch (e) { fail++; failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n     ')); }
  }
  await browser.close();
  const g = Object.keys(groups).sort().map(k => k + ' ' + groups[k]).join(' / ');
  console.log('\n==== 結果: ' + pass + '/' + (pass + fail) + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====\n内訳: ' + g);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
