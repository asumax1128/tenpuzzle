// テンパズル v1.2（分割 4-2）Firebase ルールの単体テスト。Realtime Database エミュレータ上で実行する。
// 実行: npm install && npm run test:rules   （= firebase emulators:exec --only database --project demo-tenpuzzle "node tests/test_tenpuzzle_rules_v12.js"）
// 本番の Firebase には接続しない。
//
// 時計について：ルールの now はサーバー時刻で、テストからは ms 単位で制御できない。そこで
//  (X) 時計注入版：ルールの now を root.__now に置き換えた同じルール（build({now}) で生成。置換した以外は同一であることを R-Z で確認）で、境界を ±1ms で検証する
//  (R) 本番版：now のままのルールと ServerValue.TIMESTAMP で、一連の流れと「余裕のある」拒否を検証する
const assert = require('assert');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fragment = require('../firebase/tenpuzzle-rules.cjs');
const { composeRules, diffPaths } = require('../scripts/prepare-tenpuzzle-rules.cjs');

const NOWX = "root.child('__now').val()";
const N = 1700000000000;            // 注入する「現在時刻」
const TS = { '.sv': 'timestamp' };  // ServerValue.TIMESTAMP
const K = fragment.K;
const P = 'games/tenpuzzle/rooms/ABCD';
const rulesOf = (frag, extraGames) => JSON.stringify({ rules: { games: Object.assign({}, extraGames || {}, { tenpuzzle: frag }) } });

let pass = 0, fail = 0; const failures = [], queue = [], groups = {};
function test(name, fn) { queue.push({ name, fn }); const g = name.split(' ')[0].replace(/[0-9]+$/, ''); groups[g] = (groups[g] || 0) + 1; }
const ok = p => assertSucceeds(p), ng = (p) => assertFails(p);

let X, R, C, SAMPLE; // X=時計注入版 / R=本番版 / C=合成後の全体ルール
const db = (env, uid) => (uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database());
const admin = async (env, fn) => { let out; await env.withSecurityRulesDisabled(async ctx => { out = await fn(ctx.database()); }); return out; };
const setNow = (ms) => admin(X, d => d.ref('__now').set(ms));
const room = (d, code) => d.ref('games/tenpuzzle/rooms/' + (code || 'ABCD'));

const PL = (name, extra) => Object.assign({ name: name || 'ゆうた', joinedAt: 1000, online: true, ready: false, rematch: false }, extra || {});
const META = (host, guest, createdAt) => Object.assign({ v: 1, app: '1.2', poolHash: 2332605222, host: host || 'A', createdAt: createdAt === undefined ? 1000 : createdAt }, guest ? { guest } : {});
// 標準の部屋：host=A、参加者 A・B、match（3組）、round0 の startAt=4000
async function seed(env, o) {
  o = o || {};
  await env.clearDatabase();
  if (env === X) await admin(X, d => d.ref('__now').set(o.now === undefined ? N : o.now));
  await admin(env, async d => {
    const r = room(d);
    if (o.meta !== false) await r.child('meta').set(META('A', o.guest === false ? null : 'B', o.now === undefined ? N - 1000 : 1000));
    if (o.players !== false) { await r.child('players/A').set(PL('あ', o.A)); if (o.B !== false) await r.child('players/B').set(PL('い', o.B)); }
    if (o.match !== false) await r.child('match').set({ no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: 1000 });
    if (o.round0 !== false) await r.child('rounds/0/startAt').set(o.startAt !== undefined ? o.startAt : (o.now === undefined ? N - 5000 : 4000)); // 既定：5秒前に開始。now を指定する境界テストは startAt=4000 を基準にする
    if (o.extra) await o.extra(r);
  });
}
const A = (env) => db(env || X, 'A'), B = (env) => db(env || X, 'B'), Cc = (env) => db(env || X, 'C'), U = (env) => db(env || X);
const res = (d, i) => room(d).child('rounds/' + i + '/result');
const SOLVE = (uid, extra) => Object.assign({ by: uid, kind: 'solve', expr: '(1+1)×(1+4)', at: N }, extra || {});

