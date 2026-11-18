// テンパズル ランキング用 Apps Script（v0.9 対応版）
// 列: A ニックネーム / B 解いた数 / C 解法の数 / D 累計スコア / E 更新日時
// 登録はニックネームで upsert（同じ名前は行を更新、1人1行）
//
// v0.9 の変更（外部監査の指摘への対応）
// - 名前は必ずテキストとして保存する（A列を書式なしテキスト「@」にしてから書く）。
//   「=」「+」「-」「@」で始まる名前は、先頭に「'」を付けて数式として解釈されないようにする（無害化）。
//   読み出し・一致判定ではこの「'」を取り除くので、表示名と upsert の一致判定は元の名前のまま。
// - 値の妥当性を確認し、満たさない送信は丸めずに拒否して {ok:false} を返す。
//     solved ≤ 495、solutions ≤ 1613、score ≤ 65370、score ≤ 350×solved＋15×solutions
//   （65370 は理論最大。350 は1組で取れる最大の核点、15 は新解法ボーナス）
// - 名前の長さ上限はクライアントと同じ10文字。
// 返り値：POST は JSON（{ok:true} / {ok:false, error:'…'}）、GET は従来どおり JSON 配列。

var LIMITS = { NAME_MAX: 10, SOLVED_MAX: 495, SOLUTIONS_MAX: 1613, SCORE_MAX: 65370, CORE_MAX: 350, NEW_SOLUTION: 15 };
var HEADER = 'ニックネーム';

function headerOffset(values) {
  // 1行目が見出し（A1 = 'ニックネーム'）なら、その行をデータから除外する
  return (values.length > 0 && String(values[0][0]) === HEADER) ? 1 : 0;
}

// シートに書く形：数式として解釈される先頭文字なら「'」を付ける（テキスト扱いにする）
function encodeName(name) {
  return /^[=+\-@]/.test(name) ? "'" + name : name;
}
// シートから読んだ値 → 元の名前（セルの値はテキストとして扱う。数値になっていた古い行も文字列化）
function decodeName(v) {
  var s = String(v === null || v === undefined ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

// 送信された名前を整える：制御文字を除き、前後の空白を取る。空や10文字超は拒否
function cleanName(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) return { ok: false, error: 'no name' };
  if (s.length > LIMITS.NAME_MAX) return { ok: false, error: 'name too long' };
  return { ok: true, name: s };
}
// 0 以上の整数を表す文字列だけを受け付ける（丸めない）
function parseCount(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  return Number(s);
}
// 値の妥当性（満たさなければ理由を返す）
function validateEntry(p) {
  var n = cleanName(p.name);
  if (!n.ok) return n;
  var solved = parseCount(p.solved), solutions = parseCount(p.solutions), score = parseCount(p.score);
  if (solved === null || solutions === null || score === null) return { ok: false, error: 'not a non-negative integer' };
  if (solved > LIMITS.SOLVED_MAX) return { ok: false, error: 'solved too large' };
  if (solutions > LIMITS.SOLUTIONS_MAX) return { ok: false, error: 'solutions too large' };
  if (score > LIMITS.SCORE_MAX) return { ok: false, error: 'score too large' };
  if (score > LIMITS.CORE_MAX * solved + LIMITS.NEW_SOLUTION * solutions) return { ok: false, error: 'score inconsistent' };
  return { ok: true, name: n.name, solved: solved, solutions: solutions, score: score };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = headerOffset(values); i < values.length; i++) {
    var name = decodeName(values[i][0]);
    if (!name) continue;
    rows.push({
      name: name,
      solved: Number(values[i][1]) || 0,
      solutions: Number(values[i][2]) || 0,
      score: Number(values[i][3]) || 0,
      updated: values[i][4] ? String(values[i][4]) : ''
    });
  }
  return jsonOut(rows);
}

function doPost(e) {
  var v = validateEntry((e && e.parameter) || {});
  if (!v.ok) return jsonOut({ ok: false, error: v.error });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonOut({ ok: false, error: 'busy' });
  }
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var values = sheet.getDataRange().getValues();
    var now = new Date();
    for (var i = headerOffset(values); i < values.length; i++) {
      if (decodeName(values[i][0]) === v.name) {
        sheet.getRange(i + 1, 2, 1, 4).setValues([[v.solved, v.solutions, v.score, now]]);
        return jsonOut({ ok: true, updated: true });
      }
    }
    // 新しい行：A列を書式なしテキストにしてから書く（数字だけの名前や「=」始まりの名前も文字列のまま残す）
    var row = Math.max(sheet.getLastRow(), headerOffset(values)) + 1;
    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, 5).setValues([[encodeName(v.name), v.solved, v.solutions, v.score, now]]);
    return jsonOut({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}
