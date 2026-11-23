# swimlane-xml-guide.md — 横スイムレーン `.drawio` XML 直接記述ガイド

`build-workflow.mjs` で生成した `.drawio` ファイルを微調整する場合や、LLM が直接 `.drawio` XML を組み立てる場合の座標・スタイル規約です。

---

## 1. 横スイムレーン（左ヘッダー＋水平レーン）の XML パターン

draw.io の標準 `swimlane;horizontal=0;startSize=165;` を使うと左側に幅 165px のヘッダー領域が作られます。
日本語のレーン名を回転させず**横書き**で読みやすく表示するため、スイムレーン本体の `value=""` は空にし、子要素として左ヘッダー領域（`x="6" y="0" width="153"`）に `text;html=1;` セルを配置します。

```xml
<!-- 横スイムレーン本体 (parent="1") -->
<mxCell id="lane_storage" value="" style="swimlane;horizontal=0;startSize=165;fillColor=#e1d5e7;strokeColor=#9673a6;swimlaneFillColor=#fcfaff;strokeWidth=1.5;" vertex="1" parent="1">
  <mxGeometry x="40" y="520" width="1180" height="280" as="geometry" />
</mxCell>

<!-- 左ヘッダー内の横書きタイトル (parent="lane_storage") -->
<mxCell id="lane_storage_hdr" value="&lt;b style=&quot;font-size:13px&quot;&gt;ストレージ / リソース&lt;/b&gt;&lt;br&gt;&lt;font color=&quot;#555555&quot; style=&quot;font-size:11px&quot;&gt;RDS / S3 / DynamoDB / SQS&lt;/font&gt;" style="text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;connectable=0;" vertex="1" parent="lane_storage">
  <mxGeometry x="6" y="0" width="153" height="280" as="geometry" />
</mxCell>
```

> **重要**: レーン内の各ノードは `parent="lane_storage"` を指定し、座標 `(x, y)` は**レーン左上からの相対座標**（`x >= 190`）で指定します。

---

## 2. ストレージ・クラウドリソースの主要 XML スニペット

### Aurora / RDS (Cylinder3 + トランザクション状態変化ノート)
```xml
<mxCell id="st_rds" value="&lt;b&gt;Aurora PostgreSQL&lt;/b&gt;&lt;br&gt;orders / inventory" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=11;fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;" vertex="1" parent="lane_storage">
  <mxGeometry x="650" y="25" width="145" height="82" as="geometry" />
</mxCell>
<mxCell id="st_rds_effect" value="&lt;b&gt;RDS トランザクション&lt;/b&gt;&lt;br&gt;• INSERT orders (status=&apos;PAID&apos;)&lt;br&gt;• UPDATE inventory SET stock = stock - 1" style="shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=12;fillColor=#ffffc0;strokeColor=#b59b00;fontSize=11;align=left;spacingLeft=6;shadow=1;" vertex="1" parent="lane_storage">
  <mxGeometry x="622" y="120" width="200" height="75" as="geometry" />
</mxCell>
```

### Amazon S3 / DynamoDB / SQS / Lambda / API Gateway
```xml
<!-- Amazon S3 -->
<mxCell id="st_s3" value="&lt;b&gt;Amazon S3 (Receipts)&lt;/b&gt;" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#277116;strokeColor=#ffffff;" vertex="1" parent="lane_storage">
  <mxGeometry x="692" y="220" width="60" height="60" as="geometry" />
</mxCell>

<!-- Amazon DynamoDB -->
<mxCell id="st_dynamo" value="&lt;b&gt;DynamoDB (Sessions)&lt;/b&gt;" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#C925D1;strokeColor=#ffffff;" vertex="1" parent="lane_storage">
  <mxGeometry x="442" y="25" width="60" height="60" as="geometry" />
</mxCell>

<!-- Amazon SQS -->
<mxCell id="st_sqs" value="&lt;b&gt;Amazon SQS (Events)&lt;/b&gt;" style="outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;fillColor=#D9A741;strokeColor=#ffffff;" vertex="1" parent="lane_storage">
  <mxGeometry x="942" y="25" width="60" height="60" as="geometry" />
</mxCell>
```