// ---------------- 認証・形式・部屋の作成 ----------------
test('A01 未認証は読み取りも書き込みもできない（部屋・meta・players・ルール外パス）', async () => {
  await seed(X);
  await ng(room(U()).get()); await ng(room(U()).child('meta').get()); await ng(room(U()).child('players').get());
  await ng(room(U()).child('players/Z').set(PL())); await ng(room(U()).child('meta').set(META('Z'))); await ng(U().ref('games/tenpuzzle/rooms').get());
});
test('A02 認証済みでも、ルールの無いパス（他ゲーム領域・rooms 直下・部屋の未定義キー）には書けない', async () => {
  await seed(X);
  await ng(A().ref('games/other/x').set(1)); await ng(A().ref('games/tenpuzzle/x').set(1)); await ng(A().ref('games/tenpuzzle/rooms').set({ ABCD: {} }));
  await ng(room(A()).child('junk').set(1)); await ng(A().ref('foo').set(1));
});
test('A03 部屋一覧は読めない（認証済みでも rooms 直下は列挙不可）', async () => { await seed(X); await ng(A().ref('games/tenpuzzle/rooms').get()); await ng(A().ref('games/tenpuzzle').get()); });
test('A04 部屋コードは4文字・許可文字（ABCDEFGHJKMNPQRSTUVWXYZ23456789）だけで作成できる', async () => {
  for (const code of ['ABCD', 'WXYZ', '2345', 'H2K9', 'MNPQ', 'UTUV', '9876']) { await seed(X, { meta: false, players: false, match: false, round0: false }); await ok(A().ref('games/tenpuzzle/rooms/' + code).update({ meta: Object.assign(META('A'), { createdAt: N }), 'players/A': PL('あ', { joinedAt: N }) })); }
});
test('A05 不正な部屋コード（3文字・5文字・小文字・0 1 I L O・空白・全角）では作成できない', async () => {
  for (const code of ['ABC', 'ABCDE', 'abcd', 'AB0D', 'AB1D', 'ABID', 'ABLD', 'ABOD', 'AB D', 'ＡＢＣＤ']) { await seed(X, { meta: false, players: false, match: false, round0: false });
    await ng(A().ref('games/tenpuzzle/rooms/' + code).update({ meta: Object.assign(META('A'), { createdAt: N }), 'players/A': PL('あ', { joinedAt: N }) })); }
});
test('A06 部屋の作成：meta と、ホスト自身の players を同時に書いたときだけ通る（meta だけ・players だけ・他人の uid は拒否）', async () => {
  await seed(X, { meta: false, players: false, match: false, round0: false });
  const r = room(A()), m = Object.assign(META('A'), { createdAt: N });
  await ng(r.child('meta').set(m)); await ng(r.child('players/A').set(PL('あ', { joinedAt: N })));
  await ng(r.update({ meta: m, 'players/B': PL('い', { joinedAt: N }) }));
  await ok(r.update({ meta: m, 'players/A': PL('あ', { joinedAt: N }) }));
  assert.strictEqual((await admin(X, d => room(d).child('meta/host').get())).val(), 'A');
});
test('A07 meta の検証：host は自分／v=1／app 1〜16字／poolHash は 0〜4294967295 の整数／createdAt=now／余計な子は拒否', async () => {
  const bad = [{ host: 'B' }, { v: 2 }, { app: '' }, { app: 'x'.repeat(17) }, { poolHash: -1 }, { poolHash: 4294967296 }, { poolHash: 1.5 }, { poolHash: 'x' }, { createdAt: N - 1 }, { createdAt: N + 1 }, { junk: 1 }];
  for (const b of bad) { await seed(X, { meta: false, players: false, match: false, round0: false }); await ng(room(A()).update({ meta: Object.assign(META('A'), { createdAt: N }, b), 'players/A': PL('あ', { joinedAt: N }) })); }
  for (const e of [{ poolHash: 0 }, { poolHash: 4294967295 }]) { await seed(X, { meta: false, players: false, match: false, round0: false }); await ok(room(A()).update({ meta: Object.assign(META('A'), { createdAt: N }, e), 'players/A': PL('あ', { joinedAt: N }) })); }
});
test('A06b 他人を host に指名した部屋・guest を最初から入れた部屋は作れない（部屋の乗っ取り・横取りの防止）', async () => {
  const m = (o) => Object.assign(META('A'), { createdAt: N }, o);
  for (const o of [{ host: 'B', guest: 'A' }, { host: 'B' }, { guest: 'B' }, { guest: 'A' }]) { await seed(X, { meta: false, players: false, match: false, round0: false }); await ng(room(A()).update({ meta: m(o), 'players/A': PL('あ', { joinedAt: N }) })); }
  await seed(X, { meta: false, players: false, match: false, round0: false }); await ng(room(A()).update({ meta: m({ host: 'B', guest: 'A' }), 'players/A': PL('あ', { joinedAt: N }), 'players/B': PL('い', { joinedAt: N }) }));
});
test('A08 meta は作成時のみ（write-once）。既存の部屋の meta を、ホストも他人も書き換えられない（guest 枠は別規則）', async () => {
  await seed(X, { guest: false });
  await ng(room(A()).child('meta').set(Object.assign(META('A'), { createdAt: N }))); await ng(room(B()).child('meta').set(Object.assign(META('B'), { createdAt: N })));
  await ng(room(A()).child('meta/host').set('B')); await ng(room(A()).child('meta').remove()); await ng(room(B()).child('meta/poolHash').set(1)); await ng(room(B()).child('meta/createdAt').set(N));
});
test('A09 参加前でも認証済みなら meta と players は読める（参加判定用）が、部屋全体・rounds・live・match は参加者だけ', async () => {
  await seed(X, { extra: async r => { await r.child('live/A').set({ r: 0, cards: 4, lockUntil: 0 }); } });
  await ok(room(Cc()).child('meta').get()); await ok(room(Cc()).child('players').get());
  await ng(room(Cc()).get()); await ng(room(Cc()).child('rounds').get()); await ng(room(Cc()).child('live').get()); await ng(room(Cc()).child('match').get());
  await ok(room(A()).get()); await ok(room(B()).child('live').get()); await ok(room(B()).child('match').get());
});

