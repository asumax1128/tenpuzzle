// テンパズル v1.0 テスト。実行: node tests/test_tenpuzzle_v10.js
// 注意：v0.9 の元テスト（136項目）はリポジトリに無かったため取り込めていない。
//  v0.9 の挙動は (A) 仕様値の固定テスト と (B) v0.9 ファイルとの差分（differential）テストで回帰を担保している。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const F10 = path.join(root, 'prototype-tenpuzzle-v10.html');
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

const V10 = loadHtml(F10), V09 = loadHtml(F09);
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
test('A07 v1.0 が増やした公開名は祝福/BGM 関連のみ', () => {
  assert.deepStrictEqual(Object.keys(TP).filter(k => !(k in V09.TP)).sort(), ['BGM', 'PRAISE', 'celebrationFor', 'createBgm', 'praiseFor']);
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
  const a = core(V09.html).split('\n'), bset = new Set(core(V10.html).split('\n'));
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
  const aa = strip(V09.html).split('\n'), bb = new Set(strip(V10.html).split('\n'));
  const removed = aa.filter(l => !bb.has(l)).map(l => l.trim());
  const allowedRe = [
    /^<title>テンパズル v0\.9<\/title>$/, /actx = new C\(\)/, /^win: function/, /設定はこの端末に保存されます/, /^var R = ui\.result/,
    /id="r-expr"/, /id="r-new"/, /class="big-stamp">見極め/, /^window\.__TP_UI = \{ ui: ui,/, /^function renderSettings\(\) \{$/, /^try \{$/, /^function esc\(s\)/,
    /^\.res \.btns/, /^case 'export'/, /^function beep/
  ];
  removed.forEach(l => assert(allowedRe.some(r => r.test(l)), '想定外の変更: ' + l));
  assert(removed.length <= 16, '変更行が多すぎる: ' + removed.length);
});
test('E03 v0.9 ファイルは残っており、v0.9 のままタイトルが v0.9', () => { assert(/<title>テンパズル v0\.9<\/title>/.test(V09.html)); assert.strictEqual(V10.html, fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '公開中の index.html は v1.0'); });

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
  test('F17 タイトルが v1.0', () => { assert(/<title>テンパズル v1\.0<\/title>/.test(V10.html)); });
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
  queue.unshift({ name: 'F-setup', fn: async () => { browser = await pw.chromium.launch(); }, internal: true });
  queue.push({ name: 'F-teardown', fn: async () => { if (browser) await browser.close(); }, internal: true });
}

runAll().then(() => {
  const internal = queue.filter(q => q.internal).length;
  const total = pass + fail - internal, passed = pass - internal;
  console.log('\n==== 結果: ' + passed + '/' + total + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====');
  process.exit(fail ? 1 : 0);
});
