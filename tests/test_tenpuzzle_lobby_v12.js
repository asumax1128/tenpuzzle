// テンパズル v1.2 分割 4-3（ロビー）の2ウィンドウ対戦テスト：Firebase エミュレータ（auth + database）＋ Playwright の複数コンテキスト。
// 実行: npm install && npm run test:lobby   （= firebase emulators:exec --only auth,database --project demo-tp-lobby "node tests/test_tenpuzzle_lobby_v12.js"）
// 本番の Firebase・gstatic には接続しない（SDK は node_modules/firebase の compat 版を gstatic の URL に差し替えて配る。版は 10.x で、本番の 12.12.0 とは別）。
// ルールは firebase/tenpuzzle-rules.cjs の実物（本番版・now のまま）をエミュレータに読み込んで使う。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const fragment = require('../firebase/tenpuzzle-rules.cjs');
const HTML = path.join(__dirname, '..', 'prototype-tenpuzzle-v12.html');
const NS = 'demo-tp-lobby', DB = 'http://127.0.0.1:9000';
const SDK = path.join(__dirname, '..', 'node_modules', 'firebase');
const TEST_CFG = { config: { apiKey: 'fake-api-key', authDomain: 'localhost', databaseURL: 'https://' + NS + '.firebaseio.com', projectId: NS, appId: '1:1:web:1' }, emulator: { auth: 'http://127.0.0.1:9099', dbHost: '127.0.0.1', dbPort: 9000 } };

let pass = 0, fail = 0; const failures = [], queue = [], groups = {};
function test(name, fn) { queue.push({ name, fn }); const g = name.split(' ')[0].replace(/[0-9]+$/, ''); groups[g] = (groups[g] || 0) + 1; }

async function setRules() {
  const r = await fetch(DB + '/.settings/rules.json?ns=' + NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify({ rules: { games: { tenpuzzle: fragment } } }) });
  assert.strictEqual(r.status, 200, 'rules load: ' + r.status + ' ' + (await r.text()));
}
const dbGet = async (p) => (await fetch(DB + '/' + p + '.json?ns=' + NS + '&access_token=owner')).json();
const dbPut = async (p, v) => { const r = await fetch(DB + '/' + p + '.json?ns=' + NS + '&access_token=owner', { method: 'PUT', body: JSON.stringify(v) }); assert.strictEqual(r.status, 200); };
const dbClear = async () => { await fetch(DB + '/.json?ns=' + NS + '&access_token=owner', { method: 'DELETE' }); };

let browser;
// プレイヤー1人分のブラウザコンテキスト（opts.name = ランキングと同じ名前、opts.sdk = 'ok' | 'fail'、opts.noTestCfg = 本番の設定のまま）
async function player(opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  await ctx.route('https://www.gstatic.com/firebasejs/12.12.0/*', route => {
    if (opts.sdk === 'fail') return route.abort();
    const f = path.basename(route.request().url());
    const file = path.join(SDK, f);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) });
  });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(({ cfg, name, noCfg }) => {
    try { if (!sessionStorage.getItem('__i')) { localStorage.clear(); sessionStorage.setItem('__i', '1'); if (name) localStorage.setItem('tenpuzzle_name', name); } } catch (e) { /* 続行 */ }
    if (!noCfg) window.__TP_FB_TEST__ = cfg;
  }, { cfg: TEST_CFG, name: opts.name || '', noCfg: !!opts.noTestCfg });
  await page.goto('file://' + HTML); await page.waitForSelector('#app');
  return { ctx, page, errs, name: opts.name };
}
const closeAll = async (ps) => { for (const p of ps) await p.ctx.close(); };
const text = (p, sel) => p.page.locator(sel).innerText();
async function openOnline(p) { await p.page.click('#onlineBtnTitle'); await p.page.waitForSelector('#ol-create:not([disabled])', { timeout: 15000 }); }
async function createRoom(p) { await openOnline(p); await p.page.click('#ol-create'); await p.page.waitForSelector('#ol-code-big', { timeout: 15000 }); return (await text(p, '#ol-code-big')).trim(); }
async function joinRoom(p, code) { await openOnline(p); await p.page.click('#ol-join-open'); await p.page.fill('#ol-code', code); await p.page.click('#ol-join'); }
async function waitText(p, sel, re, ms) { await p.page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent); }, [sel, re.source], { timeout: ms || 10000 }); }
const withRoom = (names, fn, opts) => async () => {
  await dbClear(); const ps = []; opts = opts || {};
  try { for (const n of names) ps.push(await player({ name: n })); await fn(ps); for (const p of ps) assert.deepStrictEqual(p.errs, [], 'pageerror: ' + p.name); } finally { await closeAll(ps); }
};