// ---------------- 参加・退出（2人まで・本人のみ） ----------------
test('B01 2人目の参加：meta.guest に自分の uid を入れ、players に自分を書く（同時でも順次でも）', async () => {
  await seed(X, { guest: false, B: false, round0: false, match: false });
  await ok(room(B()).update({ 'meta/guest': 'B', 'players/B': PL('い', { joinedAt: N }) }));
  await seed(X, { guest: false, B: false, round0: false, match: false });
  await ok(room(B()).child('meta/guest').set('B')); await ok(room(B()).child('players/B').set(PL('い', { joinedAt: N })));
});
test('B02 3人目の参加は拒否：guest 枠は取れず、players に3つ目の uid も追加できない', async () => {
  await seed(X);
  await ng(room(Cc()).child('meta/guest').set('C')); await ng(room(Cc()).child('players/C').set(PL('う', { joinedAt: N }))); await ng(room(Cc()).update({ 'meta/guest': 'C', 'players/C': PL('う', { joinedAt: N }) }));
  await ng(room(A()).child('players/C').set(PL('う', { joinedAt: N }))); await ng(room(A()).child('meta/guest').set('C')); await ng(room(Cc()).child('meta/guest').set('B'));
  assert.deepStrictEqual(Object.keys((await admin(X, d => room(d).child('players').get())).val()).sort(), ['A', 'B']);
});
test('B03 参加は本人の uid のみ。他人の players を追加・書き換え・削除できない。ホストが guest 枠を自分に取ることもできない', async () => {
  await seed(X, { guest: false, B: false }); await ng(room(Cc()).child('players/B').set(PL('い', { joinedAt: N }))); await ng(room(A()).child('players/B').set(PL('い', { joinedAt: N })));
  await ng(room(A()).child('meta/guest').set('A')); await ng(room(Cc()).child('meta/guest').set('B'));
  await seed(X); await ng(room(A()).child('players/B/ready').set(true)); await ng(room(A()).child('players/B/online').set(false)); await ng(room(Cc()).child('players/B').remove()); await ng(room(A()).child('players/B').remove());
});
test('B04 存在しない部屋（meta なし）には参加できない', async () => {
  await seed(X, { meta: false, players: false, match: false, round0: false }); await ng(room(B()).update({ 'meta/guest': 'B', 'players/B': PL('い', { joinedAt: N }) })); await ng(room(B()).child('players/B').set(PL('い', { joinedAt: N })));
});
test('B05 退出（自分の players を削除）できる。ゲストが退出済みなら別の人が guest 枠に入れ替われる。同じ人の再参加も可', async () => {
  await seed(X); await ok(room(B()).child('players/B').remove()); await ok(room(Cc()).update({ 'meta/guest': 'C', 'players/C': PL('う', { joinedAt: N }) }));
  await ng(room(B()).child('players/B').set(PL('い', { joinedAt: N })), 'B は guest でなくなった');
  await seed(X); await ok(room(B()).child('players/B').remove()); await ok(room(B()).child('players/B').set(PL('い', { joinedAt: N })));
  await seed(X); await ok(room(B()).child('players/B/ready').set(true));
  await seed(X); await ng(room(Cc()).update({ 'meta/guest': 'C', 'players/C': PL('う', { joinedAt: N }) }));
});
test('B06 players の値検証：name は1〜10文字の文字列、joinedAt は参加時 now で以後変更不可、余計な子は拒否', async () => {
  const mk = (e) => PL('い', Object.assign({ joinedAt: N }, e));
  for (const e of [{ name: '' }, { name: 'あ'.repeat(11) }, { name: 5 }, { joinedAt: N - 1 }, { joinedAt: N + 1 }, { online: 'yes' }, { ready: 1 }, { rematch: null }, { junk: 1 }]) { await seed(X, { B: false, round0: false, match: false }); await ng(room(B()).child('players/B').set(mk(e))); }
  await seed(X, { B: false, round0: false, match: false }); await ok(room(B()).child('players/B').set(mk({ name: 'あ'.repeat(10) })));
  await seed(X); await ng(room(B()).child('players/B/joinedAt').set(N)); await ng(room(B()).child('players/B/name').set('')); await ok(room(B()).child('players/B/name').set('はな'));
});
test('B07 在席フラグ：online=false には offlineAt=now が必須、online=true には offlineAt を付けられない。offlineAt の偽装（過去の時刻）は拒否', async () => {
  await seed(X);
  await ng(room(B()).child('players/B').update({ online: false }));                          // offlineAt なし
  await ng(room(B()).child('players/B').update({ online: false, offlineAt: N - 60000 }));    // 偽装
  await ng(room(B()).child('players/B').update({ online: true, offlineAt: N }));              // online なのに offlineAt
  await ok(room(B()).child('players/B').update({ online: false, offlineAt: N }));              // onDisconnect の形
  await ng(room(B()).child('players/B/offlineAt').set(N - 1));
  await ok(room(B()).child('players/B/ready').set(true));                                       // 離席中でも他の項目は更新できる（offlineAt は不変）
  await ok(room(B()).child('players/B').update({ online: true, offlineAt: null }));            // 復帰
});
test('B08 ready / rematch は本人だけが書き換えられる', async () => {
  await seed(X); await ok(room(A()).child('players/A/ready').set(true)); await ok(room(B()).child('players/B/rematch').set(true));
  await ng(room(A()).child('players/B/rematch').set(false)); await ng(room(B()).child('players/A/ready').set(false));
});

// ---------------- match（ホストだけ） ----------------
test('C01 match はホストだけが書ける。参加者でもゲストは拒否、未参加者も拒否', async () => {
  await seed(X, { match: false, round0: false });
  const m = { no: 1, mode: 5, seed: 'ABCD:0123456789abcdef:1', countdownAt: N };
  await ng(room(B()).child('match').set(m)); await ng(room(Cc()).child('match').set(m)); await ng(room(U()).child('match').set(m)); await ok(room(A()).child('match').set(m));
});
test('C02 match の値検証：mode は 1/3/5、no は 1〜99 の整数、seed は英数と :_- の64字以内、countdownAt は now', async () => {
  const mk = (e) => Object.assign({ no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: N }, e);
  for (const e of [{ mode: 2 }, { mode: 4 }, { mode: 0 }, { mode: '3' }, { no: 0 }, { no: 100 }, { no: 1.5 }, { seed: '' }, { seed: 'a b' }, { seed: 'あ' }, { seed: 'x'.repeat(65) }, { countdownAt: N - 1 }, { countdownAt: N + 1 }, { junk: 1 }]) {
    await seed(X, { match: false, round0: false }); await ng(room(A()).child('match').set(mk(e))); }
  for (const e of [{ mode: 1 }, { mode: 5 }, { no: 99 }, { seed: 'x'.repeat(64) }]) { await seed(X, { match: false, round0: false }); await ok(room(A()).child('match').set(mk(e))); }
});
test('C03 ロビーでのモード選択（seed なしの match = {mode}）は書ける。seed があるのに no / countdownAt が無いものは拒否', async () => {
  await seed(X, { match: false, round0: false });
  await ok(room(A()).child('match').set({ mode: 3 })); await ok(room(A()).child('match/mode').set(5)); await ng(room(A()).child('match/seed').set('ABCD:1'));
  await ng(room(A()).child('match').set({ mode: 3, seed: 'ABCD:1' })); await ng(room(A()).child('match').set({ seed: 'ABCD:1', no: 1, countdownAt: N }));
});
test('C04 ラウンドが始まったあと（rounds が存在する間）は match を書き換えられない。rounds を消してからなら書ける', async () => {
  await seed(X); await ng(room(A()).child('match/seed').set('ABCD:other')); await ng(room(A()).child('match').set({ no: 2, mode: 3, seed: 'ABCD:z:2', countdownAt: N }));
  await seed(X, { round0: false }); await ok(room(A()).child('match/mode').set(1));
});
test('C05 countdownAt は now か現在値のまま。過去・未来の値には変えられない', async () => {
  await seed(X, { round0: false }); await ok(room(A()).child('match/countdownAt').set(1000)); await ng(room(A()).child('match/countdownAt').set(N - 5)); await ok(room(A()).child('match/countdownAt').set(N));
});

