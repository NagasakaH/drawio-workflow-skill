---
name: drawio-workflow
description: >-
  作業フロー（ワークフロー・業務フロー・画面遷移〜API〜ストレージ連動フロー）を、
  ユーザーに確認したレーン構成（「ユーザー操作」「画面 / UI」「バックエンド」「ストレージ (RDS / S3 / DynamoDB / SQS 等)」など）と
  指定方向（横スイムレーン / 縦スイムレーン）の draw.io 図面（.drawio XML）として作成し、各ステップで関連リソースがどう動くか（状態変化・クエリ・オブジェクト生成・イベント発火）を
  可視化した上で、ブラウザ不要の Pure Node.js (.mjs) コンバーターで .drawio.png（XML埋め込み済み・draw.io再編集可能）へ変換するスキル。
  「作業フローを図にして」「スイムレーンで画面・バックエンド・DBの動きを可視化して」「draw.ioでワークフローとRDS/S3/DynamoDBの挙動を描いてPNGにして」
  といった依頼のときに使用する。
---

# スイムレーン付き作業フロー & 関連リソース動作の可視化スキル (`drawio-workflow`)

作業フローを実行したときに **「ユーザー操作 → 画面 / UI → バックエンド → ストレージ (RDS / S3 / DynamoDB / SQS 等)」** などの各レーンがどのように連動し、各ストレージや外部リソースのデータ・状態がどう変化するかを **横方向または縦方向のスイムレーン図（`.drawio` + `.drawio.png`）** として生成する。

出力される `.drawio.png` には draw.io XML（`zTXt` チャンク `mxGraphModel`）が埋め込まれているため、画像としてそのままチャットやドキュメントに貼れるほか、draw.io で開いて再編集できる。

---

## ステップ 0: 作成前のユーザー確認（必須）

図（JSON / XML）を作り始める前に、以下の2点を**必ずユーザーに確認する**（ユーザーのプロンプトで既に明示されている項目は省略してよい）：

1. **スイムレーンの向き（`direction`）**
   - **`horizontal`（横スイムレーン）**: 上から下へレーン行が並び、左から右へ時系列ステップが進む
   - **`vertical`（縦スイムレーン）**: 左から右へレーン列が並び、上から下へ時系列ステップが進む
2. **作成するレーン一覧（`lanes`）**
   - 対象となる業務・コードベースを踏まえ、推奨レーン案を提示して過不足・名称を確認する。
   - 基本の4レーン例：
     1. `ユーザー操作`（Actor / Trigger）
     2. `画面 / UI`（Web / Mobile App）
     3. `バックエンド`（API / Lambda / Worker）
     4. `ストレージ / リソース`（RDS / S3 / DynamoDB / SQS 等）
   - 必要に応じて `管理者操作`、`外部サービス（決済 / メール / 認証IdP）`、`バッチ / 非同期ワーカー` などの追加・分割を提案する。

---

## 実行手順（ハイブリッド方式）

### 方式1: JSON定義から自動整列したスイムレーンXML＋PNGを一括生成する（推奨）

ノード数が多いフローや複数ストレージ（RDS / S3 / DynamoDB / SQS 等）が絡むフローでは、座標計算や矢印の重なり回避を自動で行う `build-workflow.mjs` を使う。同じ JSON 仕様のまま `--direction horizontal` / `--direction vertical` で縦横を切り替えられる。

```bash
SKILL=$HOME/.agents/skills/drawio-workflow

# 横スイムレーンで生成
node "$SKILL/scripts/build-workflow.mjs" \
  --spec /path/to/workflow.json \
  --direction horizontal \
  --output /path/to/workflow.drawio.png \
  --xml-out /path/to/workflow.drawio \
  --scale 2

# 縦スイムレーンで生成
node "$SKILL/scripts/build-workflow.mjs" \
  --spec /path/to/workflow.json \
  --direction vertical \
  --output /path/to/workflow-vertical.drawio.png \
  --xml-out /path/to/workflow-vertical.drawio \
  --scale 2
```