---

## 3. アイコン下部ラベルと矢印が重ならないための鉄則

`verticalLabelPosition=bottom;verticalAlign=top;` を持つアイコン（`umlActor`, `mxgraph.aws4.resourceIcon`, `mxgraph.kubernetes.icon2` 等）は、アイコン本体の下（`+38px`）にテキストラベルが描画されます。
そのアイコンから**下向きに矢印を出す場合**は、スタイルに以下を指定してラベルの下から矢印を開始させてください：

```
exitX=0.5;exitY=1;exitDx=0;exitDy=38;exitPerimeter=0;
```

同様に、下からアイコンへ矢印が入る場合は以下を指定します：

```
entryX=0.5;entryY=1;entryDx=0;entryDy=38;entryPerimeter=0;
```

---

## 4. `horizontal` と `vertical` の命名と「90° 回転」の落とし穴

`swimlane` の `horizontal` は**ヘッダーの向き**を表すフラグで、レーンの並び方向ではない。名前の罠に注意する。

| スキルの `--direction` | `swimlane` のスタイル | ヘッダーの位置 | 見出しの出し方 |
|---|---|---|---|
| `horizontal`（横レーン行） | `horizontal=0` | 各レーンの左端 | **空の `value`** ＋ `text;html=1;` 子セル（下記 §1） |
| `vertical`（縦レーン列） | `horizontal=1` | 各レーンの上端 | `value` に直接書いてよい（回転しない） |

`horizontal=0` の `swimlane` に日本語の `value` を入れるとラベルが 90° 回転して描画され、日本語が縦読みに見えて非常に読みにくい。**回転するレーンに直接 `value` を置かない**のが鉄則で、`build-workflow.mjs` はこの方式で生成する。

---

## 5. エッジラベル（特に長い日本語ラベル）の安全な書き方

エッジの `value` に直接ラベルを書くと、ラベルは折返し幅を持たず（描画実測で `width=0`／`height=0`）改行されない1本の長文になる。日本語の長いラベルは他のレーンや図形を横切り、線を消して見える。必ず幅を持つ子セルとして出す。

```xml
<!-- エッジ本体は value を空にする -->
<mxCell id="e2" value="" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;exitX=1;exitY=0.5;" edge="1" parent="1" source="n1" target="n2">
  <mxGeometry relative="1" as="geometry" />
</mxCell>

<!-- ラベルは子セルとして、折返し幅 width と高さ height を持つ -->
<mxCell id="e2_lbl" value="② 同一トランザクション内で注文本体と明細行を確定" style="edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;fontSize=11;labelBackgroundColor=#ffffff;whiteSpace=wrap;" vertex="1" connectable="0" parent="e2">
  <mxGeometry x="-0.1" y="0" relative="1" as="geometry" width="132" height="45">
    <mxPoint x="-66" y="-50" as="offset" />
  </mxGeometry>
</mxCell>
```

- `width` / `height` は**折返し後の実測高さを収める**（この例では幅 132px で 3 行＝約 39px なので 45px）。高さが足りないと文字が箱の下へはみ出して線にかかる。
- `mxGeometry` の `x`（-1〜1）が線上の基準点、`as="offset"` の `mxPoint` が**その点からラベル箱の左上までのずれ**である。中心を置きたい位置を `dx, dy` として表すなら `x座標 = dx - width/2`、`y座標 = dy - height/2` を書く（ここを間違えるとラベルが線の上に残る）。
- `labelBackgroundColor=#ffffff` は文字幅 + 3px の白い箱を描く。衝突検査はこの白い箱の実際のサイズで行う。
- `whiteSpace=wrap` を付け忘れると `width` を持っても折り返さない。
- 実際に描画される枠は `node scripts/check-layout.mjs <図面>` で測れる（折返さないラベルは `mxText` の `bounds` より広く描かれるため、`bounds` をそのまま衝突判定に使ってはいけない）。