// ---------------- ラウンド開始（startAt） ----------------
const START0 = (o) => Object.assign({ match: { no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: N } }, o || {});
test('D01 最初のラウンド：ホストが match（countdownAt=now）と rounds/0/startAt=now+3000 を同じ更新で書くと通る', async () => {
  await seed(X, { match: false, round0: false });
  await ok(room(A()).update({ match: { no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: N }, 'rounds/0/startAt': N + 3000 }));
});
test('D02 startAt の許容幅（± 2000ms）：now+3000 の ±2000 は通り、±2001 は拒否（rounds/0）', async () => {
  const mk = () => ({ match: { no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: N } });
  for (const [d, okk] of [[3000, true], [1000, true], [5000, true], [999, false], [5001, false], [0, false], [10000, false], [-3000, false], [60000, false]]) {
    await seed(X, { match: false, round0: false }); const p = room(A()).update(Object.assign(mk(), { 'rounds/0/startAt': N + d })); await (okk ? ok(p) : ng(p)); }
});
test('D03 rounds/0/startAt はホストだけ。match.countdownAt=now を同じ更新で書いていなければ拒否。書き直し不可（write-once）', async () => {
  await seed(X, { match: false, round0: false });
  await ng(room(B()).update({ 'rounds/0/startAt': N + 3000 })); await ng(room(A()).child('rounds/0/startAt').set(N + 3000));
  await ng(room(A()).update({ match: { no: 1, mode: 3, seed: 'ABCD:1', countdownAt: 1000 }, 'rounds/0/startAt': N + 3000 }));
  await seed(X); await ng(room(A()).child('rounds/0/startAt').set(N + 3000)); await ng(room(A()).update({ match: { no: 1, mode: 3, seed: 'ABCD:1', countdownAt: N }, 'rounds/0/startAt': N + 3000 }));
});
test('D04 次のラウンド：前のラウンドの result と同じ更新で startAt=now+5000 を書くと通る（解いた側が書く）', async () => {
  await seed(X); await ok(room(B()).update({ 'rounds/0/result': SOLVE('B'), 'rounds/1/startAt': N + 5000 }));
  await seed(X, { now: 4000 + 70000 }); await ok(room(A()).update({ 'rounds/0/result': { kind: 'timeout', at: 4000 + 70000 }, 'rounds/1/startAt': 4000 + 70000 + 5000 }));
});
test('D05 次の startAt の許容幅（now+5000 ± 2000）：境界の内側は通り、外側は拒否', async () => {
  for (const [d, okk] of [[5000, true], [3000, true], [7000, true], [2999, false], [7001, false], [3000 - 3000, false], [60000, false]]) {
    await seed(X); const p = room(B()).update({ 'rounds/0/result': SOLVE('B'), 'rounds/1/startAt': N + d }); await (okk ? ok(p) : ng(p)); }
});
test('D06 次の startAt は前の result と同じ更新でなければ書けない（単独・後からの書き込みは拒否）', async () => {
  await seed(X); await ng(room(B()).child('rounds/1/startAt').set(N + 5000));
  await seed(X, { extra: async r => { await r.child('rounds/0/result').set(SOLVE('B')); } }); await ng(room(B()).child('rounds/1/startAt').set(N + 5000)); await ng(room(A()).child('rounds/1/startAt').set(N + 5000));
});
test('D07 前のラウンドが不戦勝（forfeit）なら次の startAt は書けない（forfeit 単独は書ける）', async () => {
  await seed(X, { B: { online: false, offlineAt: N - K.FORFEIT_GRACE_MS } });
  await ng(room(A()).update({ 'rounds/0/result': { by: 'A', kind: 'forfeit', at: N }, 'rounds/1/startAt': N + 5000 }));
  await ok(room(A()).child('rounds/0/result').set({ by: 'A', kind: 'forfeit', at: N }));
});
test('D08 startAt は書き換え不可（write-once）。非参加者は書けない。ラウンド番号は 0〜7 だけ', async () => {
  await seed(X); await ng(room(A()).child('rounds/0/startAt').set(N + 3000)); await ng(room(B()).child('rounds/0/startAt').set(5000));
  await seed(X, { extra: async r => { for (let i = 0; i <= 6; i++) { await r.child('rounds/' + i + '/result').set(SOLVE('A')); await r.child('rounds/' + (i + 1) + '/startAt').set(N + 100); } await r.child('rounds/7/result').set(SOLVE('A')); } });
  await ng(room(A()).update({ 'rounds/8/startAt': N + 5000 })); await ng(room(A()).child('rounds/-1/startAt').set(1)); await ng(room(A()).child('rounds/x/startAt').set(1));
  await seed(X); await ng(room(Cc()).update({ 'rounds/0/result': SOLVE('C'), 'rounds/1/startAt': N + 5000 }));
});

