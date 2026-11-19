// テンパズル v1.1 テスト。実行: node tests/test_tenpuzzle_v11.js
// 構成: A〜F＝v1.0 の89項目（回帰。対象を v1.1 に差し替えただけ）／G〜K＝v1.1 の追加項目
// 注意：v0.9 の元テスト（136項目）はリポジトリに無かったため取り込めていない。
//  v0.9 の挙動は (A) 仕様値の固定テスト と (B) v0.9 ファイルとの差分（differential）テストで回帰を担保している。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const F10 = path.join(root, 'prototype-tenpuzzle-v11.html'); // 以降 V10/F10 は「現行（v1.1）」を指す
const F10OLD = path.join(root, 'prototype-tenpuzzle-v10.html'); // 公開中の v1.0
const F09 = path.join(root, 'prototype-tenpuzzle-v09.html');

let pass = 0, fail = 0; const failures = [];
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
async function runAll() {
  for (const t of queue) {
    try { await t.fn(); pass++; console.log('ok   ' + t.name); }
    catch (e) { fail++; failures.push(t.name); console.log('FAIL ' + t.name + '\n     ' + (e && e.message)); }
  }
}
function loadHtml(file) {
  const h = fs.readFileSync(file, 'utf8');
  const m = h.match(/\/\/ ===== CORE_START =====([\s\S]*?)\/\/ ===== CORE_END =====/);
  const mod = { exports: {} };
  new Function('module', m[1])(mod);
  const pool = JSON.parse(h.match(/id="pool-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  return { html: h, TP: mod.exports, pool };
}
function memStore(init) {
  const d = Object.assign({}, init || {});
  return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; }, _d: d };
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const V10 = loadHtml(F10), V09 = loadHtml(F09), V10OLD = loadHtml(F10OLD);
const TP = V10.TP, POOL = V10.pool, BY = TP.indexPool(POOL);
const single = POOL.find(e => e.solvable && e.nSolutionsNorm === 1 && !e.fractionRequired);
const multi = POOL.find(e => e.solvable && e.nSolutionsNorm > 1 && !e.fractionRequired);
const goldE = POOL.find(e => e.fractionRequired);
const unsolv = POOL.find(e => !e.solvable);

// ===================== A. v0.9 仕様の固定（回帰） =====================
test('A01 RANKING_URL は v0.9 と同一', () => { assert.strictEqual(TP.RANKING_URL, V09.TP.RANKING_URL); assert(/^https:\/\/script\.google\.com\/macros\/s\//.test(TP.RANKING_URL)); });
test('A02 SCORE 定数は v0.9 と同一', () => { assert.deepStrictEqual(TP.SCORE, V09.TP.SCORE); assert.deepStrictEqual(TP.SCORE, { goldExtra: 120, declare: 50, declareWithHint: 25, fraction: 25, distinctOps: 25, newSolution: 15 }); });
test('A03 BASE / TIERS は v0.9 と同一', () => { assert.deepStrictEqual(TP.BASE, V09.TP.BASE); assert.deepStrictEqual(TP.TIERS, V09.TP.TIERS); });
test('A04 SAVE_VERSION(4) / SAVE_KEY / SETTINGS_KEY は不変', () => { assert.strictEqual(TP.SAVE_VERSION, 4); assert.strictEqual(TP.SAVE_VERSION, V09.TP.SAVE_VERSION); assert.strictEqual(TP.SAVE_KEY, V09.TP.SAVE_KEY); assert.strictEqual(TP.SETTINGS_KEY, 'tenpuzzle_settings_v1'); });
test('A05 NEXT_MIX_RATE は 0.1（pickNext の10%分岐）', () => { assert.strictEqual(TP.NEXT_MIX_RATE, 0.1); assert.strictEqual(TP.NEXT_MIX_RATE, V09.TP.NEXT_MIX_RATE); });
test('A06 v0.9 の公開関数は全て v1.0 にも存在', () => { Object.keys(V09.TP).forEach(k => assert(k in TP, k + ' がない')); });
test('A07 v1.0 が増やした公開名（祝福/BGM）は v1.1 にも残っている。増えたのはデイリー関連のみ', () => {
  const added = Object.keys(TP).filter(k => !(k in V09.TP));
  ['BGM', 'PRAISE', 'celebrationFor', 'createBgm', 'praiseFor'].forEach(k => assert(added.indexOf(k) >= 0, k));
  const v11only = Object.keys(TP).filter(k => !(k in V10OLD.TP)).sort();
  assert.deepStrictEqual(v11only, ['DAILY_ANCHOR', 'DAILY_KEY', 'DAILY_PT_MAX', 'DAILY_SCORE_MAX', 'DAILY_SLOTS', 'addDays', 'cleanDailyRows', 'dailyApply', 'dailyGetUrl', 'dailyRankingParams', 'dailySets', 'dailySummary', 'drawSets', 'emptyDaily', 'encodeDailyParams', 'fnv1a32', 'isDateString', 'jstDateString', 'loadDaily', 'mulberry32', 'sortDailyRows', 'writeDaily']);
});
test('A08 問題プールは v0.9 と同一', () => { assert.deepStrictEqual(POOL, V09.pool); });
test('A09 canon4：+ × の交換は同一視、− ÷ の向きは別', () => {
  const k = e => TP.canon4(TP.parse(e));
  assert.strictEqual(k('(1+1)×(1+4)'), k('(4+1)×(1+1)'));
  assert.notStrictEqual(k('8÷(1-1÷5)'), k('(1-1÷5)÷8'));
});
test('A10 solve（通常）：内訳・新解法・累計', () => {
  const s = TP.emptySave(); const R = TP.solve(s, single, TP.parse(single.example));
  assert.strictEqual(R.isNew, true); assert.strictEqual(R.newBonus, 15); assert.strictEqual(R.foundCount, 1);
  assert.strictEqual(R.attempt, R.base + R.gold + (R.fraction ? 25 : 0) + (R.distinctOps ? 25 : 0) + 15);
  assert.strictEqual(R.total, s.total);
});
test('A11 solve：同じ解法の再発見は新解法ボーナスなし', () => {
  const s = TP.emptySave(); TP.solve(s, single, TP.parse(single.example));
  const R2 = TP.solve(s, single, TP.parse(single.example));
  assert.strictEqual(R2.isNew, false); assert.strictEqual(R2.newBonus, 0); assert.strictEqual(R2.foundCount, 1);
});
test('A12 solve：金枠（分数必須）は +120', () => {
  const R = TP.solve(TP.emptySave(), goldE, TP.parse(goldE.example));
  assert.strictEqual(R.gold, 120); assert.strictEqual(R.fraction, true);
});
test('A13 declare：解けない組は成功50点、ヒント使用なら25点', () => {
  const R = TP.declare(TP.emptySave(), unsolv);
  assert.strictEqual(R.success, true); assert.strictEqual(R.points, 50);
  const s2 = TP.emptySave(); TP.rec(s2, TP.keyOf(unsolv.digits)).hintsUsed = 1;
  assert.strictEqual(TP.declare(s2, unsolv).points, 25);
});
test('A14 declare：解ける組の宣言は失敗', () => { assert.strictEqual(TP.declare(TP.emptySave(), single).success, false); });
test('A15 セーブ 書き込み→読み込みの往復（v4）', () => {
  const st = memStore(); const s = TP.emptySave(); TP.solve(s, single, TP.parse(single.example));
  assert.strictEqual(TP.writeSave(st, s), true);
  const back = TP.loadSave(st, POOL, null); const sv = back.save || back;
  assert.strictEqual(sv.v, 4); assert.strictEqual(sv.total, s.total);
});
test('A16 セーブ書き出し→読み込み検証の往復', () => {
  const s = TP.emptySave(); TP.solve(s, single, TP.parse(single.example));
  const r = TP.parseImport(TP.exportSave(s), POOL, null);
  assert(r && (r.ok === true || r.save), 'parseImport が失敗: ' + JSON.stringify(r).slice(0, 200));
});
test('A17 書き出しに設定（bgm/controlMode）は含まれない', () => { assert(!/bgm|controlMode/.test(TP.exportSave(TP.emptySave()))); });
test('A18 pickNext：現在の組以外の有効なキーを返す', () => {
  const s = TP.emptySave(); const cur = TP.keyOf(single.digits); const orig = Math.random; Math.random = seeded(7);
  try { for (let i = 0; i < 50; i++) { const k = TP.pickNext(POOL, s, cur); assert(BY[k], '不正なキー'); assert.notStrictEqual(k, cur); } } finally { Math.random = orig; }
});
test('A19 pickNext：v0.9 と同じ乱数列なら同じ結果（differential）', () => {
  const s = TP.emptySave(); const a = [], b = []; const o = Math.random;
  Math.random = seeded(11); for (let i = 0; i < 100; i++) a.push(TP.pickNext(POOL, s, null));
  Math.random = seeded(11); for (let i = 0; i < 100; i++) b.push(V09.TP.pickNext(V09.pool, s, null));
  Math.random = o; assert.deepStrictEqual(a, b);
});
test('A20 solve：全ての解ける組で v0.9 と結果が完全一致（differential）', () => {
  POOL.filter(e => e.solvable).forEach(e => {
    const a = TP.solve(TP.emptySave(), e, TP.parse(e.example)), b = V09.TP.solve(V09.TP.emptySave(), e, V09.TP.parse(e.example));
    assert.deepStrictEqual(a, b, e.digits.join(''));
  });
});
test('A21 zukanSections / solutionBook は v0.9 と一致（differential）', () => {
  const s = TP.emptySave(), s9 = V09.TP.emptySave();
  [single, multi, goldE].forEach(e => { TP.solve(s, e, TP.parse(e.example)); V09.TP.solve(s9, e, V09.TP.parse(e.example)); });
  assert.deepStrictEqual(TP.zukanSections(POOL, s), V09.TP.zukanSections(POOL, s9));
  const k = TP.keyOf(single.digits);
  assert.deepStrictEqual(TP.solutionBook(single, TP.peekRec(s, k)), V09.TP.solutionBook(single, V09.TP.peekRec(s9, k)));
});
test('A22 ランキング用の統計は v0.9 と一致', () => {
  const s = TP.emptySave(); TP.solve(s, single, TP.parse(single.example));
  assert.deepStrictEqual(TP.rankingStats(s, POOL), V09.TP.rankingStats(s, V09.pool));
});

// ===================== B. 設定 =====================
test('B01 defaultSettings：bgm は false、controlMode は A', () => { assert.deepStrictEqual(TP.defaultSettings(), { controlMode: 'A', bgm: false }); });
test('B02 保存なしで読むと既定値', () => { assert.deepStrictEqual(TP.loadSettings(memStore()), { controlMode: 'A', bgm: false }); });
test('B03 bgm=true の 保存→読み込み が往復する', () => {
  const st = memStore(); assert.strictEqual(TP.writeSettings(st, { controlMode: 'A', bgm: true }), true);
  assert.deepStrictEqual(TP.loadSettings(st), { controlMode: 'A', bgm: true });
});
test('B04 controlMode=B, bgm=false の往復', () => { const st = memStore(); TP.writeSettings(st, { controlMode: 'B', bgm: false }); assert.deepStrictEqual(TP.loadSettings(st), { controlMode: 'B', bgm: false }); });
test('B05 旧形式 {controlMode:"B"} → controlMode 保持・bgm=false', () => {
  assert.deepStrictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"B"}' })), { controlMode: 'B', bgm: false });
});
test('B06 旧形式 {controlMode:"A"} → A / bgm=false', () => {
  assert.deepStrictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"A"}' })), { controlMode: 'A', bgm: false });
});
test('B07 writeSettings は controlMode と bgm の両方を保存する', () => {
  const st = memStore(); TP.writeSettings(st, { controlMode: 'B', bgm: true });
  assert.deepStrictEqual(JSON.parse(st._d.tenpuzzle_settings_v1), { controlMode: 'B', bgm: true });
});
test('B08 壊れたJSON・不正な型でも壊れない（bgm は真偽値 true のみ受理）', () => {
  assert.deepStrictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: '{broken' })), { controlMode: 'A', bgm: false });
  assert.deepStrictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"B","bgm":"yes"}' })), { controlMode: 'B', bgm: false });
  assert.deepStrictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: 'null' })), { controlMode: 'A', bgm: false });
  assert.deepStrictEqual(TP.loadSettings(null), { controlMode: 'A', bgm: false });
});
test('B09 controlMode：B 以外は A に正規化（既存挙動）', () => {
  assert.strictEqual(TP.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"Z"}' })).controlMode, 'A');
  const st = memStore(); TP.writeSettings(st, { controlMode: 'Z', bgm: false }); assert.strictEqual(JSON.parse(st._d.tenpuzzle_settings_v1).controlMode, 'A');
});
test('B10 bgm を含まない設定オブジェクトを書いても bgm=false で保存される', () => {
  const st = memStore(); TP.writeSettings(st, { controlMode: 'B' }); assert.deepStrictEqual(JSON.parse(st._d.tenpuzzle_settings_v1), { controlMode: 'B', bgm: false });
});

