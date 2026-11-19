'use strict';
// テンパズル v1.2 オンライン対戦：Realtime Database ルールの断片（games/tenpuzzle 配下だけ）。
// 仕様の正本は versus-design-v12.md（4.1 データ構造／4.3 時刻／4.4 先着判定／4.6 切断／6 ルールの方針）。
// 合成は scripts/prepare-tenpuzzle-rules.cjs が「現在のコンソールルール JSON」の rules.games.tenpuzzle に差し込む。
//
// 設計書 4.1 に対する追加（Realtime Database のルールには子の数を数える式が無いため）：
//   ・meta.guest：2人目（ゲスト）の uid の枠。参加者は「meta.host」と「meta.guest」の2人だけ（3人目は guest 枠を取れず、players にも入れない）。
//     これにより「相手の uid」がルールから分かる（forfeit の相手判定・再戦の両者確認に使う）。
// build({ now }) は now 式を差し替えられる。本番は 'now'。テストだけ、時計を数値で注入して境界（±1ms）を検証する。
// ルール内の時刻の式は NOW 1か所から作っているので、差し替えても他の論理は変わらない（テストで同一性を確認）。

const ROOM_CODE_RE = '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'; // いろヨミと同じ4文字（0 1 I L O を除く）

const K = {
  MAX_PLAYERS: 2,
  MAX_ROUND_INDEX: 7,        // 本戦5問＋延長戦最大3回 = 0〜7
  ROUND_MS: 60000,           // 1問の制限時間
  DEADLINE_GRACE_MS: 1000,   // 締切の通信遅延の吸収分（設計 4.4）
  FIRST_START_MS: 3000,      // 最初のラウンド：カウントダウン
  NEXT_START_MS: 5000,       // 次のラウンド：開示時間
  START_TOL_MS: 2000,        // startAt / lockUntil の許容幅（下記）
  WRONG_LOCK_MS: 10000,      // お手つき
  FORFEIT_GRACE_MS: 30000,   // 切断の猶予（F4）
  ROOM_TTL_MS: 86400000      // 放置部屋の掃除（24時間）
};
// 許容幅について：クライアントは ServerValue.TIMESTAMP に時間を足せないので「now + 3000」ちょうどの値は書けない。
// そのため startAt / lockUntil は [now + 基準 − 許容幅, now + 基準 + 許容幅] を受け付ける（at・createdAt・countdownAt は now と厳密一致）。

