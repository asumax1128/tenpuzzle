// scripts/prepare-tenpuzzle-rules.cjs（合成スクリプト）のテスト。エミュレータ不要。実行: npm run test:prepare
// 注意：fixtures/console-rules-sample.json は「現在のコンソールルール」を想定した合成サンプル（実物ではない）。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const fragment = require('../firebase/tenpuzzle-rules.cjs');
const prep = require('../scripts/prepare-tenpuzzle-rules.cjs');
const SCRIPT = path.join(__dirname, '../scripts/prepare-tenpuzzle-rules.cjs');
const SAMPLE_PATH = path.join(__dirname, 'fixtures/console-rules-sample.json');
const SAMPLE = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

let pass = 0, fail = 0; const failures = [];
const queue = []; const test = (n, f) => queue.push({ n, f });
const sh = (cmd, args, cwd) => cp.spawnSync(cmd, args, { cwd, encoding: 'utf8' });
function tmpRepo(withOrigin) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-rules-'));
  const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
  const g = (...a) => { const r = sh('git', a, repo); assert.strictEqual(r.status, 0, 'git ' + a.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 'tester'); g('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'console-rules.json'), fs.readFileSync(SAMPLE_PATH)); g('add', '.'); g('commit', '-q', '-m', 'init');
  let remote = null;
  if (withOrigin) { remote = path.join(base, 'origin.git'); assert.strictEqual(sh('git', ['init', '-q', '--bare', remote]).status, 0); g('remote', 'add', 'origin', remote); g('push', '-q', 'origin', 'main'); }
  return { repo, base, g, remote };
}
const run = (cwd, args) => sh(process.execPath, [SCRIPT].concat(args), cwd);

test('S01 合成：既存ルールに games/tenpuzzle だけが足され、他は一字一句（キー順も）同じ。入力は書き換えない', () => {
  const before = JSON.stringify(SAMPLE); const out = prep.composeRules(SAMPLE, fragment);
  assert.strictEqual(JSON.stringify(SAMPLE), before); assert.deepStrictEqual(out.diff, { added: ['rules/games/tenpuzzle'], removed: [], changed: [] });
  const rest = clone(out.candidate); delete rest.rules.games.tenpuzzle; assert.strictEqual(JSON.stringify(rest), before);
  assert.deepStrictEqual(Object.keys(out.candidate.rules.games), ['iroyomi', 'factor', 'tenpuzzle']); assert.deepStrictEqual(out.candidate.rules.games.tenpuzzle, clone(fragment));
});
test('S02 既に games.tenpuzzle がある現在ルールには合成しない（上書きで停止）', () => {
  const cur = clone(SAMPLE); cur.rules.games.tenpuzzle = { rooms: {} }; assert.throws(() => prep.composeRules(cur, fragment), /既にあります/);
});
test('S03 想定外の構造は拒否：rules なし・games なし・配列・null・断片が不正', () => {
  [null, [], {}, { rules: null }, { rules: {} }, { rules: { games: [] } }, { rules: { games: null } }].forEach(x => assert.throws(() => prep.composeRules(x, fragment), /rules|ルール/, JSON.stringify(x)));
  [null, {}, { rooms: [] }, []].forEach(f => assert.throws(() => prep.composeRules(SAMPLE, f), /断片/));
});
test('S04 既存ルールが1つでも変わっていたら assert で落ちる（値の変更・削除・兄弟の追加・順序の変更・別の場所の追加）', () => {
  const mk = () => { const c = clone(SAMPLE); c.rules.games.tenpuzzle = clone(fragment); return c; };
  assert.doesNotThrow(() => prep.assertOnlyTenpuzzleAdded(SAMPLE, mk()));
  const muts = {
    '値の変更': c => { c.rules.games.iroyomi.rooms.$code['.read'] = 'true'; },
    '葉の値を1文字変更': c => { c.rules.games.factor.scores.$uid['.write'] = 'auth != null && auth.uid == $uid'; },
    '既存キーの削除': c => { delete c.rules.games.factor.scores['.read']; },
    'ルートの .read 変更': c => { c.rules['.read'] = true; },
    'ルートに新しいキー': c => { c.rules.extra = {}; },
    '他ゲームに子を追加': c => { c.rules.games.iroyomi.newkey = {}; },
    '別のゲームの追加': c => { c.rules.games.other = {}; },
    'tenpuzzle の二重追加場所': c => { c.rules.games.iroyomi.tenpuzzle = {}; },
    'games の順序変更': c => { const g = c.rules.games; c.rules.games = { tenpuzzle: g.tenpuzzle, iroyomi: g.iroyomi, factor: g.factor }; }
  };
  Object.keys(muts).forEach(k => { const c = mk(); muts[k](c); assert.throws(() => prep.assertOnlyTenpuzzleAdded(SAMPLE, c), /assert|変わって|一致|順序|Expected|deepStrictEqual/i, k); });
  const c2 = clone(SAMPLE); assert.throws(() => prep.assertOnlyTenpuzzleAdded(SAMPLE, c2), /Expected|deepStrictEqual|added/i, 'tenpuzzle が足されていない');
});
test('S04b composeRules 自身が検証している：合成直後に既存ルールを書き換えられたら（テスト用フック）、assert で落ちる', () => {
  const muts = [c => { c.rules.games.iroyomi.rooms.$code['.read'] = 'true'; }, c => { delete c.rules.games.factor; }, c => { c.rules['.write'] = true; }, c => { c.rules.games.newgame = {}; }];
  muts.forEach((m, i) => assert.throws(() => prep.composeRules(SAMPLE, fragment, { afterMerge: m }), /既存ルール|Expected|deepStrictEqual|一致/, 'mutation ' + i));
  assert.doesNotThrow(() => prep.composeRules(SAMPLE, fragment, { afterMerge: () => {} }));
});
test('S05 diffPaths：追加・削除・変更をパスで返す', () => {
  assert.deepStrictEqual(prep.diffPaths({ a: { b: 1, c: 2 } }, { a: { b: 2, d: 3 } }), { added: ['a/d'], removed: ['a/c'], changed: ['a/b'] });
  assert.deepStrictEqual(prep.diffPaths({ a: 1 }, { a: 1 }), { added: [], removed: [], changed: [] });
});
test('S06 CLI（git あり）：候補を作り、新しいブランチに候補 JSON だけをコミットする。元のブランチ・現在ルールのファイルは変わらない', () => {
  const t = tmpRepo(false); const r = run(t.repo, ['--current', 'console-rules.json']);
  assert.strictEqual(r.status, 0, r.stderr + r.stdout); assert(/デプロイは行っていません/.test(r.stdout));
  assert.strictEqual(t.g('rev-parse', '--abbrev-ref', 'HEAD'), prep.DEFAULT_BRANCH);
  const files = t.g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean); assert.deepStrictEqual(files, [prep.DEFAULT_OUT]);
  const cand = JSON.parse(fs.readFileSync(path.join(t.repo, prep.DEFAULT_OUT), 'utf8')); assert.deepStrictEqual(cand, prep.composeRules(SAMPLE, fragment).candidate);
  assert.strictEqual(t.g('status', '--porcelain'), ''); assert.strictEqual(t.g('rev-parse', 'main'), t.g('rev-parse', 'HEAD~1'), 'main は動かない');
  assert.strictEqual(fs.readFileSync(path.join(t.repo, 'console-rules.json'), 'utf8'), fs.readFileSync(SAMPLE_PATH, 'utf8'));
  const text = fs.readFileSync(path.join(t.repo, prep.DEFAULT_OUT), 'utf8'); assert(text.endsWith('}\n')); assert(/^ {2}"rules"/m.test(text));
});
test('S07 対象ブランチがローカルに既にあれば停止（何も書かない・ブランチを切り替えない）', () => {
  const t = tmpRepo(false); t.g('branch', prep.DEFAULT_BRANCH); const r = run(t.repo, ['--current', 'console-rules.json']);
  assert.notStrictEqual(r.status, 0); assert(/既に存在/.test(r.stderr), r.stderr); assert.strictEqual(t.g('rev-parse', '--abbrev-ref', 'HEAD'), 'main'); assert(!fs.existsSync(path.join(t.repo, prep.DEFAULT_OUT)));
});
test('S08 対象ブランチが origin にだけあっても停止', () => {
  const t = tmpRepo(true); t.g('push', '-q', 'origin', 'main:' + prep.DEFAULT_BRANCH); const r = run(t.repo, ['--current', 'console-rules.json']);
  assert.notStrictEqual(r.status, 0); assert(/origin に既にあります/.test(r.stderr), r.stderr); assert(!fs.existsSync(path.join(t.repo, prep.DEFAULT_OUT))); assert.strictEqual(t.g('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});
test('S09 --branch で別名を指定でき、その名前が既にあれば停止。同じコマンドを2回実行すると2回目は停止する', () => {
  const t = tmpRepo(false); const a = run(t.repo, ['--current', 'console-rules.json', '--branch', 'rules/x1']); assert.strictEqual(a.status, 0, a.stderr);
  t.g('switch', '-q', 'main'); const b = run(t.repo, ['--current', 'console-rules.json', '--branch', 'rules/x1']); assert.notStrictEqual(b.status, 0); assert(/既に存在/.test(b.stderr));
});
test('S10 origin に届かない（確認できない）場合も安全側で停止する', () => {
  const t = tmpRepo(true); fs.rmSync(t.remote, { recursive: true, force: true }); const r = run(t.repo, ['--current', 'console-rules.json']);
  assert.notStrictEqual(r.status, 0); assert(/確認できませんでした/.test(r.stderr), r.stderr); assert(!fs.existsSync(path.join(t.repo, prep.DEFAULT_OUT)));
});
test('S11 既存の games に tenpuzzle がある現在ルールでは、ブランチも作らず停止する', () => {
  const t = tmpRepo(false); const cur = clone(SAMPLE); cur.rules.games.tenpuzzle = { rooms: {} }; fs.writeFileSync(path.join(t.repo, 'console-rules.json'), JSON.stringify(cur)); t.g('commit', '-q', '-am', 'x');
  const r = run(t.repo, ['--current', 'console-rules.json']); assert.notStrictEqual(r.status, 0); assert(/既にあります/.test(r.stderr)); assert.strictEqual(t.g('rev-parse', '--abbrev-ref', 'HEAD'), 'main'); assert.strictEqual(t.g('branch', '--list', prep.DEFAULT_BRANCH), '');
});
test('S12 --no-git：git に触れず候補だけ書く（git リポジトリでなくても動く）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-nogit-')); fs.copyFileSync(SAMPLE_PATH, path.join(dir, 'cur.json'));
  const r = run(dir, ['--current', 'cur.json', '--no-git', '--out', 'out/cand.json']); assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out/cand.json'), 'utf8')), prep.composeRules(SAMPLE, fragment).candidate);
});
test('S13 引数エラー：--current なし・不明な引数・存在しないファイル・壊れた JSON は非0で停止', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-arg-')); fs.writeFileSync(path.join(dir, 'bad.json'), '{broken');
  [[], ['--current', 'nope.json', '--no-git'], ['--current', 'bad.json', '--no-git'], ['--current', 'bad.json', '--wat']].forEach(a => { const r = run(dir, a); assert.notStrictEqual(r.status, 0, a.join(' ')); assert(/停止/.test(r.stderr)); });
});
test('S14 デプロイしない：スクリプトは firebase コマンド・firebase-tools を呼ばず、子プロセスは git だけ', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\/[^\n]*/g, '');
  assert(!/firebase deploy|firebase-tools|npx firebase|spawnSync\('firebase'|exec\(/.test(src)); const spawns = [...src.matchAll(/spawnSync\(\s*'([^']+)'/g)].map(m => m[1]); assert.deepStrictEqual([...new Set(spawns)], ['git']);
});
test('S15 論理代入演算子（Apps Script で構文エラーになるもの）をスクリプト・断片・テストで使っていない', () => {
  const OPS = new RegExp(['\\?\\?=', '\\|\\|=', '&'.repeat(2) + '='].join('|'));
  ['../scripts/prepare-tenpuzzle-rules.cjs', '../firebase/tenpuzzle-rules.cjs', 'test_tenpuzzle_prepare_rules_v12.js', 'test_tenpuzzle_rules_v12.js'].forEach(f => assert(!OPS.test(fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/[^\n]*/g, '')), f));
});
test('S16 HTML 本体・ソロの CORE には触れていない（このブランチで prototype-*.html が v1.2 コミット ed6036d から変わっていない）', () => {
  const r = sh('git', ['diff', '--stat', 'ed6036d', '--', 'prototype-tenpuzzle-v12.html', 'prototype-tenpuzzle-v11.html', 'index.html'], path.join(__dirname, '..'));
  if (r.status === 0) assert.strictEqual(r.stdout.trim(), '', r.stdout);
});

(async () => {
  for (const t of queue) { try { await t.f(); pass++; console.log('ok   ' + t.n); } catch (e) { fail++; failures.push(t.n); console.log('FAIL ' + t.n + '\n     ' + String(e && e.message).split('\n').slice(0, 5).join('\n     ')); } }
  console.log('\n==== 結果: ' + pass + '/' + (pass + fail) + ' 合格' + (fail ? '、' + fail + ' 不合格 → ' + failures.join(', ') : '（全項目合格）') + ' ====');
  process.exit(fail ? 1 : 0);
})();