// ===================== C. BGM 状態遷移（AudioContext スタブ） =====================
function makeEnv() {
  const log = { osc: [], gains: [], suspends: 0, resumes: 0, ctxCreated: 0 };
  const timers = new Map(); let tid = 1;
  const ctx = {
    currentTime: 0, state: 'running', destination: { id: 'dest' },
    createGain() {
      const g = { gain: { value: 1, calls: [], cancelScheduledValues() {}, setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; }, linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); }, exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); }, setTargetAtTime(v, t, tc) { this.calls.push(['target', v, t, tc]); this.value = v; } }, connect(d) { if (d === ctx.destination) this.toDest = true; }, disconnect() {} };
      log.gains.push(g); return g;
    },
    createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start(t) { this.t0 = t; }, stop() {} }; log.osc.push(o); return o; },
    suspend() { this.state = 'suspended'; log.suspends++; }, resume() { this.state = 'running'; log.resumes++; }
  };
  const env = { getCtx() { log.ctxCreated++; return ctx; }, rnd: seeded(5),
    setInterval(f) { const id = tid++; timers.set(id, { f, kind: 'i' }); return id; }, clearInterval(id) { timers.delete(id); },
    setTimeout(f) { const id = tid++; timers.set(id, { f, kind: 't' }); return id; }, clearTimeout(id) { timers.delete(id); } };
  return { env, ctx, log, timers,
    runTimeouts() { [...timers.entries()].filter(([, v]) => v.kind === 't').forEach(([id, v]) => { timers.delete(id); v.f(); }); },
    timeouts() { return [...timers.values()].filter(v => v.kind === 't').length; },
    advance(sec) { const steps = Math.ceil(sec / 0.25); for (let i = 0; i < steps; i++) { ctx.currentTime += 0.25; [...timers.values()].filter(v => v.kind === 'i').forEach(v => v.f()); } },
    intervals() { return [...timers.values()].filter(v => v.kind === 'i').length; } };
}
const chroma = f => Math.round(12 * Math.log2(f / 261.63) + 120) % 12; // C=0
test('C01 初期状態は stopped。createBgm しただけでは AudioContext に触らない', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env);
  assert.strictEqual(b.state(), 'stopped'); assert.strictEqual(m.log.ctxCreated, 0);
});
test('C02 start：playing、BGM専用ゲインのマスター目標0.04へフェードイン（時定数つき）', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env);
  assert.strictEqual(b.start(), true); assert.strictEqual(b.state(), 'playing');
  assert(Math.abs(b.targetGain() - 0.04) < 1e-9, 'target=' + b.targetGain());
  const out0 = m.log.gains.find(g => g.toDest); const tgt = out0.gain.calls.filter(c => c[0] === 'target');
  assert(tgt.length >= 1 && tgt[tgt.length - 1][3] >= 0.5, 'フェードインの時定数');
  assert.strictEqual(m.log.gains[0].gain.calls[0][1], 0, '開始は無音から');
  assert.strictEqual(m.intervals(), 1);
});
test('C03 マスター音量は 0.04（効果音 beep の既定 0.05〜0.08 より小さい）', () => { assert.strictEqual(TP.BGM.MASTER, 0.04); });
test('C04 start の二重呼び出しは何もしない', () => { const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.start(); assert.strictEqual(m.intervals(), 1); assert.strictEqual(m.log.gains.filter(g => g.toDest).length, 1); });
test('C05 AudioContext が使えない環境では start が false、状態は stopped', () => {
  const m = makeEnv(); m.env.getCtx = () => null; const b = TP.createBgm(m.env);
  assert.strictEqual(b.start(), false); assert.strictEqual(b.state(), 'stopped');
});
test('C06 stop：stopped、フェードアウト（目標0）、スケジューラ停止', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.stop();
  assert.strictEqual(b.state(), 'stopped'); assert.strictEqual(b.targetGain(), 0); assert.strictEqual(m.intervals(), 0);
  const out0 = m.log.gains.find(g => g.toDest); const tgt = out0.gain.calls.filter(c => c[0] === 'target'); assert.strictEqual(tgt[tgt.length - 1][1], 0);
});
test('C07 stop 後の再 start で再び playing（ゲインは使い回し）', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.stop();
  assert.strictEqual(b.start(), true); assert.strictEqual(b.state(), 'playing');
  assert(Math.abs(b.targetGain() - 0.04) < 1e-9); assert.strictEqual(m.log.gains.filter(g => g.toDest).length, 1);
});
test('C08 stopped 中の stop は安全', () => { const m = makeEnv(); const b = TP.createBgm(m.env); b.stop(); assert.strictEqual(b.state(), 'stopped'); });
test('C09 ダッキング：クリア音の間は半分以下 → 時間が来たら元に戻る', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start();
  const base = b.targetGain(); b.duck(1.1);
  assert.strictEqual(b.isDucked(), true); assert(b.targetGain() <= base / 2, 'ducked=' + b.targetGain());
  m.runTimeouts();
  assert.strictEqual(b.isDucked(), false); assert(Math.abs(b.targetGain() - base) < 1e-9);
});
test('C10 ダッキング連打：復帰タイマーは常に1つ', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.duck(1); b.duck(1);
  assert.strictEqual(m.timeouts(), 1); m.runTimeouts(); assert.strictEqual(b.isDucked(), false);
});
test('C11 stopped 中の duck は何もしない', () => { const m = makeEnv(); const b = TP.createBgm(m.env); b.duck(1); assert.strictEqual(b.isDucked(), false); assert.strictEqual(m.timeouts(), 0); });
test('C12 ダッキング中に stop → ダッキング解除・目標0・タイマー残らず', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.duck(1); b.stop();
  assert.strictEqual(b.isDucked(), false); assert.strictEqual(b.targetGain(), 0); assert.strictEqual(m.timeouts(), 0);
});
test('C13 pause：paused、ctx.suspend、スケジューラ停止', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.pause();
  assert.strictEqual(b.state(), 'paused'); assert.strictEqual(m.log.suspends, 1); assert.strictEqual(m.ctx.state, 'suspended'); assert.strictEqual(m.intervals(), 0);
});
test('C14 resume：playing に戻り ctx.resume、スケジューラ再開', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.pause(); b.resume();
  assert.strictEqual(b.state(), 'playing'); assert.strictEqual(m.ctx.state, 'running'); assert.strictEqual(m.intervals(), 1);
});
test('C15 stopped 中の pause / resume は状態を変えない（オフの端末で勝手に鳴らない）', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.pause(); b.resume();
  assert.strictEqual(b.state(), 'stopped'); assert.strictEqual(m.log.ctxCreated, 0);
});
test('C16 visibilitychange：hidden で一時停止、visible で再開', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env);
  const hs = []; const doc = { hidden: false, addEventListener: (n, f) => { if (n === 'visibilitychange') hs.push(f); } };
  b.bindVisibility(doc); assert.strictEqual(hs.length, 1);
  b.start();
  doc.hidden = true; hs[0](); assert.strictEqual(b.state(), 'paused');
  doc.hidden = false; hs[0](); assert.strictEqual(b.state(), 'playing');
});
test('C17 BGMオフ（stopped）なら hidden→visible でも鳴らない', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); const hs = []; const doc = { hidden: true, addEventListener: (n, f) => hs.push(f) };
  b.bindVisibility(doc); hs[0](); doc.hidden = false; hs[0]();
  assert.strictEqual(b.state(), 'stopped'); assert.strictEqual(m.log.ctxCreated, 0);
});
test('C18 paused 中に stop → stopped（無音）', () => { const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); b.pause(); b.stop(); assert.strictEqual(b.state(), 'stopped'); assert.strictEqual(b.targetGain(), 0); });
test('C19 コード進行：I–V–vi–IV（C–G–Am–F）、構成音が正しい', () => {
  assert.deepStrictEqual(TP.BGM.CHORDS.map(c => c.name), ['C', 'G', 'Am', 'F']);
  const want = { C: [0, 4, 7], G: [2, 7, 11], Am: [0, 4, 9], F: [0, 5, 9] };
  TP.BGM.CHORDS.forEach(c => assert.deepStrictEqual(c.f.map(chroma).sort((a, b) => a - b), want[c.name], c.name));
});
test('C20 和音は triangle 波で、1コード4秒ごとに C→G→Am→F と切り替わる', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(17);
  const tri = m.log.osc.filter(o => o.type === 'triangle');
  const starts = [...new Set(tri.map(o => o.t0.toFixed(3)))].map(Number).sort((a, b) => a - b);
  assert(starts.length >= 4, '4コード以上: ' + starts.length);
  for (let i = 1; i < starts.length; i++) assert(Math.abs(starts[i] - starts[i - 1] - 4) < 1e-6, '間隔 ' + (starts[i] - starts[i - 1]));
  const names = starts.slice(0, 4).map(t0 => { const fs = tri.filter(o => Math.abs(o.t0 - t0) < 1e-3).map(o => o.frequency.value).sort((a, b) => a - b); return TP.BGM.CHORDS.find(c => c.f.every((f, i) => Math.abs(c.f.slice().sort((a, b) => a - b)[i] - fs[i]) < 1e-6)).name; });
  assert.deepStrictEqual(names, ['C', 'G', 'Am', 'F']);
  assert.strictEqual(tri.length % 3, 0);
});
test('C21 和音はクロスフェード：次のコードの立ち上がりが前のコードの減衰と重なる', () => {
  assert(TP.BGM.XFADE > 0 && TP.BGM.XFADE < TP.BGM.CHORD_SEC);
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(6);
  const gs = m.log.gains.slice(1, 4); const last = c => c[c.length - 1];
  assert.strictEqual(last(gs[0].gain.calls)[0], 'lin'); assert.strictEqual(last(gs[0].gain.calls)[1], 0);
  assert(last(gs[0].gain.calls)[2] > TP.BGM.CHORD_SEC, '次のコードが始まる(4秒)より後まで鳴る');
});
test('C22 メロディは C ペンタトニック（C D E G A）の音のみ', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(120);
  const mel = m.log.osc.filter(o => o.type === 'sine'); assert(mel.length > 10);
  mel.forEach(o => assert(TP.BGM.PENTA.some(f => Math.abs(f - o.frequency.value) < 1e-6), 'f=' + o.frequency.value));
  assert.deepStrictEqual([...new Set(TP.BGM.PENTA.map(chroma))].sort((a, b) => a - b), [0, 2, 4, 7, 9]);
  assert(new Set(mel.map(o => o.frequency.value)).size >= 4, '複数の音から選ばれる');
});
test('C23 メロディは「点描」：毎拍は鳴らさず、連続拍なし・密度は半分未満', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(200);
  const mel = m.log.osc.filter(o => o.type === 'sine'); const beats = new Set(mel.map(o => Math.round((o.t0 - 0.1) / 0.5)));
  const total = Math.round(200 / 0.5); assert(mel.length > 0 && mel.length < total * 0.5, mel.length + '/' + total);
  mel.forEach(o => assert(!beats.has(Math.round((o.t0 - 0.1) / 0.5) + 1), '連続拍'));
});
test('C24 乱数が常に最小値(0)でも「毎拍鳴る」にならない', () => {
  const m = makeEnv(); m.env.rnd = () => 0; const b = TP.createBgm(m.env); b.start(); m.advance(40);
  assert(m.log.osc.filter(o => o.type === 'sine').length <= 40 / 0.5 / 2 + 1);
});
test('C25 一時停止中はノートを新規スケジュールしない', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(3); b.pause(); const n = m.log.osc.length; m.advance(10); assert.strictEqual(m.log.osc.length, n);
});
test('C26 再開後は途切れず先へ進む（pause→resume 後にもノートが増える）', () => {
  const m = makeEnv(); const b = TP.createBgm(m.env); b.start(); m.advance(3); b.pause(); b.resume(); const n = m.log.osc.length; m.advance(10); assert(m.log.osc.length > n);
});