// ---------------- result（先着・write-once・締切） ----------------
const W0 = (extra) => Object.assign({ 'rounds/1/startAt': N + 5000 }, extra || {});
test('E01 解決（solve）の result と次の startAt を同時に書ける（正常系）', async () => {
  await seed(X); await ok(room(A()).update(W0({ 'rounds/0/result': SOLVE('A') })));
});
test('E02 result は write-once：既に存在したら、同じ人も相手も書けない（先着）', async () => {
  await seed(X); await ok(room(A()).child('rounds/0/result').set(SOLVE('A')));
  await ng(room(B()).child('rounds/0/result').set(SOLVE('B'))); await ng(room(A()).child('rounds/0/result').set(SOLVE('A', { expr: '1+1' }))); await ng(res(A(), 0).remove());
});
test('E03 先着：同時に書き込んでも片方だけが成功する', async () => {
  await seed(X); const rs = await Promise.allSettled([res(A(), 0).set(SOLVE('A')), res(B(), 0).set(SOLVE('B'))]);
  assert.strictEqual(rs.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(rs.map(r => r.status)));
});
test('E04 result.at は now と一致（±1ms でも拒否）', async () => {
  for (const [at, okk] of [[N, true], [N - 1, false], [N + 1, false], [0, false], ['x', false]]) { await seed(X); const p = res(A(), 0).set(SOLVE('A', { at })); await (okk ? ok(p) : ng(p)); }
});
test('E05 締切の境界：startAt+61000 ちょうどは通り、+61001 は拒否（solve / declare）', async () => {
  for (const kind of ['solve', 'declare']) {
    const mk = () => kind === 'solve' ? SOLVE('A') : { by: 'A', kind: 'declare', at: 0 };
    await seed(X, { now: 4000 + 61000 }); await ok(res(A(), 0).set(Object.assign(mk(), { at: 4000 + 61000 })));
    await seed(X, { now: 4000 + 61001 }); await ng(res(A(), 0).set(Object.assign(mk(), { at: 4000 + 61001 })));
    await seed(X, { now: 4000 + 60999 }); await ok(res(A(), 0).set(Object.assign(mk(), { at: 4000 + 60999 })));
  }
});
test('E06 開始前（now < startAt）の解決・宣言は拒否。startAt ちょうどは通る', async () => {
  await seed(X, { now: 3999 }); await ng(res(A(), 0).set(SOLVE('A', { at: 3999 })));
  await seed(X, { now: 4000 }); await ok(res(A(), 0).set(SOLVE('A', { at: 4000 })));
});
test('E07 時間切れ（timeout）は締切の後だけ：startAt+61001 から通り、+61000 までは拒否。by・expr・vs は付けられない', async () => {
  await seed(X, { now: 4000 + 61000 }); await ng(res(A(), 0).set({ kind: 'timeout', at: 4000 + 61000 }));
  await seed(X, { now: 4000 + 61001 }); await ok(res(B(), 0).set({ kind: 'timeout', at: 4000 + 61001 }));
  for (const e of [{ by: 'A' }, { expr: '1' }, { vs: 'B' }]) { await seed(X, { now: 4000 + 70000 }); await ng(res(A(), 0).set(Object.assign({ kind: 'timeout', at: 4000 + 70000 }, e))); }
  await seed(X, { now: 4000 + 70000 }); await ok(room(A()).update({ 'rounds/0/result': { kind: 'timeout', at: 4000 + 70000 }, 'rounds/1/startAt': 4000 + 70000 + 5000 }));
});
test('E08 solve は by（自分）と expr が必須。他人名義・by 欠落・expr 欠落・長すぎる expr・余計な子は拒否', async () => {
  const bad = [SOLVE('B'), { kind: 'solve', expr: '1+1', at: N }, { by: 'A', kind: 'solve', at: N }, SOLVE('A', { expr: '' }), SOLVE('A', { expr: 'x'.repeat(65) }), SOLVE('A', { vs: 'B' }), SOLVE('A', { junk: 1 }), SOLVE('A', { kind: 'win' }), { by: 'A', at: N }];
  for (const b of bad) { await seed(X); await ng(res(A(), 0).set(b)); }
  await seed(X); await ok(res(A(), 0).set(SOLVE('A', { expr: 'x'.repeat(64) })));
});
test('E09 declare（作れません）は by が必須で expr を付けられない', async () => {
  await seed(X); await ng(res(A(), 0).set({ by: 'A', kind: 'declare', expr: '1', at: N })); await ng(res(A(), 0).set({ by: 'B', kind: 'declare', at: N })); await ng(res(A(), 0).set({ kind: 'declare', at: N }));
  await ok(res(A(), 0).set({ by: 'A', kind: 'declare', at: N }));
});
test('E10 参加者でない人は result を書けない。startAt の無いラウンドへの書き込みも拒否', async () => {
  await seed(X); await ng(res(Cc(), 0).set(SOLVE('C'))); await ng(res(U(), 0).set(SOLVE('A')));
  await seed(X); await ng(res(A(), 1).set(SOLVE('A'))); await ng(res(A(), 2).set(SOLVE('A')));
});
test('E11 result は余計な子を持てず、型も検証される（at が文字列・kind が文字列でない等）', async () => {
  for (const b of [SOLVE('A', { at: String(N) }), SOLVE('A', { kind: 1 }), SOLVE('A', { by: 5 }), SOLVE('A', { expr: 5 })]) { await seed(X); await ng(res(A(), 0).set(b)); }
});

// ---------------- forfeit（不戦勝）----------------
const FF = (o) => Object.assign({ by: 'A', kind: 'forfeit', at: N }, o || {});
test('F01 猶予（30秒）の境界：offlineAt+30000 ちょうどから許可、+29999 は拒否（ms 単位）', async () => {
  await seed(X, { B: { online: false, offlineAt: N - 30000 } }); await ok(res(A(), 0).set(FF()));
  await seed(X, { B: { online: false, offlineAt: N - 29999 } }); await ng(res(A(), 0).set(FF()));
  await seed(X, { B: { online: false, offlineAt: N - 120000 } }); await ok(res(A(), 0).set(FF()));
});
test('F02 相手が online=true なら forfeit は拒否。猶予内（offline になって1秒）も拒否', async () => {
  await seed(X); await ng(res(A(), 0).set(FF())); await seed(X, { B: { online: false, offlineAt: N - 1000 } }); await ng(res(A(), 0).set(FF()));
});
test('F03 相手は meta から自動で決まる（vs のような指定は不可）。ホストが切断→ゲストから、ゲストが切断→ホストから書ける', async () => {
  await seed(X, { B: { online: false, offlineAt: N - 40000 } }); await ng(res(A(), 0).set(FF({ vs: 'B' }))); await ng(res(A(), 0).set(FF({ vs: 'A' })));
  await seed(X, { A: { online: false, offlineAt: N - 40000 } }); await ok(res(B(), 0).set(FF({ by: 'B' })));
  await seed(X, { A: { online: false, offlineAt: N - 40000 } }); await ng(res(A(), 0).set(FF()), '切断中の本人が自分を理由に書く（相手 B は online）');
});
test('F04 by は自分でなければならない（相手名義の forfeit 不可）。非参加者は書けない。expr は付けられない', async () => {
  await seed(X, { B: { online: false, offlineAt: N - 40000 } });
  await ng(res(A(), 0).set(FF({ by: 'B' }))); await ng(res(Cc(), 0).set(FF({ by: 'C' }))); await ng(res(A(), 0).set(FF({ expr: '1' }))); await ng(res(A(), 0).set({ kind: 'forfeit', at: N }));
});
test('F05 guest がまだいない部屋では forfeit できない（相手が存在しない）', async () => {
  await seed(X, { guest: false, B: false, match: false, round0: false, extra: async r => { await r.child('rounds/0/startAt').set(4000); } }); await ng(res(A(), 0).set(FF()));
});
test('F06 forfeit は締切後でも書ける（ラウンドが始まっていれば）。startAt が無いラウンドには書けない', async () => {
  await seed(X, { now: 4000 + 90000, B: { online: false, offlineAt: 4000 } }); await ok(res(A(), 0).set(FF({ at: 4000 + 90000 })));
  await seed(X, { B: { online: false, offlineAt: N - 40000 } }); await ng(res(A(), 1).set(FF()));
});
test('F07 切断を偽装できない：自分で offlineAt を過去にする・相手が書く、はどちらも拒否', async () => {
  await seed(X); await ng(room(B()).child('players/B').update({ online: false, offlineAt: N - 40000 })); await ng(room(A()).child('players/B').update({ online: false, offlineAt: N }));
});