// ---------------- 作成・参加・準備・開始 ----------------
test('L01 部屋を作る：4文字のコード（許可文字のみ）を大きく表示し、meta と players/<自uid> の全項目が書かれる。名前はランキングと同じ名前', withRoom(['ゆうた'], async ([a]) => {
  const code = await createRoom(a); assert(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(code), code);
  const room = await dbGet('games/tenpuzzle/rooms/' + code); const uid = Object.keys(room.players)[0];
  assert.deepStrictEqual(Object.keys(room.meta).sort(), ['app', 'createdAt', 'host', 'poolHash', 'v']); assert.strictEqual(room.meta.v, 1); assert.strictEqual(room.meta.app, '1.2'); assert.strictEqual(room.meta.host, uid); assert.strictEqual(typeof room.meta.createdAt, 'number');
  const hash = await a.page.evaluate(() => TP.poolHash(window.__TP_UI.POOL)); assert.strictEqual(room.meta.poolHash, hash);
  assert.deepStrictEqual(Object.keys(room.players[uid]).sort(), ['joinedAt', 'name', 'online', 'ready', 'rematch']); assert.strictEqual(room.players[uid].name, 'ゆうた'); assert.strictEqual(room.players[uid].online, true); assert.strictEqual(room.players[uid].ready, false); assert.strictEqual(room.players[uid].rematch, false);
  assert.strictEqual(room.meta.guest, undefined); assert.deepStrictEqual(room.match, { mode: 3 });
  assert((await text(a, '#ol-p-0')).includes('ゆうた')); assert(await a.page.locator('#ol-waiting').count() === 1, 'あいて待ち表示');
}));
test('L02 名前が未設定なら「プレイヤー」を使う', withRoom([''], async ([a]) => {
  const code = await createRoom(a); const room = await dbGet('games/tenpuzzle/rooms/' + code); assert.strictEqual(Object.values(room.players)[0].name, 'プレイヤー'); assert((await text(a, '#ol-name')).includes('プレイヤー'));
}));
test('L03 部屋に入る：コードを入れて参加 → meta.guest と players が書かれ、両画面に2人の名前が出る（小文字・全角でも入れる）', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code.toLowerCase());
  await b.page.waitForSelector('#ol-code-big'); await waitText(a, '#ol-p-1', /ゲスト/); await waitText(b, '#ol-p-0', /ホスト/);
  const room = await dbGet('games/tenpuzzle/rooms/' + code); const uids = Object.keys(room.players); assert.strictEqual(uids.length, 2); assert.strictEqual(room.meta.guest, uids.find(u => u !== room.meta.host));
  assert.strictEqual(room.players[room.meta.guest].name, 'ゲスト'); assert((await text(a, '#ol-p-0')).includes('ホスト')); assert((await text(b, '#ol-p-1')).includes('あなた'));
  assert.strictEqual(await a.page.locator('#ol-waiting').count(), 0);
}));
test('L04 準備OK：片方だけでは開始できない。両者 ready で、ホストにだけ「はじめる」が有効になる。ゲストにはモード選択・はじめるが操作できない', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code); await waitText(a, '#ol-p-1', /ゲスト/); await b.page.waitForSelector('#ol-code-big');
  assert(await a.page.locator('#ol-start[disabled]').count() === 1); assert.strictEqual(await b.page.locator('#ol-start').count(), 0, 'ゲストには はじめる が無い');
  assert.strictEqual(await b.page.locator('#ol-mode-5[disabled]').count(), 1); assert.strictEqual(await a.page.locator('#ol-mode-5[disabled]').count(), 0);
  await a.page.click('#ol-ready'); await waitText(b, '#ol-p-0', /じゅんびOK/); assert.strictEqual(await a.page.locator('#ol-start[disabled]').count(), 1, 'ホストだけ ready ではまだ');
  await b.page.click('#ol-ready'); await waitText(a, '#ol-p-1', /じゅんびOK/); await a.page.waitForSelector('#ol-start:not([disabled])');
  await a.page.click('#ol-ready'); await a.page.waitForSelector('#ol-start[disabled]'); assert((await text(a, '#ol-ready')).includes('やめる') === false);
}));
test('L05 モード選択はホストのみ：1組／3組／5組が両画面に反映され、match.mode に書かれる', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big');
  for (const m of [5, 1, 3]) { await a.page.click('#ol-mode-' + m); await b.page.waitForSelector('#ol-mode-' + m + '.on'); assert.strictEqual((await dbGet('games/tenpuzzle/rooms/' + code + '/match/mode')), m); await a.page.waitForSelector('#ol-mode-' + m + '.on'); }
  await b.page.evaluate(() => window.__TP_UI.handle('ol-mode', { dataset: { mode: '5' } })); await b.page.waitForTimeout(500);
  assert.strictEqual(await dbGet('games/tenpuzzle/rooms/' + code + '/match/mode'), 3, 'ゲストからは変えられない');
}));
test('L06 開始：両者 ready でホストが「はじめる」→ match（no/mode/seed/countdownAt）と rounds/0/startAt が書かれ、両画面に「まもなく開始」が出る。seed から同じ組セットが引ける', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big');
  await a.page.click('#ol-mode-5'); await b.page.waitForSelector('#ol-mode-5.on'); await a.page.click('#ol-ready'); await b.page.click('#ol-ready'); await a.page.waitForSelector('#ol-start:not([disabled])');
  const t0 = Date.now(); await a.page.click('#ol-start');
  // 4-4 以降：開始合図のあとは対戦画面（カウントダウン → 第1問）に切り替わる
  await a.page.waitForSelector('#vs-count, #vs-label'); await b.page.waitForSelector('#vs-count, #vs-label'); assert(/第1問 \/ 5/.test(await b.page.locator('#app').innerText()));
  const room = await dbGet('games/tenpuzzle/rooms/' + code); assert.deepStrictEqual(Object.keys(room.match).sort(), ['countdownAt', 'mode', 'no', 'seed']); assert.strictEqual(room.match.mode, 5); assert.strictEqual(room.match.no, 1); assert(new RegExp('^' + code + ':[0-9a-f]{16}:1$').test(room.match.seed), room.match.seed);
  assert(Math.abs(room.rounds[0].startAt - (t0 + 3000)) < 4000, 'startAt ≈ now+3000: ' + (room.rounds[0].startAt - t0)); assert.deepStrictEqual(Object.keys(room.rounds[0]), ['startAt']);
  const sa = await a.page.evaluate(([s, m]) => JSON.stringify(TP.versusSets(window.__TP_UI.POOL, s, m)), [room.match.seed, room.match.mode]);
  const sb = await b.page.evaluate(([s, m]) => JSON.stringify(TP.versusSets(window.__TP_UI.POOL, s, m)), [room.match.seed, room.match.mode]); assert.strictEqual(sa, sb); assert.strictEqual(JSON.parse(sa).length, 5);
  assert.strictEqual(await a.page.locator('#ol-start').count(), 0); assert.strictEqual(await b.page.locator('#ol-ready').count(), 0, '開始後は準備ボタンを出さない');
}));
test('L07 開始の時点では result はまだ無い。部屋のキーは meta/players/match/rounds（＋4-4 の live）のみ。切断（onDisconnect）の登録は 4-5', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big'); await a.page.click('#ol-ready'); await b.page.click('#ol-ready'); await a.page.waitForSelector('#ol-start:not([disabled])'); await a.page.click('#ol-start'); await b.page.waitForSelector('#vs-count, #vs-label');
  const room = await dbGet('games/tenpuzzle/rooms/' + code); Object.keys(room).forEach(k => assert(['match', 'meta', 'players', 'rounds', 'live'].indexOf(k) >= 0, k)); assert.strictEqual(room.rounds[0].result, undefined);
  const html = fs.readFileSync(HTML, 'utf8'); assert(/onDisconnect\(\)\.update\(TP\.buildOfflineUpdate/.test(html), '4-5：onDisconnect で在席を書く');
}));