// ===================== D. 祝福（純ロジック） =====================
const solveR = (e, mutate) => { const s = TP.emptySave(); const R = TP.solve(s, e, TP.parse(e.example)); R.kind = 'solve'; return Object.assign(R, mutate || {}); };
test('D01 全解制覇（新解法で全通りに到達）でのみ stamp=true', () => {
  const full = solveR(single); assert.strictEqual(full.foundCount, full.nSolutions); assert.strictEqual(TP.celebrationFor(full).stamp, true);
  const part = solveR(multi); assert(part.foundCount < part.nSolutions); assert.strictEqual(TP.celebrationFor(part).stamp, false);
  assert.strictEqual(TP.celebrationFor(solveR(single, { isNew: false })).stamp, false, '発見済みの再クリアでは押さない');
});
test('D02 通常クリアは glow、declare は glow なし', () => {
  assert.strictEqual(TP.celebrationFor(solveR(single)).glow, true);
  assert.strictEqual(TP.celebrationFor({ kind: 'declare', success: true }).glow, false);
});
test('D03 宣言成功のみ declareStamp。失敗・solve では出ない', () => {
  assert.strictEqual(TP.celebrationFor({ kind: 'declare', success: true }).declareStamp, true);
  assert.strictEqual(TP.celebrationFor({ kind: 'declare', success: false }).declareStamp, false);
  assert.strictEqual(TP.celebrationFor(solveR(single)).declareStamp, false);
});
test('D04 新解法のときだけ newBounce', () => { assert.strictEqual(TP.celebrationFor(solveR(single)).newBounce, true); assert.strictEqual(TP.celebrationFor(solveR(single, { isNew: false })).newBounce, false); });
test('D05 褒め言葉の出し分け：金枠 > 全部ちがう演算 > 分数経由 > 新解法', () => {
  const base = { kind: 'solve', gold: 0, fraction: false, distinctOps: false, isNew: false, foundCount: 1, nSolutions: 5 };
  assert.strictEqual(TP.praiseFor(Object.assign({}, base, { gold: 120, fraction: true, distinctOps: true, isNew: true })), '金枠の組を攻略した！');
  assert.strictEqual(TP.praiseFor(Object.assign({}, base, { fraction: true, distinctOps: true, isNew: true })), '3つとも違う演算！');
  assert.strictEqual(TP.praiseFor(Object.assign({}, base, { fraction: true, isNew: true })), '分数をくぐり抜けた！');
  assert.strictEqual(TP.praiseFor(Object.assign({}, base, { isNew: true })), '新しい解法を見つけた！');
});
test('D06 当たりなしの通常クリアは固定パターンからランダム（全パターンが出る・範囲外なし）', () => {
  const base = { kind: 'solve', gold: 0, fraction: false, distinctOps: false, isNew: false };
  const seen = new Set(), rr = seeded(12345); for (let i = 0; i < 400; i++) seen.add(TP.praiseFor(base, rr));
  assert.deepStrictEqual([...seen].sort(), TP.PRAISE.plain.slice().sort()); assert(TP.PRAISE.plain.indexOf('きれいに10になった！') >= 0);
  assert.strictEqual(TP.praiseFor(base, () => 0.9999999), TP.PRAISE.plain[TP.PRAISE.plain.length - 1]); assert.strictEqual(TP.praiseFor(base, () => 0), TP.PRAISE.plain[0]);
});
test('D07 褒め言葉は短く（20字以内）、solve 以外では空', () => {
  [TP.PRAISE.gold, TP.PRAISE.distinctOps, TP.PRAISE.fraction, TP.PRAISE.isNew].concat(TP.PRAISE.plain).forEach(t => assert(t.length <= 20, t));
  assert.strictEqual(TP.praiseFor({ kind: 'declare', success: true }), ''); assert.strictEqual(TP.praiseFor(null), '');
});
test('D08 実データ：分数必須の組は金枠の褒め言葉。全部ちがう演算の実結果も反映', () => {
  assert.strictEqual(TP.praiseFor(solveR(goldE)), '金枠の組を攻略した！');
  const dop = POOL.filter(e => e.solvable && !e.fractionRequired).map(e => solveR(e)).find(R => R.distinctOps);
  assert(dop, '全部ちがう演算になる組が見つからない'); assert.strictEqual(TP.praiseFor(dop), '3つとも違う演算！');
});
test('D09 celebrationFor / praiseFor はセーブ・結果データを変更しない（表示のみ）', () => {
  const s = TP.emptySave(); const R = TP.solve(s, single, TP.parse(single.example)); R.kind = 'solve'; const sb = JSON.stringify(s), rb = JSON.stringify(R);
  TP.celebrationFor(R); TP.praiseFor(R); assert.strictEqual(JSON.stringify(s), sb); assert.strictEqual(JSON.stringify(R), rb);
});

