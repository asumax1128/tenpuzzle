// テンパズル ランキング用 Apps Script（v1.1 対応版：v0.9 対応版＋デイリーランキング）
//
// v1.1 の変更（デイリーランキングの追加。累計ランキングの動作・検証・1枚目のシートは v0.9 版から一切変更していない）
// - POST に board=daily&date=YYYY-MM-DD&dscore=N&name=… を追加。2枚目のシート「daily」（無ければ作成）へ
//   (日付, 名前) で upsert する。列: A 日付 / B 名前 / C デイリースコア / D 更新日時
// - GET に ?board=daily&date=YYYY-MM-DD を追加。その日の行だけを [{name, dscore, updated}] で返す
// - dscore は 0 以上の整数で上限 1095（3組×365）。不正値は丸めず {ok:false} で拒否。名前の検証・無害化（cleanName / encodeName）は累計と同じ
// - board パラメータが無い POST/GET は、これまでどおり累計（1枚目のシート）の処理。board が 'daily' 以外なら拒否
// - 再デプロイ：既存のウェブアプリのデプロイを編集し、「新しいバージョン」として公開する（URLは変わらない）
// 注意：論理代入演算子は Apps Script で構文エラーになるので使わない
//
// ---- 以下は v0.9 対応版の説明 ----
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
var DAILY_LIMITS = { SCORE_MAX: 1095 };
var DAILY_SHEET = 'daily';
var DAILY_HEADER = '日付';
var DAILY_COLUMNS = ['日付', '名前', 'デイリースコア', '更新日時'];

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

// ---- v1.1：デイリー ----
// 'YYYY-MM-DD' の実在する暦日だけを受け付ける
function parseDateParam(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  var t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return s;
}
// daily の POST の検証（丸めず、満たさなければ理由を返す）
function validateDaily(p) {
  var n = cleanName(p.name);
  if (!n.ok) return n;
  var date = parseDateParam(p.date);
  if (date === null) return { ok: false, error: 'bad date' };
  var dscore = parseCount(p.dscore);
  if (dscore === null) return { ok: false, error: 'not a non-negative integer' };
  if (dscore > DAILY_LIMITS.SCORE_MAX) return { ok: false, error: 'dscore too large' };
  return { ok: true, name: n.name, date: date, dscore: dscore };
}
// シートの日付セルを 'YYYY-MM-DD' にそろえる（書式なしテキストで書いているので通常は文字列。Date になっていた場合の保険）
function dateCellToString(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  return String(v === null || v === undefined ? '' : v);
}
function dailyHeaderOffset(values) {
  return (values.length > 0 && String(values[0][0]) === DAILY_HEADER) ? 1 : 0;
}
// 2枚目のシート「daily」。無ければ見出し付きで作成する
function getDailySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DAILY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([DAILY_COLUMNS]);
  }
  return sheet;
}
function doGetDaily(date) {
  var d = parseDateParam(date);
  if (d === null) return jsonOut({ ok: false, error: 'bad date' });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_SHEET);
  if (!sheet) return jsonOut([]); // まだ誰も登録していない（GET ではシートを作らない）
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = dailyHeaderOffset(values); i < values.length; i++) {
    if (dateCellToString(values[i][0]) !== d) continue;
    var name = decodeName(values[i][1]);
    if (!name) continue;
    rows.push({
      name: name,
      dscore: Number(values[i][2]) || 0,
      updated: values[i][3] ? String(values[i][3]) : ''
    });
  }
  return jsonOut(rows);
}
function doPostDaily(p) {
  var v = validateDaily(p);
  if (!v.ok) return jsonOut({ ok: false, error: v.error });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonOut({ ok: false, error: 'busy' });
  }
  try {
    var sheet = getDailySheet();
    var values = sheet.getDataRange().getValues();
    var now = new Date();
    for (var i = dailyHeaderOffset(values); i < values.length; i++) {
      if (dateCellToString(values[i][0]) === v.date && decodeName(values[i][1]) === v.name) {
        sheet.getRange(i + 1, 3, 1, 2).setValues([[v.dscore, now]]);
        return jsonOut({ ok: true, updated: true });
      }
    }
    // 新しい行：A列（日付）とB列（名前）を書式なしテキストにしてから書く（日付の自動変換・数式化を防ぐ）
    var row = Math.max(sheet.getLastRow(), dailyHeaderOffset(values)) + 1;
    sheet.getRange(row, 1, 1, 2).setNumberFormat('@');
    sheet.getRange(row, 1, 1, 4).setValues([[v.date, encodeName(v.name), v.dscore, now]]);
    return jsonOut({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

// ---- ルーティング（board パラメータが無ければ従来の累計の処理） ----
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.board === undefined) return doGetTotal();
  if (p.board === 'daily') return doGetDaily(p.date);
  return jsonOut({ ok: false, error: 'unknown board' });
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.board === undefined) return doPostTotal(e);
  if (p.board === 'daily') return doPostDaily(p);
  return jsonOut({ ok: false, error: 'unknown board' });
}

// ---- 累計ランキング（v0.9 対応版のまま。関数名のみ doGet/doPost から変更） ----
function doGetTotal() {
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

function doPostTotal(e) {
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