// ---------------- 拒否 ----------------
test('R01 3つ目のコンテキストは満員で参加を拒否される。DB の players は2人のまま', withRoom(['ホスト', 'ゲスト', 'さんにん'], async ([a, b, c]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big'); await waitText(a, '#ol-p-1', /ゲスト/);
  await joinRoom(c, code); await waitText(c, '#ol-msg', /満員/); assert.strictEqual(await c.page.locator('#ol-code-big').count(), 0);
  const room = await dbGet('games/tenpuzzle/rooms/' + code); assert.strictEqual(Object.keys(room.players).length, 2);
}));
test('R02 poolHash が違う部屋には参加できない（その旨を表示し、何も書かない）', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await dbPut('games/tenpuzzle/rooms/' + code + '/meta/poolHash', 12345);
  await joinRoom(b, code); await waitText(b, '#ol-msg', /バージョン/); assert(await b.page.locator('#ol-code-big').count() === 0);
  const room = await dbGet('games/tenpuzzle/rooms/' + code); assert.strictEqual(Object.keys(room.players).length, 1); assert.strictEqual(room.meta.guest, undefined);
}));
test('R03 存在しないコード・形式が不正なコードは入れない（不正な形式は通信せずに案内）', withRoom(['ゲスト'], async ([b]) => {
  await openOnline(b); await b.page.click('#ol-join-open'); await b.page.fill('#ol-code', 'ABCD'); await b.page.click('#ol-join'); await waitText(b, '#ol-msg', /見つかりません/);
  for (const bad of ['AB', 'ABCDE', 'AB0D', 'ABOL', '']) { await b.page.fill('#ol-code', bad); await b.page.click('#ol-join'); await waitText(b, '#ol-msg', /4文字/); }
  assert.strictEqual(await dbGet('games/tenpuzzle/rooms'), null);
}));
test('R04 ホストがいない部屋（ホストが抜けた後）には入れない', withRoom(['ホスト', 'ゲスト', 'つぎの人'], async ([a, b, c]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big'); await waitText(a, '#ol-p-1', /ゲスト/);
  const uid = await a.page.evaluate(() => window.__TP_UI.OL.uid); await dbPut('games/tenpuzzle/rooms/' + code + '/players/' + uid, null);
  await b.page.waitForSelector('#ol-create', { timeout: 10000 }); // ゲスト側は「ホストが抜けた」ので部屋をとじて戻る
  await joinRoom(c, code); await c.page.waitForFunction(() => /見つかりません|もう使えません/.test((document.querySelector('#ol-msg') || {}).textContent || ''));
}));

