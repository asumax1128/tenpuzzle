// 候補ルール（firebase/candidates/）の検証：現在のコンソールルールに games/tenpuzzle だけが足されていること、
// エミュレータで候補が読み込めること、既存ゲームの挙動が現在のルールと同じこと、tenpuzzle が動くことを確認する。
// 実行: npm run test:candidate （= firebase emulators:exec ... "node tests/test_tenpuzzle_candidate_v12.js"）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const dir = path.join(__dirname, '../firebase/candidates');
const CUR = JSON.parse(fs.readFileSync(path.join(dir, 'console-rules-current-2026-11-19.json'), 'utf8'));
const CAND = JSON.parse(fs.readFileSync(path.join(dir, 'database.rules.tenpuzzle-candidate.json'), 'utf8'));
const fragment = require('../firebase/tenpuzzle-rules.cjs');
const { diffPaths } = require('../scripts/prepare-tenpuzzle-rules.cjs');
const TS = { '.sv': 'timestamp' };
const ok = (p) => assertSucceeds(p), ng = (p) => assertFails(p);
let pass = 0, fail = 0; const failures = [], queue = [];
const test = (n, f) => queue.push({ n, f });
const P = (d) => d.ref('games/tenpuzzle/rooms/WXYZ');

test('K01 候補 = 現在のルール + rules/games/tenpuzzle だけ（追加のみ・削除/変更なし・既存ゲームの順序も同じ）', () => {
  assert.deepStrictEqual(diffPaths(CUR, CAND), { added: ['rules/games/tenpuzzle'], removed: [], changed: [] });
  const rest = JSON.parse(JSON.stringify(CAND)); delete rest.rules.games.tenpuzzle; assert.strictEqual(JSON.stringify(rest), JSON.stringify(CUR));
  assert.deepStrictEqual(Object.keys(CAND.rules.games), Object.keys(CUR.rules.games).concat(['tenpuzzle']));
  assert.deepStrictEqual(CAND.rules.games.tenpuzzle, JSON.parse(JSON.stringify(fragment)));
});
test('K02 現在のルールの games は iroyomi / crowd / bluff / kyoen / factor / auction / factor_dev / mathjong（tenpuzzle は未登録）', () => {
  assert.deepStrictEqual(Object.keys(CUR.rules.games), ['iroyomi', 'crowd', 'bluff', 'kyoen', 'factor', 'auction', 'factor_dev', 'mathjong']);
});
(async () => {
  const before = await initializeTestEnvironment({ projectId: 'demo-cand-before', database: { rules: JSON.stringify(CUR) } });
  const after = await initializeTestEnvironment({ projectId: 'demo-cand-after', database: { rules: JSON.stringify(CAND) } });
  // 既存ゲームの挙動プローブ（現在のルールと候補で同じ結果になること）。期待値は現在のルールから手で決めたもの
  const probes = [
    ['iroyomi 認証済みの書き込み', true, d => d('A').ref('games/iroyomi/rooms/ABCD/x').set(1)],
    ['iroyomi 未認証の書き込み', false, d => d().ref('games/iroyomi/rooms/ABCD/x').set(1)],
    ['crowd 部屋作成（数字4桁・host=自分）', true, d => d('A').ref('games/crowd/rooms/1234/meta').set({ host: 'A', createdAt: TS })],
    ['crowd 部屋コード不正（英字）', false, d => d('A').ref('games/crowd/rooms/ABCD/meta').set({ host: 'A', createdAt: TS })],
    ['kyoen 5文字の部屋', true, d => d('A').ref('games/kyoen/rooms/AB12C').set({ meta: { hostId: 'A', createdAt: TS } })],
    ['kyoen 4文字の部屋は不可', false, d => d('A').ref('games/kyoen/rooms/AB12').set({ meta: { hostId: 'A', createdAt: TS } })],
    ['mathjong config の書き込みは常に不可', false, d => d('A').ref('games/mathjong/config').set({ a: 1 })],
    ['mathjong config の読み取りは認証済みなら可', true, d => d('A').ref('games/mathjong/config').get()],
    ['factor pins の読み取りは不可', false, d => d('A').ref('games/factor/pins/k1').get()],
    ['factor pins の新規書き込み（4桁）は可', true, d => d('A').ref('games/factor/pins/k1').set('1234')],
    ['auction 部屋作成', true, d => d('A').ref('games/auction/rooms/4321/meta').set({ host: 'A', createdAt: TS })],
    ['未定義パス（games/unknown）は不可', false, d => d('A').ref('games/unknown/x').set(1)],
    ['ルート直下は不可', false, d => d('A').ref('x').set(1)]
  ];
  for (const [name, expect, fn] of probes) {
    test('K-existing ' + name + '（現在のルール・候補で同じ結果）', async () => {
      for (const env of [before, after]) { await env.clearDatabase(); const d = (u) => (u ? env.authenticatedContext(u).database() : env.unauthenticatedContext().database()); await (expect ? ok(fn(d)) : ng(fn(d))); }
    });
  }
  test('K-tenpuzzle 候補の下で tenpuzzle が動く：作成→参加→開始→解決＋次ラウンド。3人目は拒否。現在のルールでは tenpuzzle は書けない', async () => {
    await after.clearDatabase(); await before.clearDatabase();
    const a = after.authenticatedContext('A').database(), b = after.authenticatedContext('B').database(), c = after.authenticatedContext('C').database();
    await ok(P(a).update({ meta: { v: 1, app: '1.2', poolHash: 2332605222, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
    await ok(P(b).update({ 'meta/guest': 'B', 'players/B': { name: 'い', joinedAt: TS, online: true, ready: false, rematch: false } }));
    await ng(P(c).update({ 'meta/guest': 'C', 'players/C': { name: 'う', joinedAt: TS, online: true, ready: false, rematch: false } }));
    await ok(P(a).update({ match: { no: 1, mode: 3, seed: 'WXYZ:0123456789abcdef:1', countdownAt: TS }, 'rounds/0/startAt': Date.now() + 3000 }));
    await new Promise(r => setTimeout(r, 3100));
    await ok(P(b).update({ 'rounds/0/result': { by: 'B', kind: 'solve', expr: '(1+1)×(1+4)', at: TS }, 'rounds/1/startAt': Date.now() + 5000 }));
    await ng(P(a).child('rounds/0/result').set({ by: 'A', kind: 'solve', expr: '1+1', at: TS }));
    await ng(before.authenticatedContext('A').database().ref('games/tenpuzzle/rooms/WXYZ/meta').set({ v: 1, app: '1.2', poolHash: 1, host: 'A', createdAt: TS }));
  });
  for (const t of queue) { try { await t.f(); pass++; console.log('ok   ' + t.n); } catch (e) { fail++; failures.push(t.n); console.log('FAIL ' + t.n + '\n     ' + String((e && e.message) || e).split('\n')[0]); } }
  await before.cleanup(); await after.cleanup();
  console.log('\n==== 結果: ' + pass + '/' + (pass + fail) + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