// ===================== E. v0.9 からの差分が範囲内（ファイル比較） =====================
test('E01 CORE：v0.9 から消えた/変わった行は 設定3関数＋公開リスト末尾 の4行のみ', () => {
  const core = h => h.match(/\/\/ ===== CORE_START =====([\s\S]*?)\/\/ ===== CORE_END =====/)[1];
  const a = core(V09.html).split('\n'), bset = new Set(core(V10OLD.html).split('\n'));
  const removed = a.filter(l => !bset.has(l)).map(l => l.trim());
  assert.deepStrictEqual(removed, [
    "function defaultSettings() { return { controlMode: 'A' }; }",
    "return { controlMode: o && o.controlMode === 'B' ? 'B' : 'A' };",
    "try { storage && storage.setItem(SETTINGS_KEY, JSON.stringify({ controlMode: st.controlMode === 'B' ? 'B' : 'A' })); return true; } catch (err) { return false; }",
    "newInputA: newInputA, clearInputA: clearInputA, aTapCard: aTapCard, aTapOp: aTapOp, aFlip: aFlip, aExpr: aExpr, aGuide: aGuide"
  ]);
});
test('E02 CORE 以外：v0.9 から消えた/変わった行は、バージョン表記・音の土台・結果画面・設定画面・handler のみ（完全一致で固定）', () => {
  const core = h => h.match(/\/\/ ===== CORE_START =====[\s\S]*?\/\/ ===== CORE_END =====/)[0];
  const strip = h => h.replace(core(h), '');
  const aa = strip(V09.html).split('\n'), bb = new Set(strip(V10OLD.html).split('\n'));
  const removed = aa.filter(l => !bb.has(l)).map(l => l.trim());
  const allowedRe = [
    /^<title>テンパズル v0\.9<\/title>$/, /actx = new C\(\)/, /^win: function/, /設定はこの端末に保存されます/, /^var R = ui\.result/,
    /id="r-expr"/, /id="r-new"/, /class="big-stamp">見極め/, /^window\.__TP_UI = \{ ui: ui,/, /^function renderSettings\(\) \{$/, /^try \{$/, /^function esc\(s\)/,
    /^\.res \.btns/, /^case 'export'/, /^function beep/
  ];
  removed.forEach(l => assert(allowedRe.some(r => r.test(l)), '想定外の変更: ' + l));
  assert(removed.length <= 16, '変更行が多すぎる: ' + removed.length);
});
test('E03 v0.9 ファイルは残っており、v0.9 のままタイトルが v0.9（index.html は公開中の v1.1）', () => { assert(/<title>テンパズル v0\.9<\/title>/.test(V09.html)); assert.strictEqual(V10.html, fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '公開中の index.html は v1.1'); });

const KNOWN_NONCORE_CHANGES = [
  '<title>テンパズル v1.0</title>',
  'titleMsg: bootMsg, titleMsgKind: bootKind, pendingImport: null };',
  'function openSet(key) {',
  'function go(screen) { ui.screen = screen; ui.modal = null; render(); }',
  `h += '<div class="btns"><button class="btn primary wide" data-act="next">次の組へ</button><button class="btn wide" data-act="again">この組をもう一度</button><button class="btn wide" data-act="zukan">図鑑へ</button></div>';`,
  `h += '<div class="btns"><button class="btn primary wide" data-act="next">次の組へ</button><button class="btn wide" data-act="zukan">図鑑へ</button></div>';`,
  "case 'ranking': openRanking(); break;",
  "case 'again': openSet(ui.key); break;",
  'function openRanking() {',
  'openRanking: openRanking, rankNameOk: rankNameOk, rankSubmitAndLoad: rankSubmitAndLoad,'
];
// ===================== G. デイリー選出（v1.1） =====================
const cp = require('child_process');
const BYP = TP.indexPool(POOL);
const allDays = (from, n) => { const out = []; let d = from; for (let i = 0; i < n; i++) { out.push(d); d = TP.addDays(d, 1); } return out; };
const tierOf = k => BYP[k].tier;
test('G01 FNV-1a 32bit：既知のテストベクトルと一致', () => {
  assert.strictEqual(TP.fnv1a32(''), 0x811c9dc5); assert.strictEqual(TP.fnv1a32('a'), 0xe40c292c); assert.strictEqual(TP.fnv1a32('foobar'), 0xbf9cf968);
  assert.strictEqual(TP.fnv1a32('2026-11-18'), TP.fnv1a32('2026-11-18')); assert.notStrictEqual(TP.fnv1a32('2026-11-18'), TP.fnv1a32('2026-11-19'));
});
test('G02 mulberry32：標準実装と一致し、同じシードなら同じ列・値は [0,1)', () => {
  function ref(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  [0, 1, 12345, 0xffffffff, TP.fnv1a32('2026-11-18')].forEach(seed => { const a = TP.mulberry32(seed), b = ref(seed), c = TP.mulberry32(seed); for (let i = 0; i < 1000; i++) { const x = a(); assert.strictEqual(x, b()); assert.strictEqual(x, c()); assert(x >= 0 && x < 1); } });
});
test('G03 JST 日付：UTC の前日 14:59:59 と 15:00:00 で日付が切り替わる', () => {
  assert.strictEqual(TP.jstDateString(Date.UTC(2026, 0, 1, 14, 59, 59, 999)), '2026-01-01');
  assert.strictEqual(TP.jstDateString(Date.UTC(2026, 0, 1, 15, 0, 0, 0)), '2026-01-02');
  assert.strictEqual(TP.jstDateString(Date.UTC(2026, 11, 31, 15, 0, 0)), '2027-01-01');
  assert.strictEqual(TP.jstDateString(Date.UTC(2028, 1, 28, 15, 0, 0)), '2028-02-29');
  assert.strictEqual(TP.jstDateString(Date.UTC(2027, 1, 28, 15, 0, 0)), '2027-03-01');
});
test('G04 JST 日付は端末のタイムゾーンに依らない（TZ を変えた別プロセスで同じ結果）', () => {
  const src = fs.readFileSync(F10, 'utf8').match(/\/\/ ===== CORE_START =====([\s\S]*?)\/\/ ===== CORE_END =====/)[1];
  const code = 'const m={exports:{}};new Function("module",' + JSON.stringify(src) + ')(m);const T=m.exports;console.log([Date.UTC(2026,5,10,14,59,59),Date.UTC(2026,5,10,15,0,0),Date.UTC(2026,5,10,0,0,0)].map(x=>T.jstDateString(x)).join(","))';
  const res = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'].map(tz => cp.spawnSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' }).stdout.trim());
  res.forEach(r => assert.strictEqual(r, '2026-06-10,2026-06-11,2026-06-10'));
});
test('G05 同じ日付なら何度呼んでも同じ3組。別に読み込んだ実装でも同じ', () => {
  const a = TP.dailySets(POOL, '2026-11-18'); for (let i = 0; i < 20; i++) assert.deepStrictEqual(TP.dailySets(POOL, '2026-11-18'), a);
  const other = loadHtml(F10); assert.deepStrictEqual(other.TP.dailySets(other.pool, '2026-11-18'), a); assert.strictEqual(a.length, 3);
});
test('G06 呼び出しの順序に依らない（いきなり遠い日を聞いても、毎日順に聞いても同じ）', () => {
  const x = loadHtml(F10), y = loadHtml(F10);
  assert.deepStrictEqual(x.TP.dailySets(x.pool, '2027-06-01'), (() => { let r; allDays('2026-01-01', 517).forEach(d => { r = y.TP.dailySets(y.pool, d); }); return r; })());
});
test('G07 日付が変われば3組も変わる（連続30日で同一にならない・365日でほぼ全部ちがう）', () => {
  const days = allDays('2027-01-01', 365); const sets = days.map(d => TP.dailySets(POOL, d).join(','));
  for (let i = 1; i < sets.length; i++) assert.notStrictEqual(sets[i], sets[i - 1]);
  assert(new Set(sets).size >= 360, String(new Set(sets).size));
});
test('G08 365日分：枠1＝入門/初級・枠2＝中級・枠3＝上級/達人/作れない、重複なし、前日と1組も被らない', () => {
  const days = allDays('2027-01-01', 365); let prev = TP.dailySets(POOL, TP.addDays('2027-01-01', -1));
  days.forEach(d => {
    const s = TP.dailySets(POOL, d); assert.strictEqual(s.length, 3, d);
    assert(['入門', '初級'].indexOf(tierOf(s[0])) >= 0, d + ' 枠1 ' + tierOf(s[0]));
    assert.strictEqual(tierOf(s[1]), '中級', d); assert(['上級', '達人', '作れない'].indexOf(tierOf(s[2])) >= 0, d + ' 枠3');
    assert.strictEqual(new Set(s).size, 3, d + ' 重複'); s.forEach(k => assert(BYP[k], '存在しない組'));
    s.forEach(k => assert(prev.indexOf(k) < 0, d + ' が前日と被る: ' + k)); prev = s;
  });
});
test('G09 起点（2026-01-01）をまたぐ・起点より前の日付でも3組が出る。年末年始も前日除外が効く', () => {
  const days = allDays('2025-12-20', 40); let prev = null;
  days.forEach(d => { const s = TP.dailySets(POOL, d); assert.strictEqual(new Set(s).size, 3); if (prev && d >= '2026-01-02') s.forEach(k => assert(prev.indexOf(k) < 0, d)); prev = s; });
  const days2 = allDays('2026-12-25', 20); prev = null; days2.forEach(d => { const s = TP.dailySets(POOL, d); if (prev) s.forEach(k => assert(prev.indexOf(k) < 0, d)); prev = s; });
});
test('G10 作れない組は週あたり概ね 1.5〜2.5 回（365日・10年の平均、各週も極端でない）', () => {
  const days = allDays('2027-01-01', 364); let un = 0; const weekly = [];
  days.forEach((d, i) => { const u = tierOf(TP.dailySets(POOL, d)[2]) === '作れない' ? 1 : 0; un += u; if (i % 7 === 0) weekly.push(0); weekly[weekly.length - 1] += u; });
  const perWeek = un / 52; assert(perWeek >= 1.5 && perWeek <= 2.5, 'perWeek=' + perWeek);
  assert(weekly.every(w => w <= 6), JSON.stringify(weekly)); assert(weekly.some(w => w === 0 || w === 1) && weekly.some(w => w >= 3), '週ごとにばらつく');
  const d10 = allDays('2027-01-01', 3650); const un10 = d10.filter(d => tierOf(TP.dailySets(POOL, d)[2]) === '作れない').length; const pw10 = un10 / 3650 * 7; assert(pw10 > 1.9 && pw10 < 2.3, 'pw10=' + pw10);
});
test('G11 枠3の内訳が 上級45%・達人25%・作れない30% に近い（10年分）', () => {
  const cnt = { 上級: 0, 達人: 0, 作れない: 0 }; allDays('2027-01-01', 3650).forEach(d => { cnt[tierOf(TP.dailySets(POOL, d)[2])]++; });
  assert(Math.abs(cnt['上級'] / 3650 - 0.45) < 0.03, JSON.stringify(cnt)); assert(Math.abs(cnt['達人'] / 3650 - 0.25) < 0.03); assert(Math.abs(cnt['作れない'] / 3650 - 0.30) < 0.03);
  assert.deepStrictEqual(TP.DAILY_SLOTS[2].choice.map(c => c.w), [45, 25, 30]); assert.deepStrictEqual(TP.DAILY_SLOTS[2].choice.map(c => c.tiers[0]), ['上級', '達人', '作れない']);
});
test('G12 JST 境界：UTCで前日15:00（＝JST当日0:00）をまたぐと別の日の3組になる', () => {
  const before = TP.jstDateString(Date.UTC(2026, 5, 10, 14, 59, 59)), after = TP.jstDateString(Date.UTC(2026, 5, 10, 15, 0, 0));
  assert.strictEqual(before, '2026-06-10'); assert.strictEqual(after, '2026-06-11');
  const a = TP.dailySets(POOL, before), b = TP.dailySets(POOL, after);
  assert.deepStrictEqual(a, TP.dailySets(POOL, '2026-06-10')); assert.deepStrictEqual(b, TP.dailySets(POOL, '2026-06-11')); assert.notDeepStrictEqual(a, b);
  b.forEach(k => assert(a.indexOf(k) < 0));
});
test('G13 不正な日付は null。遠い未来でも固まらず3組が出る', () => {
  ['', '2026-1-1', '2026-02-30', '2026-13-01', '20260101', null, undefined, 5].forEach(d => assert.strictEqual(TP.dailySets(POOL, d), null, String(d)));
  const t0 = Date.now(); assert.strictEqual(TP.dailySets(POOL, '9999-12-31').length, 3); assert(Date.now() - t0 < 3000);
});
test('G14 汎用の drawSets（将来の対戦用）：シードが同じなら同じ・除外を守る・日付に依らない', () => {
  const slots = [{ tiers: ['入門'] }, { tiers: ['中級', '上級'] }, { tiers: ['達人'] }];
  const a = TP.drawSets(POOL, 'room-42', slots, []); assert.deepStrictEqual(TP.drawSets(POOL, 'room-42', slots, []), a);
  assert.notDeepStrictEqual(TP.drawSets(POOL, 'room-43', slots, []), a);
  assert.deepStrictEqual(a.map(tierOf).map((t, i) => i === 1 ? ['中級', '上級'].indexOf(t) >= 0 : t === (i === 0 ? '入門' : '達人')), [true, true, true]);
  const b = TP.drawSets(POOL, 'room-42', slots, a); a.forEach(k => assert(b.indexOf(k) < 0)); assert.strictEqual(new Set(b).size, 3);
});
test('G15 選出は問題プールの順序に依らない（キー順で正規化）', () => {
  const shuffled = POOL.slice().reverse(); allDays('2026-03-01', 30).forEach(d => assert.deepStrictEqual(TP.drawSets(shuffled, d, TP.DAILY_SLOTS, []), TP.drawSets(POOL, d, TP.DAILY_SLOTS, [])));
});

// ===================== H. デイリーの記録・得点 =====================
const D0 = '2026-11-18'; const dkeys = TP.dailySets(POOL, D0); const dE = dkeys.map(k => BYP[k]);
const solveFor = (save, e) => { const R = TP.solve(save, e, TP.parse(e.example)); R.kind = 'solve'; return R; };
test('H01 空の記録・保存なし・壊れた保存は空として読む', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(TP.loadDaily(memStore()))), { v: 1, days: {} });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(TP.loadDaily(null))), { v: 1, days: {} });
  ['{broken', 'null', '[]', '{"v":2,"days":{}}', '{"v":1,"days":[]}', '"x"'].forEach(x => assert.deepStrictEqual(JSON.parse(JSON.stringify(TP.loadDaily(memStore({ tenpuzzle_daily_v1: x })))), { v: 1, days: {} }, x));
});
test('H02 保存→読み込みの往復（別キー tenpuzzle_daily_v1）', () => {
  const st = memStore(); const d = TP.emptyDaily(); const s = TP.emptySave();
  const sol = dE.filter(e => e.solvable); sol.forEach(e => assert.strictEqual(TP.dailyApply(d, D0, dkeys, solveFor(s, e)), true));
  assert.strictEqual(TP.writeDaily(st, d), true); assert(st._d.tenpuzzle_daily_v1); assert.strictEqual(TP.DAILY_KEY, 'tenpuzzle_daily_v1'); assert.notStrictEqual(TP.DAILY_KEY, TP.SAVE_KEY);
  const back = TP.loadDaily(st); assert.deepStrictEqual(TP.dailySummary(back, D0, dkeys), TP.dailySummary(d, D0, dkeys));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(d)));
});
test('H03 初回クリア点だけが合計される（再挑戦で加算しない・後からより高い点でも変えない）', () => {
  const d = TP.emptyDaily(), s = TP.emptySave(); const e = dE.find(x => x.solvable); const k = TP.keyOf(e.digits);
  const R1 = solveFor(s, e); assert.strictEqual(TP.dailyApply(d, D0, dkeys, R1), true);
  const first = TP.dailySummary(d, D0, dkeys).score; assert.strictEqual(first, R1.attempt);
  const R2 = solveFor(s, e); assert.strictEqual(TP.dailyApply(d, D0, dkeys, R2), false); assert.strictEqual(TP.dailySummary(d, D0, dkeys).score, first);
  const R3 = Object.assign({}, R2, { attempt: 300 }); assert.strictEqual(TP.dailyApply(d, D0, dkeys, R3), false); assert.strictEqual(TP.dailySummary(d, D0, dkeys).score, first);
  assert.strictEqual(TP.dailySummary(d, D0, dkeys).items.find(i => i.key === k).pts, R1.attempt);
});
test('H04 3組すべて終わると完了。合計＝各組の初回点の和（≤1095）。本体セーブには通常どおり記録される', () => {
  const d = TP.emptyDaily(), s = TP.emptySave(); let sum = 0;
  dE.forEach(e => { let R; if (e.solvable) R = solveFor(s, e); else { R = TP.declare(s, e); R.kind = 'declare'; } assert.strictEqual(TP.dailyApply(d, D0, dkeys, R), true); sum += e.solvable ? R.attempt : R.points; });
  const sm = TP.dailySummary(d, D0, dkeys); assert.strictEqual(sm.complete, true); assert.strictEqual(sm.done, 3); assert.strictEqual(sm.score, sum); assert(sm.score <= TP.DAILY_SCORE_MAX);
  dkeys.forEach(k => assert(TP.isResolved(TP.peekRec(s, k)), '本体セーブにも記録'));
  assert.strictEqual(s.total > 0, true);
});
test('H05 見極め成功の点（宣言50／ヒント使用25）が記録され、見極め失敗は記録されない', () => {
  const d = TP.emptyDaily(); const un = POOL.find(e => !e.solvable), key = TP.keyOf(un.digits), keys = [key, 'x'];
  const s = TP.emptySave(); const Rf = TP.declare(s, single); Rf.kind = 'declare'; assert.strictEqual(TP.dailyApply(d, D0, [TP.keyOf(single.digits)], Rf), false);
  const R = TP.declare(s, un); R.kind = 'declare'; assert.strictEqual(TP.dailyApply(d, D0, [key], R), true);
  assert.deepStrictEqual(TP.dailySummary(d, D0, [key]).items[0], { key, status: 'declare', pts: 50 });
  const d2 = TP.emptyDaily(), s2 = TP.emptySave(); TP.rec(s2, key).hintsUsed = 1; const R2 = TP.declare(s2, un); R2.kind = 'declare'; TP.dailyApply(d2, D0, [key], R2); assert.strictEqual(TP.dailySummary(d2, D0, [key]).items[0].pts, 25);
});
test('H06 失敗のあとのクリアは数える（失敗は「最初のクリア」ではない）', () => {
  const d = TP.emptyDaily(), s = TP.emptySave(); const k = TP.keyOf(single.digits);
  const Rf = TP.declare(s, single); Rf.kind = 'declare'; TP.dailyApply(d, D0, [k], Rf); assert.strictEqual(TP.dailySummary(d, D0, [k]).done, 0);
  assert.strictEqual(TP.dailyApply(d, D0, [k], solveFor(s, single)), true); assert.strictEqual(TP.dailySummary(d, D0, [k]).done, 1);
});
test('H07 その日の3組以外・不正な日付は記録しない。日ごとに独立', () => {
  const d = TP.emptyDaily(), s = TP.emptySave(); const R = solveFor(s, single);
  assert.strictEqual(TP.dailyApply(d, D0, ['0000'], R), false); assert.strictEqual(TP.dailyApply(d, 'bad', [R.key], R), false); assert.strictEqual(TP.dailyApply(d, D0, null, R), false); assert.strictEqual(TP.dailyApply(null, D0, [R.key], R), false);
  assert.strictEqual(TP.dailyApply(d, D0, [R.key], R), true); assert.strictEqual(TP.dailyApply(d, '2026-11-19', [R.key], R), true);
  assert.strictEqual(TP.dailySummary(d, D0, [R.key]).done, 1); assert.strictEqual(TP.dailySummary(d, '2026-11-20', [R.key]).done, 0);
});
test('H08 不正な記録（点の範囲外・状態・キー・日付）は読み込み時に捨てる', () => {
  const bad = { v: 1, days: { '2026-11-18': { '1114': { s: 'clear', p: 195 }, '1115': { s: 'clear', p: 366 }, '1116': { s: 'clear', p: -1 }, '1117': { s: 'win', p: 10 }, 'abc': { s: 'clear', p: 5 }, '1118': { s: 'clear', p: 1.5 }, '1119': null }, '2026-02-30': { '1114': { s: 'clear', p: 1 } }, 'oops': {} } };
  const d = TP.loadDaily(memStore({ tenpuzzle_daily_v1: JSON.stringify(bad) })); assert.deepStrictEqual(JSON.parse(JSON.stringify(d)), { v: 1, days: { '2026-11-18': { '1114': { s: 'clear', p: 195 } } } });
});
test('H09 デイリー記録はセーブ書き出しに含まれず、セーブ本体も変えない', () => {
  const s = TP.emptySave(); const d = TP.emptyDaily(); TP.dailyApply(d, D0, [single ? TP.keyOf(single.digits) : ''], solveFor(s, single));
  const before = JSON.stringify(s); TP.dailySummary(d, D0, []); assert.strictEqual(JSON.stringify(s), before);
  const txt = TP.exportSave(s); assert(!/daily|dscore|days/.test(txt)); assert(!('daily' in s));
  const r = TP.parseImport(txt, POOL, null); assert(r.ok === true || r.save);
});
test('H10 1組の上限：全ての解ける組で今回の得点 ≤ 365、宣言 ≤ 50。3組で 1095', () => {
  assert.strictEqual(TP.DAILY_PT_MAX, 365); assert.strictEqual(TP.DAILY_SCORE_MAX, 1095); assert.strictEqual(TP.DAILY_PT_MAX * 3, TP.DAILY_SCORE_MAX);
  POOL.filter(e => e.solvable).forEach(e => assert(solveFor(TP.emptySave(), e).attempt <= 365, e.digits.join('')));
});
test('H11 理論最大スコア 65,370 は無変更（最大核点の和＋新解法15×解法数＋宣言50×作れない組）', () => {
  const mc = JSON.parse(V10.html.match(/id="maxcore-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const sum = Object.keys(mc).reduce((a, k) => a + mc[k], 0) + 15 * POOL.reduce((a, e) => a + e.nSolutionsNorm, 0) + 50 * POOL.filter(e => !e.solvable).length;
  assert.strictEqual(sum, 65370); assert(/SCORE_MAX: 65370/.test(fs.readFileSync(path.join(root, 'ranking-tenpuzzle-apps-script-v11.gs'), 'utf8')));
});
test('H12 デイリーランキング送信は3組すべて終わった後だけ（未完了は null）', () => {
  const d = TP.emptyDaily(), s = TP.emptySave(); const done = [];
  dE.forEach((e, i) => { assert.strictEqual(TP.dailyRankingParams(d, D0, dkeys, 'ゆうた'), null, i + '組終了時'); let R; if (e.solvable) R = solveFor(s, e); else { R = TP.declare(s, e); R.kind = 'declare'; } TP.dailyApply(d, D0, dkeys, R); });
  const p = TP.dailyRankingParams(d, D0, dkeys, ' ゆうた '); assert.deepStrictEqual(p, { board: 'daily', date: D0, dscore: TP.dailySummary(d, D0, dkeys).score, name: 'ゆうた' });
  assert.strictEqual(TP.dailyRankingParams(d, D0, dkeys, ''), null); assert.strictEqual(TP.dailyRankingParams(d, D0, dkeys, '   '), null);
  assert.strictEqual(TP.encodeDailyParams(p), 'board=daily&date=' + D0 + '&dscore=' + p.dscore + '&name=' + encodeURIComponent('ゆうた'));
});
test('H13 GET URL：board=daily&date、既存のクエリがあれば & でつなぐ', () => {
  assert.strictEqual(TP.dailyGetUrl('https://x/exec', D0, 5), 'https://x/exec?board=daily&date=' + D0 + '&t=5');
  assert.strictEqual(TP.dailyGetUrl('https://x/exec?a=1', D0), 'https://x/exec?a=1&board=daily&date=' + D0);
});
test('H14 一覧の整形：不正行を除き、同名は更新が新しい行、スコア降順・同点は名前順', () => {
  const rows = TP.cleanDailyRows([{ name: 'b', dscore: 100, updated: '2026-11-18T01:00:00Z' }, { name: 'a', dscore: 100, updated: 'x' }, { name: 'b', dscore: 120, updated: '2026-11-18T02:00:00Z' }, { name: '', dscore: 5 }, { name: 'c', dscore: 1096 }, { name: 'd', dscore: -1 }, { name: 'e', dscore: 'zz' }, null, 3]);
  assert.deepStrictEqual(TP.sortDailyRows(rows).map(r => r.name + ':' + r.dscore), ['b:120', 'a:100']);
  assert.strictEqual(TP.cleanDailyRows({}), null);
});
test('H15 保存先が使えなくても例外にならない', () => { assert.strictEqual(TP.writeDaily({ setItem() { throw new Error('quota'); } }, TP.emptyDaily()), false); assert.strictEqual(TP.writeDaily(null, TP.emptyDaily()), false); });

// ===================== I. .gs（SpreadsheetApp 等のスタブ） =====================
const vm = require('vm');
const GS_OLD = fs.readFileSync(path.join(root, 'ranking-tenpuzzle-apps-script.gs'), 'utf8');
const GS_NEW = fs.readFileSync(path.join(root, 'ranking-tenpuzzle-apps-script-v11.gs'), 'utf8');
const GAS_STUB = `
var __NOW = 1700000000000; var __RealDate = Date;
Date = class extends __RealDate { constructor() { if (arguments.length === 0) super(__NOW); else super(...arguments); } static now() { return __NOW; } };
function __Sheet(name) { this.name = name; this.cells = {}; this.fmt = {}; this.maxRow = 0; this.maxCol = 0; }
__Sheet.prototype.getRange = function (r, c, nr, nc) { var sh = this; nr = nr || 1; nc = nc || 1; return {
  setNumberFormat: function (f) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) sh.fmt[(r + i) + ',' + (c + j)] = f; return this; },
  setValues: function (a) { for (var i = 0; i < nr; i++) for (var j = 0; j < nc; j++) { var k = (r + i) + ',' + (c + j), v = a[i][j];
      if (typeof v === 'string' && sh.fmt[k] !== '@') { if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) v = new Date(v + 'T00:00:00Z'); else if (/^=/.test(v)) v = '#FORMULA:' + v; else if (/^-?\\d+(\\.\\d+)?$/.test(v)) v = Number(v); }
      sh.cells[k] = v; sh.maxRow = Math.max(sh.maxRow, r + i); sh.maxCol = Math.max(sh.maxCol, c + j); } return this; },
  getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = sh.cells[(r + i) + ',' + (c + j)]; row.push(v === undefined ? '' : v); } out.push(row); } return out; } }; };
__Sheet.prototype.getLastRow = function () { return this.maxRow; };
__Sheet.prototype.getDataRange = function () { var sh = this; return { getValues: function () { return sh.maxRow ? sh.getRange(1, 1, sh.maxRow, sh.maxCol).getValues() : []; } }; };
var __ss = { sheets: [new __Sheet('Sheet1')], getSheets: function () { return this.sheets; },
  getSheetByName: function (n) { for (var i = 0; i < this.sheets.length; i++) if (this.sheets[i].name === n) return this.sheets[i]; return null; },
  insertSheet: function (n) { var s = new __Sheet(n); this.sheets.push(s); return s; } };
var SpreadsheetApp = { getActiveSpreadsheet: function () { return __ss; } };
var __lockFail = false;
var LockService = { getScriptLock: function () { return { waitLock: function () { if (__lockFail) throw new Error('timeout'); }, releaseLock: function () {} }; } };
var ContentService = { MimeType: { JSON: 'json' }, createTextOutput: function (s) { return { s: s, setMimeType: function () { return this; } }; } };
var Utilities = { formatDate: function (d, tz, f) { var t = new __RealDate(d.getTime() + 9 * 3600000); return t.toISOString().slice(0, 10); } };
`;
function loadGas(src) {
  const ctx = vm.createContext({}); vm.runInContext(GAS_STUB + src, ctx);
  const api = {
    ctx,
    get: p => JSON.parse(vm.runInContext('doGet', ctx)({ parameter: p }).s),
    post: p => JSON.parse(vm.runInContext('doPost', ctx)({ parameter: p }).s),
    getBare: () => JSON.parse(vm.runInContext('doGet', ctx)().s),
    setNow: ms => vm.runInContext('__NOW=' + ms, ctx), lockFail: b => vm.runInContext('__lockFail=' + b, ctx),
    sheets: () => vm.runInContext('__ss.sheets.map(function(s){return {name:s.name,max:s.maxRow,cells:s.cells,fmt:s.fmt}})', ctx),
    sheet: i => JSON.parse(JSON.stringify(vm.runInContext('__ss.sheets[' + i + ']', ctx).cells)),
    putRaw: (i, r, c, v) => vm.runInContext('(function(){var s=__ss.sheets[' + i + '];s.cells["' + r + ',' + c + '"]=' + v + ';s.maxRow=Math.max(s.maxRow,' + r + ');s.maxCol=Math.max(s.maxCol,' + c + ');})()', ctx)
  };
  return api;
}
const dpost = (g, date, name, dscore) => g.post({ board: 'daily', date, name, dscore });
test('I01 .gs に論理代入演算子（??= ||= &&=）がなく、構文として読める', () => {
  const code = GS_NEW.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); assert(!/\?\?=|\|\|=|&&=/.test(code)); new vm.Script(GS_NEW);
});
test('I02 従来の累計：検証ロジック・上限・名前処理の関数が v0.9 版と一字一句同じ', () => {
  const grab = (src, re) => { const m = src.match(re); assert(m, String(re)); return m[0]; };
  ['var LIMITS = [^\\n]*', 'var HEADER = [^\\n]*', 'function headerOffset\\(values\\) \\{[\\s\\S]*?\\n\\}', 'function encodeName\\(name\\) \\{[\\s\\S]*?\\n\\}', 'function decodeName\\(v\\) \\{[\\s\\S]*?\\n\\}',
    'function cleanName\\(raw\\) \\{[\\s\\S]*?\\n\\}', 'function parseCount\\(raw\\) \\{[\\s\\S]*?\\n\\}', 'function validateEntry\\(p\\) \\{[\\s\\S]*?\\n\\}', 'function jsonOut\\(obj\\) \\{[\\s\\S]*?\\n\\}'].forEach(r => assert.strictEqual(grab(GS_NEW, new RegExp(r)), grab(GS_OLD, new RegExp(r)), r));
  const body = (src, name) => grab(src, new RegExp('function ' + name + '\\([a-z]*\\) \\{[\\s\\S]*?\\n\\}')).replace(/^function \w+/, 'function F');
  assert.strictEqual(body(GS_NEW, 'doGetTotal'), body(GS_OLD, 'doGet')); assert.strictEqual(body(GS_NEW, 'doPostTotal'), body(GS_OLD, 'doPost'));
});
test('I03 従来の累計 POST/GET：同じ操作列で v0.9 版と応答・1枚目のシートの中身が完全に一致（differential）', () => {
  const ops = [
    ['get'], ['post', { name: 'ゆうた', solved: '10', solutions: '12', score: '500' }], ['post', { name: 'ゆうた', solved: '11', solutions: '13', score: '600' }],
    ['post', { name: '=HYPERLINK("x")', solved: '1', solutions: '1', score: '10' }], ['post', { name: '@a', solved: '1', solutions: '1', score: '10' }], ['post', { name: '+1', solved: '1', solutions: '1', score: '10' }], ['post', { name: '-2', solved: '1', solutions: '1', score: '10' }], ['post', { name: '123', solved: '2', solutions: '2', score: '20' }],
    ['post', { name: '=HYPERLINK("x")', solved: '2', solutions: '2', score: '25' }],
    ['post', { name: 'a', solved: '496', solutions: '1', score: '1' }], ['post', { name: 'a', solved: '1', solutions: '1614', score: '1' }], ['post', { name: 'a', solved: '1', solutions: '1', score: '65371' }], ['post', { name: 'a', solved: '1', solutions: '1', score: '366' }],
    ['post', { name: 'a', solved: '1.5', solutions: '1', score: '1' }], ['post', { name: 'a', solved: '-1', solutions: '1', score: '1' }], ['post', { name: 'a', solved: '', solutions: '1', score: '1' }], ['post', { name: '', solved: '1', solutions: '1', score: '1' }], ['post', { name: '12345678901', solved: '1', solutions: '1', score: '1' }],
    ['post', { name: '１２３', solved: '1', solutions: '1', score: '1' }], ['post', { name: ' x\u0007y ', solved: '1', solutions: '1', score: '15' }], ['post', {}], ['post', undefined],
    ['post', { name: 'max', solved: '495', solutions: '1613', score: '65370' }], ['get'], ['getParam', { t: '123' }], ['lock'], ['post', { name: 'late', solved: '1', solutions: '1', score: '1' }], ['unlock'], ['get']
  ];
  const run = (src, withHeader) => {
    const g = loadGas(src); if (withHeader) { g.putRaw(0, 1, 1, '"ニックネーム"'); g.putRaw(0, 1, 2, '"解いた数"'); }
    const log = []; let t = 1700000000000;
    ops.forEach(op => { g.setNow(t += 1000); if (op[0] === 'get') log.push(g.getBare()); else if (op[0] === 'getParam') log.push(g.get(op[1])); else if (op[0] === 'post') log.push(vm.runInContext('doPost', g.ctx)(op[1] === undefined ? undefined : { parameter: op[1] }).s); else if (op[0] === 'lock') g.lockFail(true); else g.lockFail(false); });
    return { log, sheet1: g.sheet(0), sheetCount: g.sheets().length };
  };
  [false, true].forEach(h => { const a = run(GS_OLD, h), b = run(GS_NEW, h); assert.deepStrictEqual(b.log, a.log); assert.deepStrictEqual(b.sheet1, a.sheet1); assert.strictEqual(b.sheetCount, 1, '累計だけの操作では daily シートを作らない'); assert(a.log.length > 20); });
});
test('I04 累計の応答の中身も確認（成功・更新・各種拒否）', () => {
  const g = loadGas(GS_NEW);
  assert.deepStrictEqual(g.post({ name: 'ゆうた', solved: '10', solutions: '12', score: '500' }), { ok: true, updated: false });
  assert.deepStrictEqual(g.post({ name: 'ゆうた', solved: '11', solutions: '13', score: '600' }), { ok: true, updated: true });
  assert.deepStrictEqual(g.post({ name: 'x', solved: '1', solutions: '1', score: '366' }), { ok: false, error: 'score inconsistent' });
  assert.deepStrictEqual(g.post({ name: 'x', solved: '496', solutions: '1', score: '1' }), { ok: false, error: 'solved too large' });
  const rows = g.get(undefined === 1 ? 0 : {}); assert.deepStrictEqual(g.getBare().map(r => [r.name, r.solved, r.solutions, r.score]), [['ゆうた', 11, 13, 600]]); assert(Array.isArray(rows));
});
test('I05 daily POST：シート「daily」を見出し付きで作成し、(日付,名前) で書き込む。1枚目は触らない', () => {
  const g = loadGas(GS_NEW); const s1 = JSON.stringify(g.sheet(0));
  assert.deepStrictEqual(dpost(g, D0, 'ゆうた', '150'), { ok: true, updated: false });
  const sh = g.sheets(); assert.strictEqual(sh.length, 2); assert.strictEqual(sh[1].name, 'daily');
  assert.deepStrictEqual([1, 2, 3, 4].map(c => sh[1].cells['1,' + c]), ['日付', '名前', 'デイリースコア', '更新日時']);
  assert.deepStrictEqual([1, 2, 3].map(c => g.sheet(1)['2,' + c]), [D0, 'ゆうた', 150]); assert.strictEqual(typeof g.sheet(1)['2,1'], 'string', '日付はテキスト（Dateに変換されない）');
  assert.strictEqual(JSON.stringify(g.sheet(0)), s1);
});
test('I06 daily の upsert：同じ(日付,名前)は更新・行は増えない／日付違い・名前違いは別行', () => {
  const g = loadGas(GS_NEW); g.setNow(1700000001000);
  dpost(g, D0, 'a', '100'); g.setNow(1700000002000); assert.deepStrictEqual(dpost(g, D0, 'a', '200'), { ok: true, updated: true });
  assert.strictEqual(g.sheets()[1].max, 2); assert.strictEqual(g.sheet(1)['2,3'], 200); assert.notStrictEqual(g.sheet(1)['2,4'], undefined);
  dpost(g, '2026-11-19', 'a', '50'); dpost(g, D0, 'b', '70'); assert.strictEqual(g.sheets()[1].max, 4);
  assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }).map(r => [r.name, r.dscore]), [['a', 200], ['b', 70]]);
});
test('I07 daily GET：日付指定でその日の分だけ返す。他の日・まだ誰もいない日は空配列。GET ではシートを作らない', () => {
  const g = loadGas(GS_NEW); assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }), []); assert.strictEqual(g.sheets().length, 1);
  dpost(g, D0, 'a', '100'); dpost(g, '2026-11-19', 'b', '90');
  assert.deepStrictEqual(g.get({ board: 'daily', date: '2026-11-19' }).map(r => [r.name, r.dscore]), [['b', 90]]); assert.deepStrictEqual(g.get({ board: 'daily', date: '2030-01-01' }), []);
  const r = g.get({ board: 'daily', date: D0 })[0]; assert.deepStrictEqual(Object.keys(r).sort(), ['dscore', 'name', 'updated']);
  assert.deepStrictEqual(g.get({ board: 'daily', date: 'bad' }), { ok: false, error: 'bad date' });
  assert.deepStrictEqual(g.get({ board: 'daily' }), { ok: false, error: 'bad date' });
});
test('I08 daily の dscore：0以上の整数・上限1095。不正値は丸めず拒否（シートも作らない）', () => {
  const g = loadGas(GS_NEW);
  ['-1', '1.5', '1e3', 'abc', '', ' ', '1096', '99999999999', '0x10', '+5', '１２', undefined, null].forEach(v => { const r = dpost(g, D0, 'a', v); assert.strictEqual(r.ok, false, String(v)); assert(r.error); });
  assert.strictEqual(g.sheets().length, 1, '不正値ではシートを作らない');
  assert.deepStrictEqual(dpost(g, D0, 'a', '1095'), { ok: true, updated: false }); assert.deepStrictEqual(dpost(g, D0, 'b', '0'), { ok: true, updated: false }); assert.deepStrictEqual(dpost(g, D0, 'c', ' 7 '), { ok: true, updated: false });
  assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }).map(r => r.dscore), [1095, 0, 7]);
  assert.deepStrictEqual(dpost(g, D0, 'a', '1096'), { ok: false, error: 'dscore too large' }); assert.strictEqual(g.sheet(1)['2,3'], 1095, '拒否した送信で値が変わらない');
});
test('I09 daily の日付：実在する YYYY-MM-DD だけ受理', () => {
  const g = loadGas(GS_NEW); ['2026-02-30', '2026-13-01', '2026-00-10', '20260101', '2026-1-1', '', undefined, '2026-11-18T00:00', 'abc'].forEach(d => assert.deepStrictEqual(dpost(g, d, 'a', '1'), { ok: false, error: 'bad date' }, String(d)));
  assert.deepStrictEqual(dpost(g, '2028-02-29', 'a', '1'), { ok: true, updated: false }); assert.strictEqual(dpost(g, '2027-02-29', 'a', '1').ok, false);
});
test('I10 daily の名前：累計と同じ検証・無害化（先頭 = + - @ は「\'」付きで保存し、読み出し・upsert は元の名前）', () => {
  const g = loadGas(GS_NEW);
  ['=SUM(1)', '+1', '-2', '@a'].forEach((n, i) => { assert.deepStrictEqual(dpost(g, D0, n, '10'), { ok: true, updated: false }); assert.strictEqual(g.sheet(1)[(i + 2) + ',2'], "'" + n); });
  assert.deepStrictEqual(dpost(g, D0, '=SUM(1)', '20'), { ok: true, updated: true }); assert.strictEqual(g.sheets()[1].max, 5);
  assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }).map(r => r.name), ['=SUM(1)', '+1', '-2', '@a']);
  assert.deepStrictEqual(dpost(g, D0, '123', '5'), { ok: true, updated: false }); assert.strictEqual(typeof g.sheet(1)['6,2'], 'string');
  const t = loadGas(GS_NEW); ['', '   ', '12345678901', ' x\u0007y ', '\u0001', 'ゆうたゆうたゆうたゆ', 'ゆうたゆうたゆうたゆう'].forEach(n => {
    const a = dpost(t, D0, n, '1'), b = t.post({ name: n, solved: '1', solutions: '1', score: '15' }); assert.strictEqual(a.ok, b.ok, JSON.stringify(n)); if (!a.ok) assert.strictEqual(a.error, b.error); });
});
test('I11 daily の日付セルがシート側で Date になっていても一致・出力できる（保険）', () => {
  const g = loadGas(GS_NEW); dpost(g, D0, 'a', '1'); g.putRaw(1, 2, 1, 'new Date("2026-11-18T00:00:00Z")');
  assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }).map(r => r.name), ['a']); assert.deepStrictEqual(dpost(g, D0, 'a', '9'), { ok: true, updated: true }); assert.strictEqual(g.sheets()[1].max, 2);
});
test('I12 daily の見出し行は一覧に出ない。board が不正なら拒否。ロック取得失敗は busy', () => {
  const g = loadGas(GS_NEW); dpost(g, D0, 'a', '1'); assert.deepStrictEqual(g.get({ board: 'daily', date: D0 }).length, 1);
  assert.deepStrictEqual(g.post({ board: 'weekly', name: 'a', solved: '1', solutions: '1', score: '1' }), { ok: false, error: 'unknown board' }); assert.deepStrictEqual(g.get({ board: 'x' }), { ok: false, error: 'unknown board' });
  g.lockFail(true); assert.deepStrictEqual(dpost(g, D0, 'z', '1'), { ok: false, error: 'busy' }); assert.strictEqual(g.sheets()[1].max, 2);
});
test('I13 累計とデイリーは互いのシートに影響しない', () => {
  const g = loadGas(GS_NEW); g.post({ name: 'a', solved: '1', solutions: '1', score: '15' }); const s1 = JSON.stringify(g.sheet(0)); dpost(g, D0, 'a', '100'); assert.strictEqual(JSON.stringify(g.sheet(0)), s1);
  const d1 = JSON.stringify(g.sheet(1)); g.post({ name: 'b', solved: '1', solutions: '1', score: '15' }); assert.strictEqual(JSON.stringify(g.sheet(1)), d1);
  assert.deepStrictEqual(g.getBare().map(r => r.name), ['a', 'b']);
});