// ---------------- 退出 ----------------
test('X01 ゲストが退出：players/<ゲスト> が消え、ホストの画面は「あいてをまっています」に戻る。meta.guest は残る（ルールは削除を許さない）が、別の人が入れ替われる', withRoom(['ホスト', 'ゲスト', 'つぎの人'], async ([a, b, c]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big'); await waitText(a, '#ol-p-1', /ゲスト/);
  await b.page.click('#ol-leave'); await b.page.waitForSelector('#ol-create'); await a.page.waitForSelector('#ol-waiting');
  let room = await dbGet('games/tenpuzzle/rooms/' + code); assert.strictEqual(Object.keys(room.players).length, 1); assert(typeof room.meta.guest === 'string');
  await joinRoom(c, code); await waitText(a, '#ol-p-1', /つぎの人/); room = await dbGet('games/tenpuzzle/rooms/' + code); assert.strictEqual(room.players[room.meta.guest].name, 'つぎの人');
}));
test('X02 ホストが一人のときに退出：部屋が消える（players と room が削除される）', withRoom(['ホスト'], async ([a]) => {
  const code = await createRoom(a); await a.page.click('#ol-leave'); await a.page.waitForSelector('#ol-create'); await a.page.waitForTimeout(400);
  assert.strictEqual(await dbGet('games/tenpuzzle/rooms/' + code), null);
}));
test('X03 ホストがゲストのいる部屋から退出：ホストは抜け、ゲスト側が「ホストが抜けた」と知らせて部屋をとじる（最終的に部屋は消える）', withRoom(['ホスト', 'ゲスト'], async ([a, b]) => {
  const code = await createRoom(a); await joinRoom(b, code); await b.page.waitForSelector('#ol-code-big'); await waitText(a, '#ol-p-1', /ゲスト/);
  await a.page.click('#ol-leave'); await a.page.waitForSelector('#ol-create');
  await b.page.waitForSelector('#ol-create', { timeout: 10000 }); assert(/ホストが抜けた/.test(await text(b, '#ol-msg')));
  await b.page.waitForTimeout(500); assert.strictEqual(await dbGet('games/tenpuzzle/rooms/' + code), null);
}));
test('X04 「もどる」でも待機中は退出する（待機画面の ol-back）', withRoom(['ホスト'], async ([a]) => {
  const code = await createRoom(a); await a.page.click('#ol-back'); await a.page.waitForSelector('#ol-create'); await a.page.waitForTimeout(400); assert.strictEqual(await dbGet('games/tenpuzzle/rooms/' + code), null);
}));
test('X05 部屋が外から消されたら「へやがとじられました」と表示してメニューに戻る', withRoom(['ホスト'], async ([a]) => {
  const code = await createRoom(a); await dbPut('games/tenpuzzle/rooms/' + code, null); await waitText(a, '#ol-msg', /とじられました/); assert(await a.page.locator('#ol-create').count() === 1);
}));

