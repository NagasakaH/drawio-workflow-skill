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