// ---------------- live（残り枚数・お手つき） ----------------
const LIVE = (o) => Object.assign({ r: 0, cards: 4, lockUntil: 0 }, o || {});
test('G01 live は本人だけが書ける。他人の live・非参加者の live への書き込みは拒否', async () => {
  await seed(X); await ok(room(A()).child('live/A').set(LIVE())); await ok(room(B()).child('live/B').set(LIVE({ cards: 3 })));
  await ng(room(A()).child('live/B').set(LIVE())); await ng(room(B()).child('live/A').set(LIVE())); await ng(room(Cc()).child('live/C').set(LIVE())); await ng(room(Cc()).child('live/A').set(LIVE())); await ng(room(U()).child('live/A').set(LIVE()));
  await ng(room(A()).child('live/B/cards').set(1)); await ng(room(A()).child('live/B').remove());
});
test('G02 cards は 1〜4 の整数、r は 0〜7 の整数。余計な子は拒否', async () => {
  for (const e of [{ cards: 0 }, { cards: 5 }, { cards: 2.5 }, { cards: '3' }, { r: -1 }, { r: 8 }, { r: 1.5 }, { junk: 1 }]) { await seed(X); await ng(room(A()).child('live/A').set(LIVE(e))); }
  for (const e of [{ cards: 1 }, { cards: 4 }, { r: 7 }]) { await seed(X); await ok(room(A()).child('live/A').set(LIVE(e))); }
  await seed(X); await ng(room(A()).child('live/A').set({ r: 0, cards: 4 }));
});
test('G03 lockUntil は now+10000 の形（± 2000ms）か 0 のみ：境界の内側は通り、外側は拒否', async () => {
  for (const [d, okk] of [[10000, true], [8000, true], [12000, true], [7999, false], [12001, false], [1, false], [60000, false], [-10000, false]]) { await seed(X); const p = room(A()).child('live/A').set(LIVE({ lockUntil: N + d })); await (okk ? ok(p) : ng(p)); }
  await seed(X); await ok(room(A()).child('live/A').set(LIVE({ lockUntil: 0 })));
});
test('G04 お手つき中（ロック有効）は lockUntil を変えられない（解除・延長不可）が、cards の更新では据え置きで通る', async () => {
  await seed(X, { extra: async r => { await r.child('live/A').set(LIVE({ lockUntil: N + 10000 })); } });
  await ng(room(A()).child('live/A').update({ lockUntil: 0 })); await ng(room(A()).child('live/A').update({ lockUntil: N + 12000 })); await ok(room(A()).child('live/A').update({ cards: 3 }));
});
test('G05 ロックが失効したあとは、もう一度 now+10000 を書ける。失効の境界（lockUntil == now）は書ける、lockUntil > now は不可', async () => {
  await seed(X, { extra: async r => { await r.child('live/A').set(LIVE({ lockUntil: N })); } }); await ok(room(A()).child('live/A').update({ lockUntil: N + 10000 }));
  await seed(X, { extra: async r => { await r.child('live/A').set(LIVE({ lockUntil: N + 1 })); } }); await ng(room(A()).child('live/A').update({ lockUntil: N + 10000 }));
});
test('G06 live の本人は削除できる（掃除）。他人は削除できない', async () => {
  await seed(X, { extra: async r => { await r.child('live/A').set(LIVE()); } }); await ng(room(B()).child('live/A').remove()); await ok(room(A()).child('live/A').remove());
});