// ---------------- ソロへの影響・未接続 ----------------
async function soloWorks(p) {
  await p.page.evaluate(() => window.__TP_UI.handle('title'));
  const r = await p.page.evaluate(() => { const U = window.__TP_UI; const e = U.POOL.find(x => x.solvable && x.nSolutionsNorm === 1 && !x.fractionRequired); U.handle('play-key', { dataset: { key: TP.keyOf(e.digits) } });
    function dfs() { const n = U.ui.board.cards.length; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; for (const op of ['+', '-', '*', '/']) { const h0 = U.ui.board.history.length; U.handle('card', { dataset: { i: String(i) } }); U.handle('op', { dataset: { op } }); U.handle('card', { dataset: { i: String(j) } }); if (U.ui.screen === 'result') return true; if (U.ui.board.history.length > h0) { if (dfs()) return true; U.handle('undo'); } else { TP.clearInputA(U.ui.a); U.ui.sel = []; } } } return false; }
    return dfs() && U.ui.screen === 'result'; });
  assert.strictEqual(r, true); assert(await p.page.locator('#r-expr').count() === 1);
}
test('S01 SDK の読み込みに失敗：入口を押すと「つながりません」を表示し、タイトルの入口は無効表示に。ソロは通常どおり遊べる', async () => {
  const p = await player({ name: 'ひとり', sdk: 'fail' });
  try {
    await p.page.click('#onlineBtnTitle'); await p.page.waitForSelector('#ol-retry', { timeout: 20000 }); assert(/つながりませんでした/.test(await text(p, '#ol-msg')));
    await p.page.click('#ol-back'); await p.page.waitForSelector('#onlineBtnTitle[disabled]'); assert((await text(p, '#t-online-chip')).includes('つながりません'));
    assert.strictEqual(await p.page.locator('[data-act="play"]:not([disabled])').count(), 1); await soloWorks(p); assert.deepStrictEqual(p.errs, []);
  } finally { await closeAll([p]); }
});
test('S02 SDK 失敗のあと「もういちど」で再接続できる（SDK が配られるようになれば）', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } }); let ok = false;
  await ctx.route('https://www.gstatic.com/firebasejs/12.12.0/*', route => { if (!ok) return route.abort(); route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(SDK, path.basename(route.request().url()))) }); });
  const page = await ctx.newPage(); await page.addInitScript(cfg => { window.__TP_FB_TEST__ = cfg; }, TEST_CFG); await page.goto('file://' + HTML);
  try { await page.click('#onlineBtnTitle'); await page.waitForSelector('#ol-retry', { timeout: 20000 }); ok = true; await page.click('#ol-retry'); await page.waitForSelector('#ol-create:not([disabled])', { timeout: 15000 }); } finally { await ctx.close(); }
});
test('S03 FB_CONFIG が未設定（REPLACE のまま）なら：入口は「準備中」で無効。押しても何も起きず、SDK も読み込まない。ソロは通常どおり（4-4 で実値を入れたので、未設定は差し替え口で再現）', async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } }); let sdkReq = 0; ctx.on('request', r => { if (/gstatic\.com\/firebasejs/.test(r.url())) sdkReq++; });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { window.__TP_FB_TEST__ = { config: { apiKey: 'REPLACE_ME', authDomain: 'REPLACE_ME', databaseURL: 'REPLACE_ME', projectId: 'x', appId: 'REPLACE_ME' } }; });
  await page.goto('file://' + HTML); await page.waitForSelector('#app'); const p = { ctx, page, errs };
  try {
    assert.strictEqual(await page.locator('#onlineBtnTitle[disabled]').count(), 1); assert((await page.locator('#t-online-chip').innerText()).includes('準備中'));
    await page.evaluate(() => window.__TP_UI.handle('online')); assert.strictEqual(await page.evaluate(() => window.__TP_UI.ui.screen), 'title'); assert.strictEqual(sdkReq, 0);
    await soloWorks(p); assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});
