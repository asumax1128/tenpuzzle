# テンパズル 対戦（v1.2 分割 4-2）Firebase ルール

仕様の正本は `versus-design-v12.md`。このフォルダのルールは **games/tenpuzzle 配下だけ**を追加する断片で、既存ゲーム（factor / iroyomi 等）のルールには触れない。**デプロイは行わない**（福山が候補を確認してからコンソールで手動で公開する）。

## ファイル

| ファイル | 役割 |
|---|---|
| `firebase/tenpuzzle-rules.cjs` | `rules.games.tenpuzzle` に入る断片（純粋な JSON）。`build({now})` で時計の式を差し替えられる（テスト用） |
| `scripts/prepare-tenpuzzle-rules.cjs` | 現在のコンソールルール JSON に断片を合成して「候補」を作る |
| `tests/test_tenpuzzle_rules_v12.js` | ルールの単体テスト（Realtime Database エミュレータ） |
| `tests/test_tenpuzzle_prepare_rules_v12.js` | 合成スクリプトのテスト（エミュレータ不要） |
| `tests/fixtures/console-rules-sample.json` | 合成サンプル（**実物のコンソールルールではない**。テスト専用） |
| `firebase.json` / `firebase/emulator-base-rules.json` | エミュレータ用の設定（本番には使わない） |

## テストの実行

```
npm install            # firebase-tools（エミュレータ。Java が必要）・@firebase/rules-unit-testing・firebase
npm run test:rules     # エミュレータ上でルールを検証（本番 DB には接続しない）
npm run test:prepare   # 合成スクリプトの検証
npm run test:solo      # ソロ側（v1.2 CORE 含む）の回帰テスト
```

## 候補ルールの作り方（福山）

```
# 1) Firebase コンソールの「現在のルール」を JSON で保存する（例: console-rules.json。{"rules": {...}} の形）
# 2) 候補を作る（既存ルールが1つでも変わっていれば assert で停止。対象ブランチが既にあれば停止）
node scripts/prepare-tenpuzzle-rules.cjs --current console-rules.json
#    → ブランチ rules/tenpuzzle-v12-candidate に firebase/candidates/database.rules.tenpuzzle-candidate.json をコミット
#    --branch <名前>  ブランチ名を変える　／　--out <パス>  出力先を変える　／　--no-git  ブランチを作らず候補だけ書く
# 3) 候補を確認してから、コンソールで手動で公開する（このスクリプトはデプロイしない）
```

## 設計書 4.1 からの変更・追加（4-2 で確定。設計書に反映してください）

1. **`meta.guest`**：Realtime Database のルールには子の数を数える式が無いため、2人目（ゲスト）の uid を `meta.guest` に持つ。参加者は `meta.host` と `meta.guest` の2人だけ。3人目は guest 枠を取れず、`players` にも入れない。ゲストが退出済みなら、別の人が guest 枠に入れ替われる。
2. **`vs` なし**：相手の uid が host/guest から決まるので、forfeit の result に `vs` を付けない（付けると拒否）。
3. **`startAt` / `lockUntil` は ± 2000ms の許容幅**：クライアントは `ServerValue.TIMESTAMP` に時間を足せず、「now + 3000」ちょうどの値は書けないため。`result.at`・`createdAt`・`countdownAt`・`joinedAt`・`offlineAt` は `now` と厳密一致。
4. **`match.endedBy` は作らない**：不戦勝は `rounds/<i>/result`（kind: forfeit）だけで表す（reducer が結果の列から導出する）。
5. **再戦の `rounds` 一括削除**：ホストが、ホストとゲスト両方の `rematch=true` のときだけ、`rounds` 全体を削除できる（`match` はその後に新しい番号で書く）。
6. **次ラウンドの `startAt`** は、前ラウンドの result と**同じ更新**でしか書けない（単独・後からの書き込みは拒否）。
7. **部屋の削除**：参加者が1人もいない部屋は認証済みなら誰でも、作成から24時間たった部屋は参加者が残っていても削除できる（掃除）。
8. **読み取り**：参加者は部屋全体を読める。参加前の確認用に `meta` と `players` だけは認証済みなら読める。`rooms` の一覧は読めない。