// ===================== K. v1.0 からの差分が範囲内 =====================
test('K01 CORE：v1.0 から消えた/変わった行は公開リスト末尾の1行のみ（他は追加だけ）', () => {
  const core = h => h.match(/\/\/ ===== CORE_START =====([\s\S]*?)\/\/ ===== CORE_END =====/)[1];
  const bset = new Set(core(V10.html).split('\n')); const removed = core(V10OLD.html).split('\n').filter(l => !bset.has(l)).map(l => l.trim());
  assert.deepStrictEqual(removed, ['PRAISE: PRAISE, praiseFor: praiseFor, celebrationFor: celebrationFor, BGM: BGM, createBgm: createBgm']);
});
test('K02 CORE 以外：v1.0 から消えた/変わった行は、タイトル・状態・title/result/ranking の配線のみ（完全一致で固定）', () => {
  const core = h => h.match(/\/\/ ===== CORE_START =====[\s\S]*?\/\/ ===== CORE_END =====/)[0];
  const strip = h => h.replace(core(h), ''); const bb = new Set(strip(V10.html).split('\n'));
  const removed = strip(V10OLD.html).split('\n').filter(l => !bb.has(l)).map(l => l.trim());
  assert.deepStrictEqual(removed, KNOWN_NONCORE_CHANGES);
});
test('K03 不変の確認：canon4・ティア・スコア・セーブ形式 v4・セーブキー・設定・RANKING_URL・pickNext・BGM/祝福は v1.0 と同じ', () => {
  const O = V10OLD.TP, N = TP;
  ['SCORE', 'BASE', 'TIERS', 'SAVE_VERSION', 'SAVE_KEY', 'SETTINGS_KEY', 'RANKING_URL', 'NEXT_MIX_RATE', 'FIRST_PLAY_TIERS', 'PRAISE', 'BGM', 'RANK_TOP', 'NAME_KEY', 'NAME_MAX'].forEach(k => assert.deepStrictEqual(N[k], O[k], k));
  assert.deepStrictEqual(POOL, V10OLD.pool); assert.deepStrictEqual(N.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"B","bgm":true}' })), O.loadSettings(memStore({ tenpuzzle_settings_v1: '{"controlMode":"B","bgm":true}' })));
  ['canon4', 'createBgm', 'praiseFor', 'celebrationFor', 'pickNext', 'pickPlay', 'solve', 'declare', 'rankingParams', 'encodeParams', 'cleanRows', 'sortRows', 'validateSave'].forEach(k => assert.strictEqual(N[k].toString(), O[k].toString(), k + ' の実装が変わっている'));
  const o = Math.random; try { Math.random = seeded(3); const a = []; for (let i = 0; i < 100; i++) a.push(N.pickNext(POOL, TP.emptySave(), null)); Math.random = seeded(3); const b = []; for (let i = 0; i < 100; i++) b.push(O.pickNext(V10OLD.pool, O.emptySave(), null)); assert.deepStrictEqual(a, b); } finally { Math.random = o; }
});
test('K04 本体の累計スコア・解法の数え方は v1.0 と全組で一致（differential）', () => {
  POOL.filter(e => e.solvable).forEach(e => assert.deepStrictEqual(TP.solve(TP.emptySave(), e, TP.parse(e.example)), V10OLD.TP.solve(V10OLD.TP.emptySave(), e, V10OLD.TP.parse(e.example)), e.digits.join('')));
});
test('K05 累計ランキングのクライアント送信内容（POST 本文・GET URL）は従来のまま：board を付けない', () => {
  const p = TP.rankingParams(TP.emptySave(), POOL, 'ゆうた'); assert.strictEqual(TP.encodeParams(p), V10OLD.TP.encodeParams(V10OLD.TP.rankingParams(TP.emptySave(), POOL, 'ゆうた'))); assert(!/board|date|dscore/.test(TP.encodeParams(p)));
});