test('S03b 本番の FB_CONFIG は FACTOR の実値（asumath-games）。差し替え口なしでも入口は有効（未設定扱いにならない）', async () => {
  const html = fs.readFileSync(HTML, 'utf8');
  ["apiKey: 'AIzaSyC3__kwx4TH-ezcCCUWcb_J7PWZ7pDUjDc'", "authDomain: 'asumath-games.firebaseapp.com'", "databaseURL: 'https://asumath-games-default-rtdb.asia-southeast1.firebasedatabase.app'", "projectId: 'asumath-games'", "messagingSenderId: '254715782397'", "appId: '1:254715782397:web:bda2fd2283b292db050a94'"].forEach(x => assert(html.includes(x), x));
  assert(!/REPLACE_WITH_FACTOR/.test(html));
  const p = await player({ name: 'ひとり', noTestCfg: true });
  try { assert.strictEqual(await p.page.locator('#onlineBtnTitle:not([disabled])').count(), 1); assert.strictEqual(await p.page.locator('#t-online-chip').count(), 0); } finally { await closeAll([p]); }
});
test('S04 設定済みなら Firebase の SDK は入口を押すまで読み込まない（ソロの起動を重くしない）。既存のタイトルの導線はそのまま', async () => {
  const p = await player({ name: 'ひとり' }); let sdkReq = 0; p.ctx.on('request', r => { if (/gstatic\.com\/firebasejs/.test(r.url())) sdkReq++; });
  try {
    await p.page.waitForTimeout(500); assert.strictEqual(sdkReq, 0);
    for (const s of ['[data-act="play"]', '[data-act="daily"]', '[data-act="zukan"]', '[data-act="howto"]', '[data-act="ranking"]', '[data-act="settings"]', '[data-act="export"]', '[data-act="import"]', '#onlineBtnTitle']) assert.strictEqual(await p.page.locator(s).count(), 1, s);
    await p.page.click('#onlineBtnTitle'); await p.page.waitForSelector('#ol-create:not([disabled])'); assert(sdkReq === 3, 'app / auth / database の3本: ' + sdkReq);
  } finally { await closeAll([p]); }
});
test('S05 SDK の URL は firebasejs 12.12.0 の compat 版（app / auth / database）で、gstatic から読む', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert(html.includes("'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/'") && html.includes("var FB_VERSION = '12.12.0'")); ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js'].forEach(f => assert(html.includes("'" + f + "'"), f));
  assert(/signInAnonymously/.test(html));
});

(async () => {
  await setRules(); browser = await chromium.launch();
  for (const t of queue) {
    try { await t.fn(); pass++; console.log('ok   ' + t.name); }
    catch (e) { fail++; failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + String((e && e.message) || e).split('\n').slice(0, 4).join('\n     ')); }
  }
  await browser.close();
  const g = Object.keys(groups).sort().map(k => k + ' ' + groups[k]).join(' / ');
  console.log('\n==== 結果: ' + pass + '/' + (pass + fail) + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====\n内訳: ' + g);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