// ---------------- 部屋の削除・rematch ----------------
test('H01 参加者がいる新しい部屋は削除できない（ホストも他人も）', async () => {
  await seed(X); await ng(room(A()).remove()); await ng(room(Cc()).remove()); await ng(room(B()).remove());
});
test('H02 参加者が全員いなくなった部屋は、認証済みなら誰でも削除できる（掃除）。未認証は不可', async () => {
  await seed(X, { players: false, match: false, round0: false }); await ng(room(U()).remove()); await ok(room(Cc()).remove());
});
test('H03 作成から24時間たった部屋は、参加者が残っていても削除できる（境界：createdAt+86400000 より後）', async () => {
  await seed(X, { now: 1000 + 86400000 }); await ng(room(Cc()).remove());
  await seed(X, { now: 1000 + 86400001 }); await ok(room(Cc()).remove());
});
test('H04 rounds の一括削除（再戦のため）は、ホストで、ホストとゲストの両方が rematch=true のときだけ。ゲスト・片方だけ・非参加者は拒否', async () => {
  await seed(X, { A: { rematch: true }, B: { rematch: true } }); await ng(room(B()).child('rounds').remove()); await ng(room(Cc()).child('rounds').remove()); await ok(room(A()).child('rounds').remove());
  await seed(X); await ng(room(A()).child('rounds').remove());
  await seed(X, { A: { rematch: true } }); await ng(room(A()).child('rounds').remove());
  await seed(X, { B: { rematch: true } }); await ng(room(A()).child('rounds').remove());
});
test('H05 一括削除以外の方法（result だけの削除・書き換え）は、両者 rematch=true でも拒否', async () => {
  await seed(X, { A: { rematch: true }, B: { rematch: true }, extra: async r => { await r.child('rounds/0/result').set(SOLVE('B')); } });
  await ng(room(A()).child('rounds/0/result').remove()); await ng(room(A()).child('rounds/0/result').set(SOLVE('A')));
  await seed(X, { A: { rematch: true }, B: { rematch: true }, extra: async r => { await r.child('rounds/0/result').set(SOLVE('B')); await r.child('rounds/1/startAt').set(N); } });
  await ng(room(A()).child('rounds/0').remove()); await ng(room(A()).child('rounds/1').remove()); await ok(room(A()).child('rounds').remove());
});
test('H06 再戦の流れ：両者 rematch → ホストが rounds を消す → match を新しい no/seed に更新 → round0 の startAt を新しく書ける', async () => {
  await seed(X, { A: { rematch: true }, B: { rematch: true }, extra: async r => { await r.child('rounds/0/result').set(SOLVE('B')); } });
  await ok(room(A()).child('rounds').remove());
  await ok(room(A()).update({ match: { no: 2, mode: 3, seed: 'ABCD:fedcba9876543210:2', countdownAt: N }, 'rounds/0/startAt': N + 3000 }));
});

