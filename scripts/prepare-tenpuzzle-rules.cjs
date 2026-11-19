#!/usr/bin/env node
'use strict';
// テンパズル v1.2：Firebase ルールの「候補」を作る合成スクリプト（いろヨミの prepare-iroyomi-rules.cjs と同じ作法）。
//   node scripts/prepare-tenpuzzle-rules.cjs --current <現在のコンソールルールJSON> [--out <候補の出力先>] [--branch <ブランチ名>] [--no-git]
// やること：
//   1) 現在のコンソールルール JSON を読み、rules.games.tenpuzzle に firebase/tenpuzzle-rules.cjs の断片を差し込んだ候補を作る
//   2) 既存ルールが1つでも変わっていたら assert で落ちる（増えてよいのは rules/games/tenpuzzle だけ。既に tenpuzzle があれば停止）
//   3) 対象ブランチが既に存在したら（ローカル・origin とも）停止する。無ければ、そのブランチを作って候補 JSON だけをコミットする（--no-git で省略）
// やらないこと：Firebase へのデプロイ（候補を福山が確認してから、コンソールで手動で行う）。このスクリプトは firebase コマンドを呼ばない。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const cp = require('child_process');

const DEFAULT_BRANCH = 'rules/tenpuzzle-v12-candidate';
const DEFAULT_OUT = 'firebase/candidates/database.rules.tenpuzzle-candidate.json';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// 2つの JSON の差を、パス（rules/games/…）の一覧で返す。added / removed / changed（葉の値が違う）
function diffPaths(a, b) {
  const out = { added: [], removed: [], changed: [] };
  (function walk(x, y, p) {
    if (isObj(x) && isObj(y)) {
      for (const k of Object.keys(x)) { if (!(k in y)) out.removed.push(p ? p + '/' + k : k); else walk(x[k], y[k], p ? p + '/' + k : k); }
      for (const k of Object.keys(y)) if (!(k in x)) out.added.push(p ? p + '/' + k : k);
    } else if (JSON.stringify(x) !== JSON.stringify(y)) out.changed.push(p);
  })(a, b, '');
  return out;
}

// 既存ルールが1つでも変わっていたら落ちる：候補は「現在のルール＋ rules/games/tenpuzzle」と一字一句（キーの順序も）同じでなければならない
function assertOnlyTenpuzzleAdded(current, candidate) {
  const d = diffPaths(current, candidate);
  assert.deepStrictEqual(d, { added: ['rules/games/tenpuzzle'], removed: [], changed: [] }, '既存ルールが変わっています: ' + JSON.stringify(d));
  const rest = JSON.parse(JSON.stringify(candidate)); delete rest.rules.games.tenpuzzle;
  assert.strictEqual(JSON.stringify(rest), JSON.stringify(current), '既存ルール（tenpuzzle 以外）が現在のルールと一致しません');
  assert.deepStrictEqual(Object.keys(candidate.rules.games), Object.keys(current.rules.games).concat(['tenpuzzle']), '既存の games の順序・内容が変わっています');
}

// 合成：現在のルールに games/tenpuzzle を足した候補を返す
// opts.afterMerge(candidate)：テスト専用。合成直後の候補を書き換えて、検証（assertOnlyTenpuzzleAdded）が本当に働くことを確かめる
function composeRules(current, fragment, opts) {
  assert(isObj(current) && isObj(current.rules), '現在のルールが {"rules": {...}} の形ではありません');
  assert(isObj(current.rules.games), 'rules.games がありません（想定外の構造。いろヨミ等のゲームは rules/games 配下にある前提）');
  assert(!('tenpuzzle' in current.rules.games), 'rules.games.tenpuzzle が既にあります。上書きしません（停止）');
  assert(isObj(fragment) && isObj(fragment.rooms), '断片が不正です（rooms がありません）');
  const before = JSON.stringify(current);
  const candidate = JSON.parse(before);
  candidate.rules.games.tenpuzzle = JSON.parse(JSON.stringify(fragment));
  if (opts && typeof opts.afterMerge === 'function') opts.afterMerge(candidate);
  assert.strictEqual(JSON.stringify(current), before, '入力のルールが書き換えられました');
  assertOnlyTenpuzzleAdded(current, candidate);
  return { candidate, diff: diffPaths(current, candidate) };
}

function git(args, cwd) {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
// 対象ブランチが既に存在するか（ローカル・origin）。存在すれば理由を返す。確認できない（origin に届かない等）場合は安全側に倒して停止
function branchExists(branch, cwd) {
  if (git(['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch], cwd).code === 0) return 'ローカルに既にあります';
  const hasOrigin = git(['remote', 'get-url', 'origin'], cwd).code === 0;
  if (hasOrigin) {
    const r = git(['ls-remote', '--heads', 'origin', branch], cwd);
    if (r.code !== 0) return 'origin のブランチ一覧を確認できませんでした（' + r.err.split('\n')[0] + '）';
    if (r.out) return 'origin に既にあります';
  }
  return null;
}

function parseArgs(argv) {
  const o = { branch: DEFAULT_BRANCH, out: DEFAULT_OUT, git: true, current: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--current') o.current = argv[++i]; else if (a === '--out') o.out = argv[++i]; else if (a === '--branch') o.branch = argv[++i];
    else if (a === '--no-git') o.git = false; else throw new Error('不明な引数: ' + a);
  }
  if (!o.current) throw new Error('--current <現在のコンソールルールJSON> が必要です');
  return o;
}

function main(argv, cwd) {
  const o = parseArgs(argv);
  const repo = cwd || process.cwd();
  const currentText = fs.readFileSync(path.resolve(repo, o.current), 'utf8');
  const current = JSON.parse(currentText);
  const fragment = require(path.join(__dirname, '..', 'firebase', 'tenpuzzle-rules.cjs'));
  // 先にブランチを確認（既にあれば何も書かずに止まる）
  if (o.git) { const why = branchExists(o.branch, repo); if (why) throw new Error('対象ブランチ ' + o.branch + ' が既に存在するため停止します（' + why + '）'); }
  const { candidate, diff } = composeRules(current, fragment);
  const outPath = path.resolve(repo, o.out);
  if (o.git) {
    const sw = git(['switch', '-c', o.branch], repo);
    if (sw.code !== 0) throw new Error('ブランチを作成できませんでした: ' + sw.err);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(candidate, null, 2) + '\n');
  if (o.git) {
    const rel = path.relative(repo, outPath);
    if (git(['add', '--', rel], repo).code !== 0) throw new Error('git add に失敗しました');
    const c = git(['commit', '-q', '-m', 'tenpuzzle: Realtime Database ルールの候補（games/tenpuzzle を追加）。デプロイはコンソールで手動', '--', rel], repo);
    if (c.code !== 0) throw new Error('git commit に失敗しました: ' + c.err);
  }
  return { out: outPath, branch: o.git ? o.branch : null, diff };
}

if (require.main === module) {
  try {
    const r = main(process.argv.slice(2));
    console.log('候補を作成しました: ' + r.out + (r.branch ? '（ブランチ ' + r.branch + ' にコミット）' : ''));
    console.log('追加: ' + r.diff.added.join(', ') + ' ／ 変更・削除: なし');
    console.log('※デプロイは行っていません。候補を確認してから、Firebase コンソールで手動で公開してください。');
  } catch (e) { console.error('停止: ' + e.message); process.exit(1); }
}
module.exports = { composeRules, assertOnlyTenpuzzleAdded, diffPaths, branchExists, main, parseArgs, DEFAULT_BRANCH, DEFAULT_OUT };
