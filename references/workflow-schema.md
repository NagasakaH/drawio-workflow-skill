# workflow-schema.md — `build-workflow.mjs` JSON スキーマリファレンス

`scripts/build-workflow.mjs` に渡す JSON ファイルの構造リファレンスです。

---

## トップレベル構造

```json
{
  "title": "図全体のタイトル",
  "subtitle": "サブタイトル（対象システムやフローの概要）",
  "direction": "horizontal",
  "colPitch": 250,
  "phases": [ ... ],
  "lanes": [ ... ],
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `title` | `string` | Yes | 図上部のタイトルバナーに表示するメインタイトル |
| `subtitle` | `string` | No | タイトルバナー2行目の説明文 |
| `direction` | `"horizontal" \| "vertical"` | No | スイムレーンの向き。`horizontal`（横・デフォルト）または `vertical`（縦）。CLI の `--direction` で上書き可能 |
| `colPitch` | `number` | No | 横スイムレーン時の1ステップ列あたりの横幅px（デフォルト: `250`） |
| `phases` | `Array<Phase>` | No | 横モード時は上部、縦モード時は左側に表示するフェーズ見出しバー |
| `lanes` | `Array<Lane>` | No | スイムレーン定義（省略時は `user`, `screen`, `backend`, `storage` の4レーン） |
| `nodes` | `Array<Node>` | Yes | 各レーン・各ステップ（`col` または `row`）に配置するノード（操作・画面・API・DB/S3等） |
| `edges` | `Array<Edge>` | Yes | ノード間の遷移・API呼び出し・データ読み書きコネクタ |

---

## 1. `phases`（上部フェーズバー）

```json
{
  "col": 0,
  "fromCol": 0,
  "toCol": 1,
  "label": "Phase 1: 入力・バリデーション",
  "fillColor": "#e8f0fe",
  "strokeColor": "#6c8ebf"
}
```
- 単一列の場合は `"col": 0`、複数列にまたがるフェーズの場合は `"fromCol": 0, "toCol": 1` を指定できます。

---

## 2. `lanes`（スイムレーン定義）

省略時は以下の4レーンが自動生成されます。カスタムレーンを追加・変更する場合のみ指定してください。

| `id` | デフォルト `title` | 用途 |
|---|---|---|
| `user` | `ユーザー操作` | アクター（購入者・管理者・外部システム）と操作トリガー |
| `screen` | `画面 / フロントエンド` | Web画面・モバイル画面・モーダル・UI状態変化 |
| `backend` | `バックエンド` | API Gateway・Controller・Lambda・ECS/EKS・判定ロジック |
| `storage` | `ストレージ / リソース` | RDS (PostgreSQL/MySQL)・DynamoDB・S3・SQS・SNS・Redis 等 |

---

## 3. `nodes`（ノード & リソース状態変化定義）

```json
{
  "id": "st_rds",
  "lane": "storage",
  "col": 2,
  "kind": "rds",
  "step": "6",
  "label": "Aurora PostgreSQL",
  "subtitle": "orders / inventory",
  "effectTitle": "RDS トランザクション",
  "effect": [
    "INSERT orders (status='PAID')",
    "INSERT order_items (明細行)",
    "UPDATE inventory SET stock = stock - 1"
  ]
}
```

### 利用可能な `kind` 一覧

| カテゴリ | `kind` | 描画される draw.io シェイプ / アイコン |
|---|---|---|
| **ユーザー操作** | `actor` | UML アクター（人型アイコン + 下部ラベル） |
| **ユーザー操作** | `action` | 角丸アクションカード（水色） |
| **画面 / UI** | `screen` | 画面ボックス（緑系・角丸・シャドウ付き） |
| **画面 / UI** | `modal` | 二重枠モーダル / ダイアログボックス |
| **バックエンド** | `process` | 汎用処理ボックス（黄色系・角丸） |
| **バックエンド** | `service` | サービス処理ボックス（左右縦線入り `shape=process`） |
| **バックエンド** | `decision` | 条件分岐ひし形（`rhombus`） |
| **バックエンド** | `apigw` | AWS API Gateway 公式ステンシルアイコン |
| **バックエンド** | `lambda` | AWS Lambda 公式ステンシルアイコン |
| **バックエンド** | `k8s` | Kubernetes Pod 公式ステンシルアイコン |
| **バックエンド** | `ecs` | AWS ECS 公式ステンシルアイコン |
| **バックエンド** | `external` | 外部クラウド / 外部API（`shape=cloud`） |
| **ストレージ** | `rds` | DBシリンダー（`shape=cylinder3`） |
| **ストレージ** | `dynamodb` | Amazon DynamoDB 公式ステンシルアイコン |
| **ストレージ** | `s3` | Amazon S3 公式ステンシルアイコン |
| **ストレージ** | `sqs` | Amazon SQS 公式ステンシルアイコン |
| **ストレージ** | `sns` | Amazon SNS 公式ステンシルアイコン |
| **ストレージ** | `redis` | Amazon ElastiCache (Redis) 公式ステンシルアイコン |
| **補足メモ** | `note` | ノート図形（`shape=note`） |

### リソース動作の可視化プロパティ（`effect` / `effectTitle`）
- `effect` に文字列の配列を指定すると、そのノードの直下（`"effectPosition": "right"` 指定時は右側）に黄色いノート図形（`shape=note`）が自動配置され、テーブル行の追加・ステータス更新・S3オブジェクト生成・キュー投入などの具体的なリソース挙動が表示されます。

---

## 4. `edges`（コネクタ・データフロー定義）

```json
{
  "from": "b_order_lambda",
  "to": "st_rds",
  "type": "write",
  "label": "⑥ TX COMMIT"
}
```

### エッジの `type` 一覧

| `type` | スタイル・色 | 用途 |
|---|---|---|
| `flow` | 黒/濃灰の実線 + 標準矢印 | 画面遷移・ボタン押下・同期APIリクエスト |
| `write` | 赤茶色（`#b85450`）の太実線 + 塗りつぶしブロック矢印 | DBへの `INSERT`/`UPDATE`/`DELETE`、S3への `PutObject` |
| `read` | 青（`#0066CC`）の破線 + オープン矢印 | DBからの `SELECT`、DynamoDB `GetItem`、S3 `GetObject` |
| `async` | オレンジ（`#d79b00`）の破線 + 標準矢印 | SQS `SendMessage` / `Poll`、SNS Publish、非同期ジョブ起動 |
| `response` | グレー（`#666666`）の細破線 + オープン矢印 | APIレスポンス返却（`200 OK` 等） |

### ラベルの折返しと位置（長い日本語ラベル用）

デフォルトではラベルの折返し幅と位置を自動計算する。線や図形に当たる場合は以下で上書きできる。

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `labelWidth` | `number` | 自動（84〜168px） | ラベル箱の折返し幅px。語の途中で折り返したくない語があるときは広めにする |
| `labelPosition` | `"auto" \| "center" \| "left" \| "right"` | `"auto"` | 線の進行方向に対して左側／右側に寄せる。`center` は線の上に白い背景で重なる（最終手段） |
| `labelRatio` | `number`（-1〜1） | 自動 | 線上の基準点。`-1` が始点、`0` が中央、`1` が終点 |

```json
{ "from": "st_sqs", "to": "st_notify", "type": "async", "label": "⑨ Poll: OrderConfirmedEvent", "labelWidth": 132, "labelPosition": "left", "labelRatio": -0.34 }
```

`node scripts/check-layout.mjs <図面>` を実行すると、実際に描画されるラベル枠を測って「線と文字」「文字とノード」「文字とレーン枠」の重なりを指摘する（終了コード 0 が正常）。`build-workflow.mjs` も生成後に同じ検査を自動で行う。