// ---------------- 本番版ルール（now・ServerValue.TIMESTAMP）での一連の流れ ----------------
const now = () => Date.now();
test('R01 本番版：部屋作成（TIMESTAMP）→参加→match 開始→解決＋次ラウンド→時間切れ… の一連が通る', async () => {
  await R.clearDatabase(); const a = db(R, 'A'), b = db(R, 'B'), r = (d) => room(d);
  await ok(r(a).update({ meta: { v: 1, app: '1.2', poolHash: 2332605222, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ok(r(b).update({ 'meta/guest': 'B', 'players/B': { name: 'い', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ng(r(db(R, 'C')).update({ 'meta/guest': 'C', 'players/C': { name: 'う', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ok(r(a).child('match').set({ mode: 3 }));
  await ok(r(b).child('players/B/ready').set(true));
  await ok(r(a).update({ match: { no: 1, mode: 3, seed: 'ABCD:0123456789abcdef:1', countdownAt: TS }, 'rounds/0/startAt': now() + 3000 }));
  await new Promise(res => setTimeout(res, 3100));
  await ok(r(b).update({ 'rounds/0/result': { by: 'B', kind: 'solve', expr: '8÷(1-1÷5)', at: TS }, 'rounds/1/startAt': now() + 5000 }));
  await ng(r(a).child('rounds/0/result').set({ by: 'A', kind: 'solve', expr: '1+1', at: TS }));
  await ok(r(a).child('live/A').set({ r: 1, cards: 4, lockUntil: 0 })); await ok(r(a).child('live/A').update({ cards: 3 })); await ok(r(a).child('live/A').update({ lockUntil: now() + 10000 }));
  await ng(r(a).child('live/B').set({ r: 1, cards: 4, lockUntil: 0 }));
  const snap = await admin(R, d => r(d).get()); const v = snap.val(); assert.strictEqual(v.rounds[0].result.by, 'B'); assert(Math.abs(v.rounds[0].result.at - now()) < 10000); assert.strictEqual(v.meta.createdAt, v.players.A.joinedAt);
});
test('R02 本番版：切断の形（online=false, offlineAt=TIMESTAMP）→ 猶予内の forfeit は拒否', async () => {
  await R.clearDatabase(); const a = db(R, 'A'), b = db(R, 'B');
  await ok(room(a).update({ meta: { v: 1, app: '1.2', poolHash: 1, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ok(room(b).update({ 'meta/guest': 'B', 'players/B': { name: 'い', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ok(room(a).update({ match: { no: 1, mode: 1, seed: 'ABCD:1', countdownAt: TS }, 'rounds/0/startAt': now() + 3000 }));
  await ok(room(b).child('players/B').update({ online: false, offlineAt: TS }));
  await ng(res(a, 0).set({ by: 'A', kind: 'forfeit', at: TS }));
  await ok(room(b).child('players/B').update({ online: true, offlineAt: null }));
});
test('R03 本番版：余裕のある拒否（startAt が遠い未来、countdownAt が now でない、guest 枠の3人目、lockUntil が遠い）', async () => {
  await R.clearDatabase(); const a = db(R, 'A'), b = db(R, 'B');
  await ok(room(a).update({ meta: { v: 1, app: '1.2', poolHash: 1, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ok(room(b).update({ 'meta/guest': 'B', 'players/B': { name: 'い', joinedAt: TS, online: true, ready: false, rematch: false } }));
  await ng(room(a).update({ match: { no: 1, mode: 1, seed: 'ABCD:1', countdownAt: TS }, 'rounds/0/startAt': now() + 60000 }));
  await ng(room(a).update({ match: { no: 1, mode: 1, seed: 'ABCD:1', countdownAt: now() - 5000 }, 'rounds/0/startAt': now() + 3000 }));
  await ok(room(a).update({ match: { no: 1, mode: 1, seed: 'ABCD:1', countdownAt: TS }, 'rounds/0/startAt': now() + 3000 }));
  await ng(room(a).child('live/A').set({ r: 0, cards: 4, lockUntil: now() + 60000 }));
});
test('R04 本番版：締切後の解決は拒否・締切内は許可・締切後の時間切れは許可（startAt を過去にした部屋を管理者で用意）', async () => {
  await R.clearDatabase();
  const t0 = now();
  await admin(R, async d => { const r = room(d); await r.child('meta').set({ v: 1, app: '1.2', poolHash: 1, host: 'A', guest: 'B', createdAt: t0 }); await r.child('players/A').set(PL('あ', { joinedAt: t0 })); await r.child('players/B').set(PL('い', { joinedAt: t0 }));
    await r.child('match').set({ no: 1, mode: 1, seed: 'ABCD:1', countdownAt: t0 - 90000 }); await r.child('rounds/0/startAt').set(t0 - 70000); await r.child('rounds/1/startAt').set(t0 - 30000); });
  await ng(res(db(R, 'A'), 0).set({ by: 'A', kind: 'solve', expr: '1+1', at: TS }));    // 70秒前に開始 → 締切(61秒)を過ぎている
  await ng(res(db(R, 'A'), 1).set({ by: 'A', kind: 'solve', expr: '1+1', at: now() })); // at が TIMESTAMP でない
  await ok(res(db(R, 'A'), 1).set({ by: 'A', kind: 'solve', expr: '1+1', at: TS }));      // 30秒前に開始 → 締切内
  await ok(res(db(R, 'B'), 0).set({ kind: 'timeout', at: TS }));                           // 締切後の時間切れ
});
// ---------------- 同一性（時計注入版 / 合成 / 既存ゲーム不変）----------------
test('Z01 時計注入版のルールは、時計の式を置き換えただけで本番版と一字一句同じ', () => {
  const real = JSON.stringify(fragment); const inj = JSON.stringify(fragment.build({ now: NOWX }));
  assert.notStrictEqual(real, inj); assert.strictEqual(inj.split(NOWX).join('now'), real);
});
test('Z02 断片は純粋な JSON（enumerable なキーは rooms のみ）で、論理代入演算子を含まない', () => {
  assert.deepStrictEqual(Object.keys(fragment), ['rooms']); assert.deepStrictEqual(JSON.parse(JSON.stringify(fragment)), fragment); const OPS = new RegExp(['\\?\\?=', '\\|\\|=', '&'.repeat(2) + '='].join('|')); assert(!OPS.test(JSON.stringify(fragment)));
  assert(!OPS.test(require('fs').readFileSync(path.join(__dirname, '../firebase/tenpuzzle-rules.cjs'), 'utf8').replace(/\/\/[^\n]*/g, '')));
});
test('Z03 合成後のルール：既存ゲームの部分木は一字一句同じで、増えるのは games/tenpuzzle だけ', () => {
  const out = composeRules(SAMPLE, fragment); assert.deepStrictEqual(diffPaths(SAMPLE, out.candidate), { added: ['rules/games/tenpuzzle'], removed: [], changed: [] });
  assert.deepStrictEqual(JSON.stringify(out.candidate.rules.games.iroyomi), JSON.stringify(SAMPLE.rules.games.iroyomi)); assert.deepStrictEqual(out.candidate.rules.games.factor, SAMPLE.rules.games.factor);
});
test('Z04 合成後のルールでも、既存ゲーム（サンプルの iroyomi / factor）の挙動は合成前と同じ。tenpuzzle は動く', async () => {
  const before = await initializeTestEnvironment({ projectId: 'demo-tp-before', database: { rules: JSON.stringify(SAMPLE) } });
  const after = await initializeTestEnvironment({ projectId: 'demo-tp-after', database: { rules: JSON.stringify(composeRules(SAMPLE, fragment).candidate) } });
  try {
    for (const env of [before, after]) {
      await env.clearDatabase(); const a = db(env, 'A'), u = db(env);
      await ok(a.ref('games/iroyomi/rooms/XYZ2/note').set('hello')); await ng(u.ref('games/iroyomi/rooms/XYZ2/note').set('x')); await ng(a.ref('games/iroyomi/rooms/XYZ2/other').set('x'));
      await ok(a.ref('games/iroyomi/rooms/XYZ2').get()); await ng(u.ref('games/iroyomi/rooms/XYZ2').get());
      await ok(a.ref('games/factor/scores/A').set(5)); await ng(a.ref('games/factor/scores/B').set(5)); await ok(u.ref('games/factor/scores').get());
      await ng(a.ref('games/nothing/x').set(1)); await ng(u.ref('x').get());
    }
    const a2 = db(after, 'A'); await ok(room(a2).update({ meta: { v: 1, app: '1.2', poolHash: 1, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
    await ng(db(before, 'A').ref(P).child('meta').set(META('A')));
  } finally { await before.cleanup(); await after.cleanup(); }
});
test('Z05 合成後の tenpuzzle ルールが、単体（断片だけ）のルールと同じ挙動になる（標準の部屋で3人目拒否・先着）', async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-tp-composed', database: { rules: JSON.stringify(composeRules(SAMPLE, fragment).candidate) } });
  try {
    await env.clearDatabase(); const a = db(env, 'A'), b = db(env, 'B'), c = db(env, 'C');
    await ok(room(a).update({ meta: { v: 1, app: '1.2', poolHash: 1, host: 'A', createdAt: TS }, 'players/A': { name: 'あ', joinedAt: TS, online: true, ready: false, rematch: false } }));
    await ok(room(b).update({ 'meta/guest': 'B', 'players/B': { name: 'い', joinedAt: TS, online: true, ready: false, rematch: false } })); await ng(room(c).update({ 'meta/guest': 'C', 'players/C': { name: 'う', joinedAt: TS, online: true, ready: false, rematch: false } }));
  } finally { await env.cleanup(); }
});

(async () => {
  SAMPLE = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'fixtures/console-rules-sample.json'), 'utf8'));
  X = await initializeTestEnvironment({ projectId: 'demo-tp-x', database: { rules: rulesOf(fragment.build({ now: NOWX })) } });
  R = await initializeTestEnvironment({ projectId: 'demo-tp-r', database: { rules: rulesOf(fragment) } });
  for (const t of queue) {
    try { await t.fn(); pass++; console.log('ok   ' + t.name); }
    catch (e) { fail++; failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n     ')); }
  }
  await X.cleanup(); await R.cleanup();
  const g = Object.keys(groups).sort().map(k => k + ' ' + groups[k]).join(' / ');
  console.log('\n==== 結果: ' + pass + '/' + (pass + fail) + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====\n内訳: ' + g);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