### 方式2: `.drawio` XML を直接記述・微調整して PNG / SVG に変換する

細かいカスタム配置や既存の `.drawio` ファイルを直接編集した場合は、単一ファイル完結の `drawio2png.mjs` で PNG 化する（`npm install` や `draw.io.app` 不要）。

```bash
SKILL=$HOME/.agents/skills/drawio-workflow

node "$SKILL/scripts/drawio2png.mjs" \
  /path/to/diagram.drawio \
  -o /path/to/diagram.drawio.png \
  --scale 2 --border 16 --embed-xml
```

---

## 関連リソース可視化のルール

1. **「関連リソースがどう動くか」の明示（必須）**
   - 単に「RDS」「S3」「DynamoDB」のアイコンを置くだけでなく、**その作業フローを実行したときにリソース内部で起きる変化**を必ずセットで描く：
     - **コネクタ（矢印）の種別とラベル**:
       - `type: "write"`（太い赤茶色の実線矢印）: `⑥ TX COMMIT`、`⑦ PutObject`、`INSERT / UPDATE`
       - `type: "read"`（青の破線矢印）: `④ GetItem / Lock`、`SELECT`
       - `type: "async"`（オレンジの破線矢印）: `⑧ SendMessage (Enqueue)`、`⑨ Poll / Subscribe`
       - `type: "response"`（グレーの破線矢印）: `⑩ 200 OK (order_id)`
     - **リソース状態変化ノート（`effect` / `effectTitle`）**:
       - 各ストレージノード直下に黄色いノート（`shape=note`）を配置し、具体的なテーブル名・キー・状態遷移を箇条書きする：
         - **RDS の例**: `INSERT orders (status='PAID')` / `UPDATE inventory SET stock = stock - 1`
         - **DynamoDB の例**: `GetItem: cart_id` / `UpdateItem: state = LOCKED → COMPLETED (TTL更新)`
         - **S3 の例**: `PutObject: s3://receipts/{order_id}.pdf (SSE-S3暗号化)`
         - **SQS / SNS の例**: `SendMessage: OrderConfirmedEvent` / `NotifyWorker が非同期消費`

2. **時系列フェーズバー（`phases`）とステップ番号（`step` / `① ② ③`）**
   - 横スイムレーンでは図の上部に、縦スイムレーンでは図の左側に `Phase 1: ...`, `Phase 2: ...` の見出しバーが自動配置される。各ノードに `step: "1"`（`[1]`）、各矢印に `①` `②` `③` の通し番号をつけて処理順序を一目で追えるようにする。

---

## ワークフロー作成のステップ

1. **ユーザーへ方向とレーン構成を確認する（ステップ 0）**
   - `horizontal`（横）か `vertical`（縦）か、および作成するレーン一覧（追加・削除・名称）を確認する。
2. **フローと関連リソースの整理**
   - 確定したレーンに沿って、登場する操作・画面・バックエンド処理・ストレージ（RDSテーブル、S3バケット、DynamoDBテーブル、キュー等）を時系列ステップ（`col` / `row`: `0, 1, 2...`）に割り振る。
3. **JSON仕様の作成（または XML の直接生成）**
   - JSON スキーマの詳細は [references/workflow-schema.md](references/workflow-schema.md) を参照。
   - 手書き・カスタム XML で調整する場合は [references/swimlane-xml-guide.md](references/swimlane-xml-guide.md) を参照。
   - 完全なサンプルは [examples/order-checkout-workflow.json](examples/order-checkout-workflow.json) を参照。
4. **`.drawio` + `.drawio.png` のビルドと視覚検証**
   - `build-workflow.mjs`（または `drawio2png.mjs`）を実行して `.drawio.png` を生成する。
   - 生成された `.drawio.png` を画像として読み込み（`read_file`）、ラベル切れや矢印の重なりがないか目視確認してからユーザーに提示する。