function build(opts) {
  const NOW = (opts && opts.now) || 'now';
  const ROOM = "root.child('games').child('tenpuzzle').child('rooms').child($code)";
  const AUTH = 'auth != null';
  const HOST = `${ROOM}.child('meta').child('host').val() === auth.uid`;
  const MEMBER = `${ROOM}.child('players').child(auth.uid).exists()`;
  const HOSTV = `${ROOM}.child('meta').child('host').val()`;
  const GUESTV = `${ROOM}.child('meta').child('guest').val()`;
  const OPP = `(auth.uid === ${HOSTV} ? ${GUESTV} : ${HOSTV})`; // 自分の相手の uid（参加者は host と guest の2人だけ）
  const OPPP = `${ROOM}.child('players').child(${OPP})`;
  const INT = 'newData.val() % 1 === 0';
  const near = (center) => `newData.val() >= ${NOW} + ${center - K.START_TOL_MS} && newData.val() <= ${NOW} + ${center + K.START_TOL_MS}`;
  const no = (c) => `!newData.child('${c}').exists()`;
  const has = (c) => `newData.child('${c}').exists()`;
  const STARTAT = "data.parent().child('startAt').val()";
  const lastIdx = K.MAX_ROUND_INDEX;

  // ---- rounds/<i> ----
  const rounds = { '.write': `${AUTH} && newData.val() === null && ${HOST} && ${ROOM}.child('players').child(auth.uid).child('rematch').val() === true && ${OPPP}.child('rematch').val() === true` };
  for (let i = 0; i <= lastIdx; i++) {
    const prev = String(i - 1);
    const startAt = i === 0
      ? {
        '.write': `${AUTH} && ${HOST} && !data.exists()`,
        '.validate': `newData.isNumber() && ${near(K.FIRST_START_MS)} && newData.parent().parent().parent().child('match').child('countdownAt').val() === ${NOW}`
      }
      : {
        '.write': `${AUTH} && ${MEMBER} && !data.exists()`,
        '.validate': `newData.isNumber() && ${near(K.NEXT_START_MS)} && newData.parent().parent().child('${prev}').child('result').exists() && newData.parent().parent().child('${prev}').child('result').child('kind').val() !== 'forfeit' && !data.parent().parent().child('${prev}').child('result').exists()`
      };
    const inWindow = `${NOW} >= ${STARTAT} && ${NOW} <= ${STARTAT} + ${K.ROUND_MS + K.DEADLINE_GRACE_MS}`;
    const kindIs = (k) => `newData.child('kind').val() === '${k}'`;
    const result = {
      '.write': `${AUTH} && ${MEMBER} && !data.exists() && data.parent().child('startAt').exists()`,
      '.validate': `newData.hasChildren(['kind', 'at']) && (` +
        `(${kindIs('solve')} && ${has('by')} && ${has('expr')} && ${no('vs')} && ${inWindow}) || ` +
        `(${kindIs('declare')} && ${has('by')} && ${no('expr')} && ${no('vs')} && ${inWindow}) || ` +
        `(${kindIs('timeout')} && ${no('by')} && ${no('expr')} && ${no('vs')} && ${NOW} > ${STARTAT} + ${K.ROUND_MS + K.DEADLINE_GRACE_MS}) || ` +
        `(${kindIs('forfeit')} && ${has('by')} && ${no('expr')} && ${no('vs')} && ` +
        `${OPPP}.exists() && ${OPPP}.child('online').val() === false && ${NOW} >= ${OPPP}.child('offlineAt').val() + ${K.FORFEIT_GRACE_MS}))`,
      kind: { '.validate': "newData.isString() && (newData.val() === 'solve' || newData.val() === 'declare' || newData.val() === 'timeout' || newData.val() === 'forfeit')" },
      at: { '.validate': `newData.isNumber() && newData.val() === ${NOW}` },
      by: { '.validate': 'newData.isString() && newData.val() === auth.uid' },
      expr: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 64' },
      vs: { '.validate': false },
      $other: { '.validate': false }
    };
    rounds[String(i)] = { startAt, result, $other: { '.validate': false } };
  }

  return {
    rooms: {
      $code: {
        // 参加者だけが部屋全体を読める。参加前の確認用に meta / players だけは認証済みなら読める（下）
        '.read': `${AUTH} && ${MEMBER}`,
        // 部屋の削除（掃除）：参加者が1人もいない部屋、または作成から24時間たった部屋。それ以外の「部屋ごとの書き込み」は子で個別に許可する
        '.write': `${AUTH} && newData.val() === null && (!data.child('players').exists() || data.child('meta').child('createdAt').val() < ${NOW} - ${K.ROOM_TTL_MS})`,
        '.validate': "newData.hasChild('meta')",
        meta: {
          '.read': AUTH,
          '.write': `${AUTH} && !data.exists() && $code.matches(/${ROOM_CODE_RE}/) && newData.child('host').val() === auth.uid && newData.parent().child('players').child(auth.uid).exists()`,
          '.validate': "newData.hasChildren(['v', 'app', 'poolHash', 'host', 'createdAt'])",
          // 2人目（ゲスト）の枠：自分の uid を、空いているときだけ（既存のゲストが退出済みなら入れ替え可）。ホスト自身は取れない
          guest: {
            '.write': `${AUTH} && newData.val() === auth.uid && auth.uid !== ${HOSTV} && (!data.exists() || !${ROOM}.child('players').child(data.val()).exists())`,
            '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 128'
          },
          v: { '.validate': 'newData.val() === 1' },
          app: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 16' },
          poolHash: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= 4294967295 && ${INT}` },
          host: { '.validate': 'newData.isString()' },
          createdAt: { '.validate': `newData.val() === ${NOW}` },
          $other: { '.validate': false }
        },
        players: {
          '.read': AUTH,
          $uid: {
            // 参加できるのは meta の host か guest の uid の本人だけ（＝2人まで）。作成時は同じ更新で書く meta も見る（newData）
            '.write': `${AUTH} && auth.uid === $uid && (newData.val() === null ? data.exists() : (data.exists() || newData.parent().parent().child('meta').child('host').val() === $uid || newData.parent().parent().child('meta').child('guest').val() === $uid))`,
            '.validate': "newData.hasChildren(['name', 'joinedAt', 'online', 'ready', 'rematch']) && " +
              "((newData.child('online').val() === true && !newData.child('offlineAt').exists()) || (newData.child('online').val() === false && newData.child('offlineAt').exists()))",
            name: { '.validate': 'newData.isString() && newData.val().length >= 1 && newData.val().length <= 10' },
            joinedAt: { '.validate': `newData.isNumber() && (data.exists() ? newData.val() === data.val() : newData.val() === ${NOW})` },
            online: { '.validate': 'newData.isBoolean()' },
            offlineAt: { '.validate': `newData.isNumber() && (newData.val() === ${NOW} || newData.val() === data.val())` },
            ready: { '.validate': 'newData.isBoolean()' },
            rematch: { '.validate': 'newData.isBoolean()' },
            $other: { '.validate': false }
          }
        },
        match: {
          '.write': `${AUTH} && ${HOST} && !${ROOM}.child('rounds').exists()`,
          '.validate': "newData.hasChild('mode') && (!newData.hasChild('seed') || newData.hasChildren(['no', 'countdownAt']))",
          no: { '.validate': `newData.isNumber() && newData.val() >= 1 && newData.val() <= 99 && ${INT}` },
          mode: { '.validate': 'newData.val() === 1 || newData.val() === 3 || newData.val() === 5' },
          seed: { '.validate': 'newData.isString() && newData.val().matches(/^[A-Za-z0-9:_-]{1,64}$/)' },
          countdownAt: { '.validate': `newData.isNumber() && (newData.val() === ${NOW} || newData.val() === data.val())` },
          $other: { '.validate': false }
        },
        rounds,
        live: {
          $uid: {
            '.write': `${AUTH} && auth.uid === $uid && (newData.val() === null || ${MEMBER})`,
            '.validate': "newData.hasChildren(['r', 'cards', 'lockUntil'])",
            r: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${lastIdx} && ${INT}` },
            cards: { '.validate': `newData.isNumber() && newData.val() >= 1 && newData.val() <= 4 && ${INT}` },
            lockUntil: {
              '.validate': `newData.isNumber() && (newData.val() === data.val() || ((!data.exists() || data.val() <= ${NOW}) && (newData.val() === 0 || (${near(K.WRONG_LOCK_MS)}))))`
            },
            $other: { '.validate': false }
          }
        },
        $other: { '.validate': false }
      }
    }
  };
}

// module.exports は断片そのもの（rules.games.tenpuzzle にそのまま入る純粋な JSON）。補助は列挙されないプロパティで付ける
const fragment = build();
for (const [k, v] of Object.entries({ build, K, ROOM_CODE_RE })) Object.defineProperty(fragment, k, { value: v, enumerable: false });
module.exports = fragment;