// ===================== F. ブラウザ（Playwright）：配線・設定画面・結果画面の描画 =====================
let pw = null; try { pw = require('playwright'); } catch (e) { /* 下で失敗として扱う */ }
const STUB = `
  window.__ctxs = [];
  class FakeCtx { constructor(){ this.currentTime=0; this.state='running'; this.destination={}; window.__ctxs.push(this); }
    createGain(){ return { gain:{ value:1, cancelScheduledValues(){}, setValueAtTime(v){this.value=v}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(v){this.value=v} }, connect(){}, disconnect(){} }; }
    createOscillator(){ return { type:'', frequency:{value:0}, connect(){}, start(){}, stop(){} }; }
    suspend(){ this.state='suspended'; return Promise.resolve(); } resume(){ this.state='running'; return Promise.resolve(); } }
  window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
`;
async function newPage(browser, settingsJson) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(STUB);
  if (settingsJson) await page.addInitScript(`try{ if(!localStorage.getItem('__init')){ localStorage.setItem('tenpuzzle_settings_v1', ${JSON.stringify(settingsJson)}); localStorage.setItem('__init','1'); } }catch(e){}`);
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + F10); await page.waitForSelector('#app');
  return { page, ctx, errs };
}
if (!pw) {
  test('F00 playwright が使えること', () => { throw new Error('playwright が見つかりません（UIテスト不可）'); });
} else {
  let browser;
  const withPage = (settingsJson, fn) => async () => { const p = await newPage(browser, settingsJson); try { await fn(p.page); assert.deepStrictEqual(p.errs, [], 'pageerror'); } finally { await p.ctx.close(); } };
  const showResult = (page, kind, which) => page.evaluate(([kind, which]) => {
    const U = window.__TP_UI, save = U.getSave();
    const e = U.POOL.find(x => which === 'single' ? (x.solvable && x.nSolutionsNorm === 1 && !x.fractionRequired) : which === 'multi' ? (x.solvable && x.nSolutionsNorm > 1 && !x.fractionRequired) : which === 'gold' ? x.fractionRequired : !x.solvable);
    let R;
    if (kind === 'solve') { R = TP.solve(save, e, TP.parse(e.example)); R.kind = 'solve'; } else { R = TP.declare(save, e); R.kind = 'declare'; }
    U.ui.key = TP.keyOf(e.digits); U.ui.result = R; U.ui.screen = 'result'; U.render(); return true;
  }, [kind, which]);
  const keyframes = (page, name) => page.evaluate(n => { let t = ''; for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.name === n) t = r.cssText; } catch (e) { /* 外部CSS */ } } return t; }, name);
  test('F01 起動：既定で bgm=false、操作しても AudioContext は作られない', withPage(null, async page => {
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.getSettings().bgm), false);
    await page.mouse.click(200, 400); assert.strictEqual(await page.evaluate(() => window.__ctxs.length), 0);
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'stopped');
  }));
  test('F02 旧形式の保存設定 {controlMode:B} → 操作方法Bのまま・bgm=false', withPage('{"controlMode":"B"}', async page => {
    assert.deepStrictEqual(await page.evaluate(() => window.__TP_UI.getSettings()), { controlMode: 'B', bgm: false });
  }));
  test('F03 設定画面にBGM行（オフ/オン）が出る。オフが選択状態。操作方法の行も残っている', withPage(null, async page => {
    await page.evaluate(() => window.__TP_UI.handle('settings'));
    assert.strictEqual(await page.locator('#s-bgm [data-act="set-bgm"]').count(), 2);
    assert.strictEqual(await page.locator('#s-bgm [data-bgm="off"].on').count(), 1);
    assert.strictEqual(await page.locator('[data-act="set-mode"]').count(), 2);
  }));
  test('F04 BGMオン：押すと即保存・その場で再生開始。オフ：停止して保存', withPage(null, async page => {
    await page.evaluate(() => window.__TP_UI.handle('settings'));
    await page.click('[data-bgm="on"]');
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'playing');
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tenpuzzle_settings_v1'))), { controlMode: 'A', bgm: true });
    assert.strictEqual(await page.locator('#s-bgm [data-bgm="on"].on').count(), 1);
    await page.click('[data-bgm="off"]');
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'stopped');
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tenpuzzle_settings_v1'))), { controlMode: 'A', bgm: false });
  }));
  test('F05 操作方法を切り替えても bgm 設定は消えない', withPage('{"controlMode":"A","bgm":true}', async page => {
    await page.evaluate(() => window.__TP_UI.handle('settings')); await page.click('[data-act="set-mode"][data-mode="B"]');
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('tenpuzzle_settings_v1'))), { controlMode: 'B', bgm: true });
  }));
  test('F06 設定オンの端末：最初のタップまで AudioContext を作らず、タップでフェードイン開始', withPage('{"controlMode":"A","bgm":true}', async page => {
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => window.__ctxs.length), 0, '操作前は未生成'); assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'stopped');
    await page.mouse.click(210, 30);
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'playing'); assert.strictEqual(await page.evaluate(() => window.__ctxs.length), 1);
  }));
  test('F07 visibilitychange：隠れたら一時停止・戻ったら再開（実ページ配線）', withPage('{"controlMode":"A","bgm":true}', async page => {
    await page.mouse.click(210, 30);
    const fire = h => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); return window.__TP_UI.bgm.state(); }, h);
    assert.strictEqual(await fire(true), 'paused'); assert.strictEqual(await page.evaluate(() => window.__ctxs[0].state), 'suspended');
    assert.strictEqual(await fire(false), 'playing'); assert.strictEqual(await page.evaluate(() => window.__ctxs[0].state), 'running');
  }));
  test('F08 クリア音（見極め成功の SFX.win）でBGMがダッキングし、戻る', withPage('{"controlMode":"A","bgm":true}', async page => {
    await page.mouse.click(210, 30);
    const r = await page.evaluate(async () => {
      const U = window.__TP_UI; const e = U.POOL.find(x => !x.solvable); U.ui.key = TP.keyOf(e.digits); U.ui.board = TP.newBoard(e.digits); U.ui.screen = 'play'; U.render();
      const base = U.bgm.targetGain(); U.handle('declare'); U.handle('modal-yes');
      const during = { d: U.bgm.isDucked(), g: U.bgm.targetGain() }; await new Promise(r => setTimeout(r, 1500));
      return { base, during, after: { d: U.bgm.isDucked(), g: U.bgm.targetGain() } };
    });
    assert.strictEqual(r.during.d, true); assert(r.during.g <= r.base / 2); assert.strictEqual(r.after.d, false); assert(Math.abs(r.after.g - r.base) < 1e-9);
  }));
  test('F09 通常クリア：金の光(.fx-glow)が #r-expr に付き 1秒以内、褒め言葉が1行出る', withPage(null, async page => {
    await showResult(page, 'solve', 'multi');
    assert.strictEqual(await page.locator('#r-expr.fx-glow').count(), 1);
    const dur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#r-expr'), '::before').animationDuration)); assert(dur > 0 && dur <= 1, 'dur=' + dur);
    assert.strictEqual(await page.locator('#r-praise').count(), 1); assert((await page.locator('#r-praise').innerText()).length > 0);
  }));
  test('F10 新解法：#r-new に弾むアニメ(scale・0.4秒)。発見済みでは付かない', withPage(null, async page => {
    await showResult(page, 'solve', 'multi');
    assert.strictEqual(await page.locator('#r-new.fx-bounce').count(), 1);
    const a = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#r-new')); return [c.animationName, parseFloat(c.animationDuration)]; });
    assert.strictEqual(a[0], 'fxbounce'); assert(Math.abs(a[1] - 0.4) < 0.05);
    assert(/scale\(/.test(await keyframes(page, 'fxbounce')));
    await showResult(page, 'solve', 'multi'); // 2回目＝同じ解法の再発見（発見済み）
    assert.strictEqual(await page.locator('#r-new.fx-bounce').count(), 0);
  }));
  test('F11 全解制覇の結果でのみ #r-gstamp（制覇スタンプ）が出る。0.5秒・大→定位置', withPage(null, async page => {
    await showResult(page, 'solve', 'multi'); assert.strictEqual(await page.locator('#r-gstamp').count(), 0, '途中の組には出ない');
    await showResult(page, 'solve', 'single'); assert.strictEqual(await page.locator('#r-gstamp.gstamp.fx-stamp').count(), 1);
    assert.strictEqual((await page.locator('#r-gstamp').innerText()).trim(), '制覇');
    const a = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#r-gstamp')); return [c.animationName, parseFloat(c.animationDuration)]; });
    assert.strictEqual(a[0], 'fxstamp'); assert(Math.abs(a[1] - 0.5) < 0.05);
    const kf = await keyframes(page, 'fxstamp'); assert(/scale\(3\)/.test(kf) && /scale\(1\)/.test(kf));
    await showResult(page, 'solve', 'single'); // 同じ組をもう一度（発見済み）→ 押さない
    assert.strictEqual(await page.locator('#r-gstamp').count(), 0);
  }));
  test('F12 見極め成功：#r-declare-stamp にスタンプアニメ。失敗には付かない', withPage(null, async page => {
    await showResult(page, 'declare', 'unsolv'); assert.strictEqual(await page.locator('#r-declare-stamp.big-stamp.fx-stamp').count(), 1);
    assert.strictEqual(await page.locator('#r-gstamp').count(), 0); assert.strictEqual(await page.locator('#r-praise').count(), 0);
    await page.evaluate(() => { const U = window.__TP_UI; U.ui.result = { kind: 'declare', success: false }; U.render(); });
    assert.strictEqual(await page.locator('.fx-stamp').count(), 0);
  }));
  test('F13 金枠の組：金枠の褒め言葉が結果画面に出る', withPage(null, async page => {
    await showResult(page, 'solve', 'gold'); assert.strictEqual((await page.locator('#r-praise').innerText()).trim(), '金枠の組を攻略した！');
  }));
  test('F14 演出はブロックしない：演出中でもボタンが即クリックでき、次の画面へ進める', withPage(null, async page => {
    await showResult(page, 'solve', 'single');
    const ok = await page.evaluate(() => { const b = document.querySelector('[data-act="next"]'), r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return b === top || b.contains(top); });
    assert.strictEqual(ok, true);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#r-expr'), '::before').pointerEvents), 'none');
    await page.click('[data-act="next"]', { timeout: 1000 }); assert.strictEqual(await page.evaluate(() => window.__TP_UI.ui.screen), 'play');
  }));
  test('F15 prefers-reduced-motion では演出アニメを止める定義がある', () => { assert(/prefers-reduced-motion: reduce\)\{[^}]*animation:none/.test(V10.html)); });
  test('F16 ダークモードでも結果画面が描画できる', async () => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 420, height: 800 } }); const page = await ctx.newPage(); await page.addInitScript(STUB);
    const errs = []; page.on('pageerror', e => errs.push(String(e))); await page.goto('file://' + F10); await showResult(page, 'solve', 'single');
    assert.strictEqual(await page.locator('#r-gstamp').count(), 1); assert.deepStrictEqual(errs, []); await ctx.close();
  });
  test('F17 タイトルが v1.1', () => { assert(/<title>テンパズル v1\.1<\/title>/.test(V10.html)); });
  test('F18 AudioContext 非対応端末でもBGMを押して例外にならない', async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } }); const page = await ctx.newPage();
    await page.addInitScript('window.AudioContext=undefined;window.webkitAudioContext=undefined;');
    const errs = []; page.on('pageerror', e => errs.push(String(e))); await page.goto('file://' + F10);
    await page.evaluate(() => window.__TP_UI.handle('settings')); await page.click('[data-bgm="on"]');
    assert.strictEqual(await page.evaluate(() => window.__TP_UI.bgm.state()), 'stopped'); assert.deepStrictEqual(errs, []); await ctx.close();
  });
  test('F19 実プレイ経路：カード→記号→カードで実際に10を作ると、結果画面に光・褒め言葉・制覇スタンプが出る', withPage(null, async page => {
    const r = await page.evaluate(() => {
      const U = window.__TP_UI; const e = U.POOL.find(x => x.solvable && x.nSolutionsNorm === 1 && !x.fractionRequired);
      U.handle('play-key', { dataset: { key: TP.keyOf(e.digits) } });
      const ops = ['+', '-', '*', '/'];
      function dfs() {
        if (TP.isFinished(U.ui.board)) return U.ui.screen === 'result';
        const n = U.ui.board.cards.length;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; for (const op of ops) {
          const h0 = U.ui.board.history.length;
          U.handle('card', { dataset: { i: String(i) } }); U.handle('op', { dataset: { op } }); U.handle('card', { dataset: { i: String(j) } });
          if (U.ui.screen === 'result') return true;
          if (U.ui.board.history.length > h0) { if (dfs()) return true; U.handle('undo'); }
          else { U.handle('reset'); U.ui.board = TP.newBoard(e.digits); U.ui.sel = []; TP.clearInputA(U.ui.a); const hist = []; }
        } }
        return false;
      }
      // 盤面が分岐で壊れないよう、直接 handle だけで探索する（失敗時は reset して先頭から）
      const ok = dfs();
      return { ok, screen: U.ui.screen };
    });
    assert.strictEqual(r.screen, 'result', JSON.stringify(r));
    assert.strictEqual(await page.locator('#r-expr.fx-glow').count(), 1);
    assert((await page.locator('#r-praise').innerText()).length > 0);
    assert.strictEqual(await page.locator('#r-gstamp').count(), 1, '1通りしかない組は初クリアで制覇');
  }));
  // ---------- J. デイリー画面・記録・ランキング（ブラウザ） ----------
  const FETCH_STUB = `window.__fetches=[];window.__dailyRows=[{name:'さくら',dscore:500,updated:'2026-11-18T01:00:00Z'},{name:'たろう',dscore:700,updated:'2026-11-18T02:00:00Z'}];window.__totalRows=[{name:'さくら',solved:3,solutions:4,score:100,updated:'2026-11-18T01:00:00Z'}];
  window.fetch=function(url,opts){window.__fetches.push({url:String(url),method:(opts&&opts.method)||'GET',body:(opts&&opts.body)||null});if(opts&&opts.method==='POST')return Promise.resolve({ok:true});var u=String(url);var rows=/board=daily/.test(u)?window.__dailyRows:window.__totalRows;return Promise.resolve({ok:true,json:function(){return Promise.resolve(rows)}});};`;
  const findDate = (pred) => { let d = '2026-11-01'; for (let i = 0; i < 400; i++) { if (pred(TP.dailySets(POOL, d))) return d; d = TP.addDays(d, 1); } throw new Error('date not found'); };
  const DU = findDate(s => tierOf(s[2]) === '作れない'), DS = findDate(s => tierOf(s[2]) !== '作れない');
  const noonMs = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 3, 0, 0); // JST 正午
  async function pageAt(date, opts) {
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: { width: 420, height: 800 }, timezoneId: opts.tz || 'America/Los_Angeles' });
    const page = await ctx.newPage(); await page.addInitScript(STUB); await page.addInitScript(FETCH_STUB);
    if (opts.keepStorage !== true) await page.addInitScript("try{if(!sessionStorage.getItem('__i')){localStorage.clear();sessionStorage.setItem('__i','1');}}catch(e){}");
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto('file://' + F10); await page.waitForSelector('#app');
    await page.evaluate(ms => { window.__TP_UI.setNow(() => ms); window.__TP_UI.handle('title'); }, noonMs(date));
    return { page, ctx, errs };
  }
  const withDay = (date, fn, opts) => async () => { const p = await pageAt(date, opts); try { await fn(p.page); assert.deepStrictEqual(p.errs, [], 'pageerror'); } finally { await p.ctx.close(); } };
  const solveCurrent = page => page.evaluate(() => {
    const U = window.__TP_UI; const e = U.POOL.find(x => TP.keyOf(x.digits) === U.ui.key);
    function dfs() {
      const n = U.ui.board.cards.length;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; for (const op of ['+', '-', '*', '/']) {
        const h0 = U.ui.board.history.length;
        U.handle('card', { dataset: { i: String(i) } }); U.handle('op', { dataset: { op } }); U.handle('card', { dataset: { i: String(j) } });
        if (U.ui.screen === 'result') return true;
        if (U.ui.board.history.length > h0) { if (dfs()) return true; U.handle('undo'); } else { TP.clearInputA(U.ui.a); U.ui.sel = []; }
      } }
      return false;
    }
    return e.solvable && dfs() && U.ui.screen === 'result';
  });
  const declareCurrent = page => page.evaluate(() => { const U = window.__TP_UI; U.handle('declare'); U.handle('modal-yes'); return U.ui.screen; });
  const dailyCards = page => page.evaluate(() => [...document.querySelectorAll('.dcard')].map(c => ({ key: c.dataset.key, done: c.classList.contains('done'), tier: c.querySelector('.dtier').textContent, st: c.querySelector('.dst').textContent, pts: c.querySelector('.pts').textContent, text: c.textContent })));

  test('J01 タイトルに「今日のお題」入口と進捗 0/3。押すとデイリー画面', withDay(DS, async page => {
    assert.strictEqual((await page.locator('#dailyBtnTitle').innerText()).replace(/\s+/g, ' ').trim().includes('今日のお題'), true);
    assert.strictEqual((await page.locator('#t-daily-n').innerText()).trim(), '0/3');
    await page.click('#dailyBtnTitle'); assert.strictEqual(await page.evaluate(() => window.__TP_UI.ui.screen), 'daily');
  }));
  test('J02 デイリー画面：3組の数字・ティア・状態（未挑戦）・獲得点（—）。選出は dailySets と一致（端末TZがLAでもJST基準）', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); const cs = await dailyCards(page); const want = TP.dailySets(POOL, DS);
    assert.deepStrictEqual(cs.map(c => c.key), want); assert.strictEqual((await page.locator('#d-date').innerText()).trim(), DS);
    cs.forEach((c, i) => { assert.strictEqual(c.st, '未挑戦'); assert.strictEqual(c.pts, '—'); assert.strictEqual(c.done, false); assert(c.text.replace(/\s/g, '').includes(BYP[want[i]].digits.join(''))); });
    assert.strictEqual(cs[0].tier, tierOf(want[0])); assert.strictEqual(cs[1].tier, '中級'); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '0/3');
  }));
  test('J03 枠3が「作れない」の日でも、解決するまでティアで正体が漏れない（？表示）', withDay(DU, async page => {
    await page.click('#dailyBtnTitle'); const cs = await dailyCards(page); assert.strictEqual(tierOf(TP.dailySets(POOL, DU)[2]), '作れない');
    assert.strictEqual(cs[2].tier, '？'); assert(!cs[2].text.includes('作れない'));
  }));
  test('J04 カードをタップすると通常プレイ（その組・デイリー文脈つき）で始まる', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="2"]');
    const r = await page.evaluate(() => ({ s: window.__TP_UI.ui.screen, k: window.__TP_UI.ui.key, d: window.__TP_UI.ui.daily })); assert.deepStrictEqual(r, { s: 'play', k: TP.dailySets(POOL, DS)[1], d: { date: DS } });
  }));
  test('J05 クリアすると結果画面にデイリー点と「デイリーへ戻る」。戻ると状態クリア・獲得点・進捗が更新、図鑑/本体セーブにも記録', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="1"]'); assert.strictEqual(await solveCurrent(page), true);
    const R = await page.evaluate(() => window.__TP_UI.ui.result); assert.strictEqual(R.kind, 'solve');
    assert.strictEqual((await page.locator('#r-daily').innerText()).includes('+' + R.attempt + '点'), true);
    assert.strictEqual(await page.locator('#r-expr.fx-glow').count(), 1, 'v1.0 の祝福はそのまま');
    await page.click('#r-daily-back'); assert.strictEqual(await page.evaluate(() => window.__TP_UI.ui.screen), 'daily');
    const cs = await dailyCards(page); assert.strictEqual(cs[0].st, 'クリア'); assert.strictEqual(cs[0].pts, '+' + R.attempt + '点'); assert.strictEqual(cs[0].done, true);
    assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '1/3'); assert.strictEqual((await page.locator('#d-score').innerText()).trim(), String(R.attempt));
    const sv = await page.evaluate(k => { const r = TP.peekRec(window.__TP_UI.getSave(), k); return { found: r.found.length, total: window.__TP_UI.getSave().total }; }, R.key); assert(sv.found >= 1); assert(sv.total >= R.attempt);
    await page.click('[data-act="title"]'); assert.strictEqual((await page.locator('#t-daily-n').innerText()).trim(), '1/3');
  }));
  test('J06 同じ組を再挑戦してもデイリー点は加算されない（「記録済み」表示）', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="1"]'); await solveCurrent(page);
    const first = await page.evaluate(() => window.__TP_UI.ui.result.attempt); await page.click('[data-act="again"]');
    assert.strictEqual(await page.evaluate(() => !!window.__TP_UI.ui.daily), true, 'もう一度でもデイリー文脈を保つ'); await solveCurrent(page);
    assert(((await page.locator('#r-daily').innerText())).includes('記録済み')); await page.click('#r-daily-back');
    assert.strictEqual((await page.locator('#d-score').innerText()).trim(), String(first)); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '1/3');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tenpuzzle_daily_v1'))); assert.strictEqual(Object.values(stored.days[Object.keys(stored.days)[0]]).length, 1);
  }));
  test('J07 見極め成功（作れない組）が「見極め成功」＋宣言点で記録され、3組完了でスコア合計が出る', withDay(DU, async page => {
    await page.click('#dailyBtnTitle'); const keys = TP.dailySets(POOL, DU); let total = 0;
    for (const slot of [1, 2, 3]) { await page.evaluate(() => window.__TP_UI.handle('daily')); await page.click('.dcard[data-slot="' + slot + '"]');
      if (slot < 3) { assert.strictEqual(await solveCurrent(page), true); total += await page.evaluate(() => window.__TP_UI.ui.result.attempt); } else { assert.strictEqual(await declareCurrent(page), 'result'); total += 50; assert.strictEqual(await page.evaluate(() => window.__TP_UI.ui.result.success), true); } }
    await page.click('#r-daily-back'); const cs = await dailyCards(page);
    assert.deepStrictEqual(cs.map(c => c.st), ['クリア', 'クリア', '見極め成功']); assert.strictEqual(cs[2].pts, '+50点'); assert.strictEqual(cs[2].tier, '作れない', '解決後はティアが見える');
    assert.strictEqual((await page.locator('#d-score').innerText()).trim(), String(total)); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '3/3');
  }));
  test('J08 デイリー画面を経由しない通常プレイでは記録しない（同じ組でも）', withDay(DS, async page => {
    const k = TP.dailySets(POOL, DS)[0]; await page.evaluate(k => window.__TP_UI.handle('play-key', { dataset: { key: k } }), k); assert.strictEqual(await solveCurrent(page), true);
    assert.strictEqual(await page.locator('#r-daily').count(), 0); assert.strictEqual(await page.locator('#r-daily-back').count(), 0);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('tenpuzzle_daily_v1')), null);
    await page.evaluate(() => window.__TP_UI.handle('daily')); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '0/3');
  }));
  test('J09 デイリー記録は別キー。セーブ書き出し・本体セーブには入らない', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="1"]'); await solveCurrent(page);
    const r = await page.evaluate(() => ({ save: localStorage.getItem('tenpuzzle_save_v1') || '', daily: localStorage.getItem('tenpuzzle_daily_v1') || '', exp: window.__TP_UI.exportText(), keys: Object.keys(localStorage) }));
    assert(r.daily.includes('"clear"')); assert(!/daily|dscore/.test(r.save)); assert(!/daily|dscore|"clear"/.test(r.exp)); assert(r.keys.includes('tenpuzzle_save_v1') && r.keys.includes('tenpuzzle_daily_v1'));
  }));
  test('J10 再読み込みしても進捗・点・状態が残る', async () => {
    const p = await pageAt(DS); try {
      await p.page.click('#dailyBtnTitle'); await p.page.click('.dcard[data-slot="1"]'); await solveCurrent(p.page); const pts = await p.page.evaluate(() => window.__TP_UI.ui.result.attempt);
      await p.page.reload(); await p.page.waitForFunction(() => !!window.__TP_UI); await p.page.evaluate(ms => { window.__TP_UI.setNow(() => ms); window.__TP_UI.handle('title'); }, noonMs(DS));
      assert.strictEqual((await p.page.locator('#t-daily-n').innerText()).trim(), '1/3'); await p.page.click('#dailyBtnTitle');
      const cs = await dailyCards(p.page); assert.strictEqual(cs[0].st, 'クリア'); assert.strictEqual(cs[0].pts, '+' + pts + '点'); assert.deepStrictEqual(p.errs, []);
    } finally { await p.ctx.close(); }
  });
  test('J11 日付が変わる（JST 0:00）と新しい3組・0/3。前日の記録は残る', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="1"]'); await solveCurrent(page);
    const next = TP.addDays(DS, 1);
    await page.evaluate(ms => { window.__TP_UI.setNow(() => ms); window.__TP_UI.handle('daily'); }, Date.UTC(+DS.slice(0, 4), +DS.slice(5, 7) - 1, +DS.slice(8, 10), 15, 0, 0));
    assert.strictEqual((await page.locator('#d-date').innerText()).trim(), next); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '0/3');
    assert.deepStrictEqual((await dailyCards(page)).map(c => c.key), TP.dailySets(POOL, next));
    await page.evaluate(ms => { window.__TP_UI.setNow(() => ms); window.__TP_UI.handle('daily'); }, Date.UTC(+DS.slice(0, 4), +DS.slice(5, 7) - 1, +DS.slice(8, 10), 14, 59, 59));
    assert.strictEqual((await page.locator('#d-date').innerText()).trim(), DS); assert.strictEqual((await page.locator('#d-progress').innerText()).trim(), '1/3');
  }));
  test('J12 ランキング画面に「累計／今日のデイリー」の切り替え。デイリー未完了は閲覧のみ（POSTしない）で、GET は board=daily&date', withDay(DS, async page => {
    await page.evaluate(() => localStorage.setItem('tenpuzzle_name', 'ゆうた')); await page.evaluate(() => window.__TP_UI.openRanking('total'));
    assert.strictEqual(await page.locator('#rankMode_total.on').count(), 1); await page.waitForFunction(() => window.__fetches.length >= 2);
    await page.click('#rankMode_daily'); await page.waitForFunction(() => window.__fetches.length >= 3); await page.waitForSelector('#rankList .rankItem');
    const f = await page.evaluate(() => window.__fetches); const posts = f.filter(x => x.method === 'POST'); assert.strictEqual(posts.length, 1, '累計の POST だけ');
    const g = f[f.length - 1]; assert.strictEqual(g.method, 'GET'); assert(g.url.includes('board=daily&date=' + DS), g.url);
    assert.deepStrictEqual(await page.evaluate(() => [...document.querySelectorAll('#rankList .rankName')].map(e => e.textContent)), ['たろう', 'さくら']);
    assert(await page.locator('#rankDailyNote').innerText().then(t => t.includes('0/3') && t.includes('3組すべて終わると'))); assert.strictEqual(await page.locator('#rankTabs.hidden').count(), 1, '並び替えタブは累計のみ');
    await page.click('#rankMode_total'); await page.waitForFunction(() => document.querySelector('#rankTabs') && !document.querySelector('#rankTabs').classList.contains('hidden'));
  }));
  test('J13 3組すべて終わるとデイリー送信（POST: board=daily&date&dscore&name）→ GET。既存のニックネームを使う', withDay(DU, async page => {
    await page.evaluate(() => localStorage.setItem('tenpuzzle_name', 'ゆうた')); const keys = TP.dailySets(POOL, DU);
    for (const slot of [1, 2, 3]) { await page.evaluate(() => window.__TP_UI.handle('daily')); await page.click('.dcard[data-slot="' + slot + '"]'); if (slot < 3) await solveCurrent(page); else await declareCurrent(page); }
    const sc = await page.evaluate(d => TP.dailySummary(window.__TP_UI.getDaily(), d, TP.dailySets(window.__TP_UI.POOL, d)).score, DU);
    await page.evaluate(() => window.__TP_UI.handle('daily')); await page.click('#dailyRankBtn'); await page.waitForSelector('#rankList .rankItem');
    const f = await page.evaluate(() => window.__fetches); const post = f.find(x => x.method === 'POST'); assert.strictEqual(post.body, 'board=daily&date=' + DU + '&dscore=' + sc + '&name=' + encodeURIComponent('ゆうた'));
    assert.strictEqual(f[f.length - 1].method, 'GET'); assert(f[f.length - 1].url.includes('board=daily&date=' + DU)); assert.strictEqual(await page.evaluate(() => window.__TP_UI.getRankMode()), 'daily');
  }));
  test('J14 完了済みでニックネーム未設定なら、先に名前を聞いてからデイリーを送信', withDay(DU, async page => {
    for (const slot of [1, 2, 3]) { await page.evaluate(() => window.__TP_UI.handle('daily')); await page.click('.dcard[data-slot="' + slot + '"]'); if (slot < 3) await solveCurrent(page); else await declareCurrent(page); }
    await page.evaluate(() => window.__TP_UI.handle('daily')); await page.click('#dailyRankBtn'); assert.strictEqual(await page.locator('#rankNameBox:not(.hidden)').count(), 1);
    assert.strictEqual(await page.evaluate(() => window.__fetches.length), 0); await page.fill('#rankNameInput', 'はな'); await page.click('#rankNameOk'); await page.waitForSelector('#rankList .rankItem');
    const post = (await page.evaluate(() => window.__fetches)).find(x => x.method === 'POST'); assert(post.body.startsWith('board=daily&date=' + DU + '&dscore=')); assert(post.body.endsWith('&name=' + encodeURIComponent('はな')));
  }));
  test('J15 累計ランキングは従来どおり：POST 本文に board を含まず、GET URL にも board を付けない', withDay(DS, async page => {
    await page.evaluate(() => localStorage.setItem('tenpuzzle_name', 'ゆうた')); await page.evaluate(() => window.__TP_UI.handle('ranking')); await page.waitForSelector('#rankList .rankItem');
    const f = await page.evaluate(() => window.__fetches); const post = f.find(x => x.method === 'POST'); assert(/^name=.*&solved=\d+&solutions=\d+&score=\d+$/.test(post.body), post.body); assert(!/board|date|dscore/.test(post.body));
    const get = f.find(x => x.method === 'GET'); assert(!/board|date/.test(get.url), get.url); assert.strictEqual(await page.evaluate(() => window.__TP_UI.getRankMode()), 'total');
  }));
  test('J16 ストリーク（連続日数）は表示しない', withDay(DS, async page => {
    await page.click('#dailyBtnTitle'); await page.click('.dcard[data-slot="1"]'); await solveCurrent(page); await page.click('#r-daily-back');
    assert(!/連続|ストリーク|streak/i.test(await page.locator('#app').innerText()));
  }));
  test('J17 通常のクリア結果（デイリー外）は v1.0 と同じ表示：デイリー関連の要素が出ない', withDay(DS, async page => {
    await showResult(page, 'solve', 'single'); assert.strictEqual(await page.locator('#r-daily, #r-daily-back').count(), 0); assert.strictEqual(await page.locator('[data-act="next"].primary').count(), 1);
  }));

  queue.unshift({ name: 'F-setup', fn: async () => { browser = await pw.chromium.launch(); }, internal: true });
  queue.push({ name: 'F-teardown', fn: async () => { if (browser) await browser.close(); }, internal: true });
}

runAll().then(() => {
  const internal = queue.filter(q => q.internal).length;
  const total = pass + fail - internal, passed = pass - internal;
  console.log('\n==== 結果: ' + passed + '/' + total + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====');
  process.exit(fail ? 1 : 0);
});
