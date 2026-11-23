#!/usr/bin/env node
/**
 * build-workflow.mjs
 * Generates a horizontal or vertical multi-lane swimlane workflow diagram (.drawio XML + .drawio.png)
 * visualizing User Operations -> Screen/UI -> Backend -> Storage (RDS, S3, DynamoDB, SQS, Redis, etc.)
 * and how related storage/cloud resources behave at each step.
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { convertXmlToPng, convertXmlToSvg } from "./drawio2png.mjs";
import { inspectDiagram, measureDiagram } from "./check-layout.mjs";

function escapeXml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DEFAULT_LANES = [
  {
    id: "user",
    title: "ユーザー操作",
    subtitle: "Actor / User Action",
    headerFill: "#dae8fc",
    strokeColor: "#6c8ebf",
    bodyFill: "#f8fbff",
  },
  {
    id: "screen",
    title: "画面 / フロントエンド",
    subtitle: "UI / Screen / State",
    headerFill: "#d5e8d4",
    strokeColor: "#82b366",
    bodyFill: "#f9fdf9",
  },
  {
    id: "backend",
    title: "バックエンド",
    subtitle: "API / Lambda / Worker",
    headerFill: "#ffe6cc",
    strokeColor: "#d79b00",
    bodyFill: "#fffdf9",
  },
  {
    id: "storage",
    title: "ストレージ / リソース",
    subtitle: "RDS / S3 / DynamoDB / SQS",
    headerFill: "#e1d5e7",
    strokeColor: "#9673a6",
    bodyFill: "#fcfaff",
  },
];

const KIND_STYLES = {
  // User / Actor shapes
  actor: {
    width: 50,
    height: 75,
    isIcon: true,
    style:
      "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;",
  },
  action: {
    width: 170,
    height: 64,
    style:
      "rounded=1;whiteSpace=wrap;html=1;arcSize=20;fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;",
  },

  // Screen / UI shapes
  screen: {
    width: 180,
    height: 70,
    style:
      "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#d5e8d4;strokeColor=#82b366;shadow=1;",
  },
  modal: {
    width: 175,
    height: 66,
    style:
      "shape=ext;double=1;rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#82b366;shadow=1;",
  },

  // Backend / Process shapes
  process: {
    width: 175,
    height: 68,
    style:
      "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;shadow=1;",
  },
  service: {
    width: 180,
    height: 70,
    style:
      "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;size=0.08;rounded=1;fillColor=#ffe6cc;strokeColor=#d79b00;shadow=1;",
  },
  decision: {
    width: 165,
    height: 82,
    style:
      "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;shadow=1;",
  },
  apigw: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;fillColor=#E7157B;strokeColor=#ffffff;",
  },
  lambda: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;strokeColor=#ffffff;",
  },
  k8s: {
    width: 58,
    height: 58,
    isIcon: true,
    style:
      "html=1;dashed=0;fillColor=#2875E2;strokeColor=#ffffff;shape=mxgraph.kubernetes.icon2;prIcon=pod;verticalLabelPosition=bottom;verticalAlign=top;align=center;",
  },
  ecs: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ecs;fillColor=#ED7100;strokeColor=#ffffff;",
  },
  external: {
    width: 175,
    height: 85,
    style:
      "ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;shadow=1;",
  },

  // Storage / Resource shapes
  rds: {
    width: 145,
    height: 82,
    style:
      "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=11;fillColor=#dae8fc;strokeColor=#6c8ebf;shadow=1;",
  },
  s3: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;fillColor=#277116;strokeColor=#ffffff;",
  },
  dynamodb: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;fillColor=#C925D1;strokeColor=#ffffff;",
  },
  sqs: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sqs;fillColor=#D9A741;strokeColor=#ffffff;",
  },
  sns: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.sns;fillColor=#CC2264;strokeColor=#ffffff;",
  },
  redis: {
    width: 60,
    height: 60,
    isIcon: true,
    style:
      "outlineConnect=0;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.elasticache;fillColor=#C925D1;strokeColor=#ffffff;",
  },
  note: {
    width: 175,
    height: 74,
    style:
      "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;fillColor=#ffffc0;strokeColor=#999900;align=left;spacingLeft=8;",
  },
};

const EDGE_TYPE_STYLES = {
  flow: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;strokeWidth=2;strokeColor=#333333;",
  write:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=2.2;strokeColor=#b85450;",
  read: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;html=1;endArrow=open;endFill=0;strokeWidth=1.8;strokeColor=#0066CC;",
  async:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;dashPattern=6 4;html=1;endArrow=classic;strokeWidth=2;strokeColor=#d79b00;",
  response:
    "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;dashed=1;html=1;endArrow=open;strokeWidth=1.5;strokeColor=#666666;",
};

function formatNodeHtmlLabel(node) {
  const stepBadge = node.step ? `[${node.step}] ` : "";
  const title = `${stepBadge}${node.label || node.title || node.id}`;
  const lines = [`<b>${escapeXml(title)}</b>`];
  if (node.subtitle || node.detail) {
    lines.push(
      `<font color="#444444">${escapeXml(node.subtitle || node.detail)}</font>`
    );
  }
  return lines.join("<br>");
}

function formatEffectHtmlLabel(node) {
  const effectTitle = node.effectTitle || "リソース状態変化";
  const ops = Array.isArray(node.effect)
    ? node.effect
    : typeof node.effect === "string"
      ? [node.effect]
      : Array.isArray(node.operations)
        ? node.operations
        : [];
  if (ops.length === 0) return null;

  const lines = [`<b>${escapeXml(effectTitle)}</b>`];
  for (const op of ops) {
    lines.push(`• ${escapeXml(op)}`);
  }
  return lines.join("<br>");
}

function getNodeStepIndex(node) {
  return Number(node.col ?? node.row ?? node.stepIndex ?? 0);
}

function measureNodeMeta(n) {
  const preset = KIND_STYLES[n.kind || "process"] || KIND_STYLES.process;
  const nw = Number(n.width || preset.width);
  const nh = Number(n.height || preset.height);
  const iconLabelExtra = preset.isIcon ? 42 : 0;
  const effectText = formatEffectHtmlLabel(n);
  const effectLinesCount = Array.isArray(n.effect)
    ? n.effect.length + 1
    : Array.isArray(n.operations)
      ? n.operations.length + 1
      : effectText
        ? 2
        : 0;
  const effW = Number(n.effectWidth || 200);
  const effH = Math.max(58, effectLinesCount * 18 + 16);

  n.__preset = preset;
  n.__w = nw;
  n.__h = nh;
  n.__iconExtra = iconLabelExtra;
  n.__effectText = effectText;
  n.__effectW = effW;
  n.__effectH = effH;
  n.__totalBlockH = nh + iconLabelExtra + (effectText ? effH + 10 : 0);
  n.__totalBlockW = Math.max(nw, effectText ? effW : 0, preset.isIcon ? 150 : nw);
}

function exitBottomStyle(layout, xRatio = 0.5) {
  if (layout.node.__preset?.isIcon) {
    return `exitX=${xRatio};exitY=1;exitDx=0;exitDy=${layout.node.__iconExtra - 4};exitPerimeter=0;`;
  }
  return `exitX=${xRatio};exitY=1;`;
}

function entryBottomStyle(layout, xRatio = 0.5) {
  if (layout.node.__preset?.isIcon) {
    return `entryX=${xRatio};entryY=1;entryDx=0;entryDy=${layout.node.__iconExtra - 4};entryPerimeter=0;`;
  }
  return `entryX=${xRatio};entryY=1;`;
}

/**
 * Generates horizontal swimlanes (lanes stacked top-to-bottom, steps flowing left-to-right).
 */
function generateHorizontalWorkflowXml(spec, placementState, out, measured) {
  const title = spec.title || "システム作業フロー & リソース動作図";
  const subtitle =
    spec.subtitle ||
    "ユーザー操作 → 画面 → バックエンド → ストレージ (RDS / S3 / DynamoDB)";
  const lanesInput =
    Array.isArray(spec.lanes) && spec.lanes.length > 0 ? spec.lanes : DEFAULT_LANES;
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const phases = Array.isArray(spec.phases) ? spec.phases : [];

  const leftMargin = 40;
  const topMargin = 25;
  const headerWidth = 165;
  const colPitch = spec.colPitch || 250;
  const colLeftPad = 35;

  let maxCol = 0;
  for (const n of nodes) {
    const c = getNodeStepIndex(n);
    if (c > maxCol) maxCol = c;
  }
  for (const p of phases) {
    const c = Number(p.toCol ?? p.col ?? p.row ?? 0);
    if (c > maxCol) maxCol = c;
  }
  const colCount = Math.max(1, maxCol + 1);
  const laneWidth = headerWidth + colLeftPad * 2 + colCount * colPitch;

  const laneMap = new Map();
  lanesInput.forEach((l, idx) => {
    laneMap.set(l.id, {
      ...DEFAULT_LANES[idx % DEFAULT_LANES.length],
      ...l,
      index: idx,
      cellsByCol: new Map(),
    });
  });

  for (const node of nodes) {
    measureNodeMeta(node);
    const lane = laneMap.get(node.lane) || laneMap.values().next().value;
    const col = getNodeStepIndex(node);
    if (!lane.cellsByCol.has(col)) {
      lane.cellsByCol.set(col, []);
    }
    lane.cellsByCol.get(col).push(node);
  }

  const titleBannerHeight = 56;
  const phaseBarHeight = phases.length > 0 ? 34 : 0;
  let currentY =
    topMargin + titleBannerHeight + 14 + (phaseBarHeight > 0 ? phaseBarHeight + 10 : 0);

  const nodeLayoutMap = new Map();
  const effectCells = [];

  for (const lane of laneMap.values()) {
    let maxColHeight = 145;

    for (const [, colNodes] of lane.cellsByCol.entries()) {
      let hSum = 28;
      for (let idx = 0; idx < colNodes.length; idx++) {
        const n = colNodes[idx];
        const effectExtra =
          n.__effectText && n.effectPosition !== "right" ? n.__effectH + 14 : 0;
        const interNodeGap = idx < colNodes.length - 1 ? 48 : 24;
        hSum += n.__h + n.__iconExtra + effectExtra + interNodeGap;
      }
      if (hSum > maxColHeight) maxColHeight = hSum;
    }

    lane.y = currentY;
    lane.height = Math.max(Number(lane.minHeight || 150), maxColHeight);

    for (const [col, colNodes] of lane.cellsByCol.entries()) {
      const colCenterX = headerWidth + colLeftPad + col * colPitch + colPitch / 2;
      let curNodeY = 24;
      if (colNodes.length === 1 && !colNodes[0].__effectText) {
        const single = colNodes[0];
        curNodeY = Math.max(
          20,
          Math.round((lane.height - (single.__h + single.__iconExtra)) / 2)
        );
      }

      for (let idx = 0; idx < colNodes.length; idx++) {
        const n = colNodes[idx];
        const nx = Math.round(colCenterX - n.__w / 2);
        const ny = curNodeY;
        const interNodeGap = idx < colNodes.length - 1 ? 48 : 24;

        nodeLayoutMap.set(n.id, {
          node: n,
          lane,
          col,
          stackIndex: idx,
          stackCount: colNodes.length,
          relX: nx,
          relY: ny,
          absX: leftMargin + nx,
          absY: lane.y + ny,
          width: n.__w,
          height: n.__h,
          centerX: leftMargin + nx + n.__w / 2,
          centerY: lane.y + ny + n.__h / 2,
          colCenterX: leftMargin + colCenterX,
        });

        if (n.__effectText) {
          const effW = n.__effectW;
          const effH = n.__effectH;
          const isRight = n.effectPosition === "right";
          const effX = isRight
            ? nx + n.__w + 18
            : Math.round(colCenterX - effW / 2);
          const effY = isRight ? ny : ny + n.__h + n.__iconExtra + 10;

          effectCells.push({
            id: `${n.id}_effect`,
            parentId: `lane_${lane.id}`,
            value: n.__effectText,
            x: effX,
            y: effY,
            absX: leftMargin + effX,
            absY: lane.y + effY,
            width: effW,
            height: effH,
          });

          curNodeY = isRight
            ? ny + Math.max(n.__h + n.__iconExtra, effH) + interNodeGap
            : effY + effH + interNodeGap;
        } else {
          curNodeY = ny + n.__h + n.__iconExtra + interNodeGap;
        }
      }
    }

    currentY += lane.height;
  }

  const labelObstacles = collectLabelObstacles(nodeLayoutMap, effectCells);
  for (const lane of laneMap.values()) {
    labelObstacles.push(laneBorderObstacle(leftMargin, lane.y - 1, laneWidth, 2));
    labelObstacles.push(
      laneBorderObstacle(leftMargin, lane.y + lane.height - 1, laneWidth, 2)
    );
  }
  let labelBounds = {
    x: leftMargin,
    y: topMargin,
    w: laneWidth,
    h: currentY + 16 - topMargin,
  };
  if (measured) applyMeasuredLayout(labelObstacles, labelBounds, measured);

  const xmlLines = [];
  xmlLines.push(`<mxfile host="drawio-workflow-skill" version="1.1.0">`);
  xmlLines.push(`  <diagram id="workflow-1" name="${escapeXml(title)}">`);
  xmlLines.push(
    `    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" shadow="0">`
  );
  xmlLines.push(`      <root>`);
  xmlLines.push(`        <mxCell id="0" />`);
  xmlLines.push(`        <mxCell id="1" parent="0" />`);

  // Title Banner
  const titleHtml = `<b style="font-size:17px">${escapeXml(title)}</b><br><font color="#555555">${escapeXml(subtitle)}</font>`;
  xmlLines.push(
    `        <mxCell id="title_banner" value="${escapeXml(titleHtml)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;arcSize=14;" vertex="1" parent="1">`
  );
  xmlLines.push(
    `          <mxGeometry x="${leftMargin}" y="${topMargin}" width="${laneWidth}" height="${titleBannerHeight}" as="geometry" />`
  );
  xmlLines.push(`        </mxCell>`);
  labelObstacles.push({ x: leftMargin, y: topMargin, w: laneWidth, h: titleBannerHeight });

  // Phase Bar
  if (phases.length > 0) {
    const phaseY = topMargin + titleBannerHeight + 10;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const fromCol = Number(p.fromCol ?? p.col ?? p.row ?? i);
      const toCol = Number(p.toCol ?? fromCol);
      const px = leftMargin + headerWidth + colLeftPad + fromCol * colPitch + 6;
      const pw = (toCol - fromCol + 1) * colPitch - 12;
      const fill = p.fillColor || "#eef4fa";
      const stroke = p.strokeColor || "#99b2cc";
      const labelHtml = `<b>${escapeXml(p.label || p.title || `Step ${i + 1}`)}</b>`;
      xmlLines.push(
        `        <mxCell id="phase_${i}" value="${escapeXml(labelHtml)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};fontSize=12;arcSize=20;" vertex="1" parent="1">`
      );
      xmlLines.push(
        `          <mxGeometry x="${px}" y="${phaseY}" width="${pw}" height="${phaseBarHeight}" as="geometry" />`
      );
      labelObstacles.push({ x: px, y: phaseY, w: pw, h: phaseBarHeight });
      xmlLines.push(`        </mxCell>`);
    }
  }

  // Horizontal Swimlanes
  for (const lane of laneMap.values()) {
    const laneCellId = `lane_${lane.id}`;
    const laneStyle = `swimlane;horizontal=0;startSize=${headerWidth};fillColor=${lane.headerFill};strokeColor=${lane.strokeColor};swimlaneFillColor=${lane.bodyFill};strokeWidth=1.5;`;
    xmlLines.push(
      `        <mxCell id="${laneCellId}" value="" style="${laneStyle}" vertex="1" parent="1">`
    );
    xmlLines.push(
      `          <mxGeometry x="${leftMargin}" y="${lane.y}" width="${laneWidth}" height="${lane.height}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);

    const hdrHtml = `<b style="font-size:13px">${escapeXml(lane.title)}</b>${
      lane.subtitle
        ? `<br><font color="#555555" style="font-size:11px">${escapeXml(lane.subtitle)}</font>`
        : ""
    }`;
    xmlLines.push(
      `        <mxCell id="${laneCellId}_hdr" value="${escapeXml(hdrHtml)}" style="text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;connectable=0;" vertex="1" parent="${laneCellId}">`
    );
    xmlLines.push(
      `          <mxGeometry x="6" y="0" width="${headerWidth - 12}" height="${lane.height}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);
  }

  // Nodes & Effects
  emitNodesAndEffectsXml(xmlLines, nodeLayoutMap, effectCells);

  // Edges
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeId = e.id || `edge_${i + 1}`;
    const src = nodeLayoutMap.get(e.from || e.source);
    const trg = nodeLayoutMap.get(e.to || e.target);
    if (!src || !trg) continue;

    const typeKey = (e.type || "flow").toLowerCase();
    let style = e.style || EDGE_TYPE_STYLES[typeKey] || EDGE_TYPE_STYLES.flow;
    if (e.color) style += `strokeColor=${e.color};`;

    let portStyle = "";
    const autoWaypoints = Array.isArray(e.waypoints) ? [...e.waypoints] : [];

    if (!style.includes("exitX=") && e.exitX == null) {
      const dCol = trg.col - src.col;
      const dLane = trg.lane.index - src.lane.index;

      if (dCol === 0 && (dLane > 0 || (dLane === 0 && trg.stackIndex > src.stackIndex))) {
        if (dLane > 0 && trg.stackIndex > 0) {
          portStyle = "exitX=0;exitY=0.75;entryX=0;entryY=0.5;";
          if (autoWaypoints.length === 0) {
            const sideX = Math.round(src.colCenterX - colPitch * 0.44);
            autoWaypoints.push(
              { x: sideX, y: Math.round(src.absY + src.height * 0.75) },
              { x: sideX, y: Math.round(trg.centerY) }
            );
          }
        } else {
          portStyle = `${exitBottomStyle(src, 0.5)}entryX=0.5;entryY=0;`;
        }
      } else if (
        dCol === 0 &&
        (dLane < 0 || (dLane === 0 && trg.stackIndex < src.stackIndex))
      ) {
        portStyle = `exitX=0.5;exitY=0;${entryBottomStyle(trg, 0.5)}`;
      } else if (dLane === 0 && dCol > 0) {
        portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
      } else if (dLane === 0 && dCol < 0) {
        portStyle = "exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
      } else if (dCol > 0 && dLane > 0) {
        const obstacleAtTargetCol = src.lane.cellsByCol.has(trg.col);
        if (obstacleAtTargetCol) {
          portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
          if (autoWaypoints.length === 0) {
            const boundaryX = Math.round(src.colCenterX + colPitch * 0.44);
            autoWaypoints.push(
              { x: boundaryX, y: Math.round(src.centerY) },
              { x: boundaryX, y: Math.round(trg.centerY) }
            );
          }
        } else {
          portStyle = "exitX=1;exitY=0.5;entryX=0.5;entryY=0;";
        }
      } else if (dCol > 0 && dLane < 0) {
        portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
      } else if (dCol < 0 && dLane > 0) {
        portStyle = `${exitBottomStyle(src, 0.5)}entryX=1;entryY=0.5;`;
      } else if (dCol < 0 && dLane < 0) {
        portStyle = "exitX=0.5;exitY=0;entryX=1;entryY=0.5;";
      }
    } else {
      if (e.exitX != null) portStyle += `exitX=${e.exitX};exitY=${e.exitY ?? 0.5};`;
      if (e.entryX != null) portStyle += `entryX=${e.entryX};entryY=${e.entryY ?? 0.5};`;
    }

    const labelInfo = resolveEdgeLabelLayout(
      e,
      src,
      trg,
      autoWaypoints,
      labelObstacles,
      labelBounds,
      src.lane.width ? Math.round(src.lane.width - 24) : null,
      placementState ? placementState.get(edgeId)?.tried : null,
      measured ? measured.edgePathsById.get(edgeId) : null
    );
    if (out && labelInfo) {
      out.placements.set(edgeId, { key: labelInfo.key, rect: labelInfo.rect });
    }
    emitEdgeXml(
      xmlLines,
      edgeId,
      e.label || "",
      style + portStyle,
      src.node.id,
      trg.node.id,
      autoWaypoints,
      labelInfo,
      // 選んだ基準点（線の何割地点か）を実際にも書き出す。ここを既定値のままだと
      // offset だけ候補用になり、ラベルが別地点へずれて線に乗る。
      labelInfo
        ? labelInfo.ratio
        : e.labelRatio == null
          ? null
          : Number(e.labelRatio)
    );
  }

  xmlLines.push(`      </root>`);
  xmlLines.push(`    </mxGraphModel>`);
  xmlLines.push(`  </diagram>`);
  xmlLines.push(`</mxfile>`);
  return xmlLines.join("\n");
}

/**
 * Generates vertical swimlanes (lanes side-by-side left-to-right, steps flowing top-to-bottom).
 */
function generateVerticalWorkflowXml(spec, placementState, out, measured) {
  const title = spec.title || "システム作業フロー & リソース動作図";
  const subtitle =
    spec.subtitle ||
    "ユーザー操作 → 画面 → バックエンド → ストレージ (RDS / S3 / DynamoDB)";
  const lanesInput =
    Array.isArray(spec.lanes) && spec.lanes.length > 0 ? spec.lanes : DEFAULT_LANES;
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const phases = Array.isArray(spec.phases) ? spec.phases : [];

  const leftMargin = 40;
  const topMargin = 25;
  const titleBannerHeight = 56;
  const phaseColWidth = phases.length > 0 ? 155 : 0;
  const headerHeight = 54;
  const laneTopY = topMargin + titleBannerHeight + 16;

  let maxStep = 0;
  for (const n of nodes) {
    const s = getNodeStepIndex(n);
    if (s > maxStep) maxStep = s;
  }
  for (const p of phases) {
    const s = Number(p.toCol ?? p.col ?? p.row ?? 0);
    if (s > maxStep) maxStep = s;
  }
  const stepCount = Math.max(1, maxStep + 1);

  const laneMap = new Map();
  lanesInput.forEach((l, idx) => {
    laneMap.set(l.id, {
      ...DEFAULT_LANES[idx % DEFAULT_LANES.length],
      ...l,
      index: idx,
      cellsByStep: new Map(),
    });
  });

  for (const node of nodes) {
    measureNodeMeta(node);
    const lane = laneMap.get(node.lane) || laneMap.values().next().value;
    const step = getNodeStepIndex(node);
    if (!lane.cellsByStep.has(step)) {
      lane.cellsByStep.set(step, []);
    }
    lane.cellsByStep.get(step).push(node);
  }

  // Compute height of each time-step row across all lanes
  const stepHeights = new Array(stepCount).fill(155);
  for (let s = 0; s < stepCount; s++) {
    let maxH = 155;
    for (const lane of laneMap.values()) {
      const stepNodes = lane.cellsByStep.get(s) || [];
      let hSum = 24;
      for (let i = 0; i < stepNodes.length; i++) {
        const n = stepNodes[i];
        const gap = i < stepNodes.length - 1 ? 46 : 24;
        hSum += n.__totalBlockH + gap;
      }
      if (hSum > maxH) maxH = hSum;
    }
    stepHeights[s] = maxH;
  }

  // Compute Y start of each step row relative to lane body (below headerHeight)
  const stepTopRelY = [];
  let accumY = headerHeight + 14;
  for (let s = 0; s < stepCount; s++) {
    stepTopRelY.push(accumY);
    accumY += stepHeights[s] + 16;
  }
  const totalLaneHeight = accumY + 12;

  // Compute width of each vertical lane and X position
  let currentX = leftMargin + (phaseColWidth > 0 ? phaseColWidth + 12 : 0);
  const nodeLayoutMap = new Map();
  const effectCells = [];

  for (const lane of laneMap.values()) {
    let maxW = Number(lane.minWidth || 255);
    for (const stepNodes of lane.cellsByStep.values()) {
      for (const n of stepNodes) {
        const blockW = n.__effectText ? Math.max(n.__totalBlockW, n.__effectW) : n.__totalBlockW;
        const needed = blockW + 64;
        if (needed > maxW) maxW = needed;
      }
    }
    lane.x = currentX;
    lane.width = maxW;

    for (const [step, stepNodes] of lane.cellsByStep.entries()) {
      let curY = stepTopRelY[step] + 14;
      if (stepNodes.length === 1) {
        curY =
          stepTopRelY[step] +
          Math.max(12, Math.round((stepHeights[step] - stepNodes[0].__totalBlockH) / 2));
      }

      for (let idx = 0; idx < stepNodes.length; idx++) {
        const n = stepNodes[idx];
        const nx = Math.round((lane.width - n.__w) / 2);
        const ny = curY;

        nodeLayoutMap.set(n.id, {
          node: n,
          lane,
          step,
          stackIndex: idx,
          stackCount: stepNodes.length,
          relX: nx,
          relY: ny,
          absX: lane.x + nx,
          absY: laneTopY + ny,
          width: n.__w,
          height: n.__h,
          centerX: lane.x + nx + n.__w / 2,
          centerY: laneTopY + ny + n.__h / 2,
          stepTopAbsY: laneTopY + stepTopRelY[step],
          stepHeight: stepHeights[step],
        });

        if (n.__effectText) {
          const effX = Math.round((lane.width - n.__effectW) / 2);
          const effY = ny + n.__h + n.__iconExtra + 10;
          effectCells.push({
            id: `${n.id}_effect`,
            parentId: `lane_${lane.id}`,
            value: n.__effectText,
            x: effX,
            y: effY,
            absX: lane.x + effX,
            absY: laneTopY + effY,
            width: n.__effectW,
            height: n.__effectH,
          });
          curY = effY + n.__effectH + 46;
        } else {
          curY = ny + n.__h + n.__iconExtra + 46;
        }
      }
    }

    currentX += lane.width;
  }

  const totalDiagramWidth = currentX - leftMargin;

  const labelObstacles = collectLabelObstacles(nodeLayoutMap, effectCells);
  for (const lane of laneMap.values()) {
    labelObstacles.push(laneBorderObstacle(lane.x - 1, laneTopY, 2, totalLaneHeight));
    labelObstacles.push(
      laneBorderObstacle(lane.x + lane.width - 1, laneTopY, 2, totalLaneHeight)
    );
  }
  let labelBounds = {
    x: leftMargin,
    y: topMargin,
    w: totalDiagramWidth,
    h: laneTopY + totalLaneHeight + 16 - topMargin,
  };
  if (measured) applyMeasuredLayout(labelObstacles, labelBounds, measured);

  const xmlLines = [];
  xmlLines.push(`<mxfile host="drawio-workflow-skill" version="1.1.0">`);
  xmlLines.push(`  <diagram id="workflow-1" name="${escapeXml(title)}">`);
  xmlLines.push(
    `    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1800" shadow="0">`
  );
  xmlLines.push(`      <root>`);
  xmlLines.push(`        <mxCell id="0" />`);
  xmlLines.push(`        <mxCell id="1" parent="0" />`);

  // Title Banner
  const titleHtml = `<b style="font-size:17px">${escapeXml(title)}</b><br><font color="#555555">${escapeXml(subtitle)}</font>`;
  xmlLines.push(
    `        <mxCell id="title_banner" value="${escapeXml(titleHtml)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;arcSize=14;" vertex="1" parent="1">`
  );
  xmlLines.push(
    `          <mxGeometry x="${leftMargin}" y="${topMargin}" width="${totalDiagramWidth}" height="${titleBannerHeight}" as="geometry" />`
  );
  xmlLines.push(`        </mxCell>`);
  labelObstacles.push({
    x: leftMargin,
    y: topMargin,
    w: totalDiagramWidth,
    h: titleBannerHeight,
  });

  // Left Vertical Phase Bar aligned with step rows
  if (phases.length > 0) {
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const fromStep = Number(p.fromCol ?? p.col ?? p.row ?? i);
      const toStep = Number(p.toCol ?? fromStep);
      const py = laneTopY + stepTopRelY[fromStep] + 4;
      let ph = 0;
      for (let s = fromStep; s <= toStep && s < stepHeights.length; s++) {
        ph += stepHeights[s] + (s < toStep ? 16 : 0);
      }
      ph = Math.max(40, ph - 8);
      const fill = p.fillColor || "#eef4fa";
      const stroke = p.strokeColor || "#99b2cc";
      const labelHtml = `<b>${escapeXml(p.label || p.title || `Phase ${i + 1}`)}</b>`;
      xmlLines.push(
        `        <mxCell id="phase_${i}" value="${escapeXml(labelHtml)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};fontSize=12;arcSize=12;" vertex="1" parent="1">`
      );
      xmlLines.push(
        `          <mxGeometry x="${leftMargin}" y="${py}" width="${phaseColWidth}" height="${ph}" as="geometry" />`
      );
      labelObstacles.push({ x: leftMargin, y: py, w: phaseColWidth, h: ph });
      xmlLines.push(`        </mxCell>`);
    }
  }

  // Vertical Swimlanes (horizontal=1, header at top)
  for (const lane of laneMap.values()) {
    const laneCellId = `lane_${lane.id}`;
    const hdrHtml = `<b style="font-size:13px">${escapeXml(lane.title)}</b>${
      lane.subtitle
        ? `<br><font color="#555555" style="font-size:11px">${escapeXml(lane.subtitle)}</font>`
        : ""
    }`;
    const laneStyle = `swimlane;horizontal=1;startSize=${headerHeight};fillColor=${lane.headerFill};strokeColor=${lane.strokeColor};swimlaneFillColor=${lane.bodyFill};strokeWidth=1.5;html=1;whiteSpace=wrap;`;
    xmlLines.push(
      `        <mxCell id="${laneCellId}" value="${escapeXml(hdrHtml)}" style="${laneStyle}" vertex="1" parent="1">`
    );
    xmlLines.push(
      `          <mxGeometry x="${lane.x}" y="${laneTopY}" width="${lane.width}" height="${totalLaneHeight}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);
  }

  // Nodes & Effects
  emitNodesAndEffectsXml(xmlLines, nodeLayoutMap, effectCells);

  // Edges for vertical swimlanes
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeId = e.id || `edge_${i + 1}`;
    const src = nodeLayoutMap.get(e.from || e.source);
    const trg = nodeLayoutMap.get(e.to || e.target);
    if (!src || !trg) continue;

    const typeKey = (e.type || "flow").toLowerCase();
    let style = e.style || EDGE_TYPE_STYLES[typeKey] || EDGE_TYPE_STYLES.flow;
    if (e.color) style += `strokeColor=${e.color};`;

    let portStyle = "";
    const autoWaypoints = Array.isArray(e.waypoints) ? [...e.waypoints] : [];

    if (!style.includes("exitX=") && e.exitX == null) {
      const dStep = trg.step - src.step;
      const dLane = trg.lane.index - src.lane.index;

      if (dLane === 0 && (dStep > 0 || (dStep === 0 && trg.stackIndex > src.stackIndex))) {
        portStyle = `${exitBottomStyle(src, 0.5)}entryX=0.5;entryY=0;`;
      } else if (
        dLane === 0 &&
        (dStep < 0 || (dStep === 0 && trg.stackIndex < src.stackIndex))
      ) {
        portStyle = `exitX=0.5;exitY=0;${entryBottomStyle(trg, 0.5)}`;
      } else if (dStep === 0 && dLane > 0) {
        if (trg.stackIndex > 0) {
          portStyle = "exitX=1;exitY=0.75;entryX=0;entryY=0.5;";
        } else {
          portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
        }
      } else if (dStep === 0 && dLane < 0) {
        portStyle = "exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
      } else if (dStep > 0 && dLane > 0) {
        const obstacleAtTargetLane = trg.lane.cellsByStep.has(src.step);
        if (obstacleAtTargetLane) {
          // Go down in source lane boundary first, then right into target
          portStyle = `${exitBottomStyle(src, 0.7)}entryX=0;entryY=0.5;`;
          if (autoWaypoints.length === 0) {
            const boundaryY = Math.round(src.stepTopAbsY + src.stepHeight + 6);
            autoWaypoints.push(
              { x: Math.round(src.absX + src.width * 0.7), y: boundaryY },
              { x: Math.round(trg.lane.x + 12), y: boundaryY },
              { x: Math.round(trg.lane.x + 12), y: Math.round(trg.centerY) }
            );
          }
        } else {
          portStyle = "exitX=1;exitY=0.5;entryX=0.5;entryY=0;";
        }
      } else if (dStep > 0 && dLane < 0) {
        portStyle = "exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
      } else if (dStep < 0 && dLane > 0) {
        portStyle = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
      } else if (dStep < 0 && dLane < 0) {
        portStyle = "exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
      }
    } else {
      if (e.exitX != null) portStyle += `exitX=${e.exitX};exitY=${e.exitY ?? 0.5};`;
      if (e.entryX != null) portStyle += `entryX=${e.entryX};entryY=${e.entryY ?? 0.5};`;
    }

    const labelInfo = resolveEdgeLabelLayout(
      e,
      src,
      trg,
      autoWaypoints,
      labelObstacles,
      labelBounds,
      src.lane.width ? Math.round(src.lane.width - 24) : null,
      placementState ? placementState.get(edgeId)?.tried : null,
      measured ? measured.edgePathsById.get(edgeId) : null
    );
    if (out && labelInfo) {
      out.placements.set(edgeId, { key: labelInfo.key, rect: labelInfo.rect });
    }
    emitEdgeXml(
      xmlLines,
      edgeId,
      e.label || "",
      style + portStyle,
      src.node.id,
      trg.node.id,
      autoWaypoints,
      labelInfo,
      // 選んだ基準点（線の何割地点か）を実際にも書き出す。ここを既定値のままだと
      // offset だけ候補用になり、ラベルが別地点へずれて線に乗る。
      labelInfo
        ? labelInfo.ratio
        : e.labelRatio == null
          ? null
          : Number(e.labelRatio)
    );
  }

  xmlLines.push(`      </root>`);
  xmlLines.push(`    </mxGraphModel>`);
  xmlLines.push(`  </diagram>`);
  xmlLines.push(`</mxfile>`);
  return xmlLines.join("\n");
}

function emitNodesAndEffectsXml(xmlLines, nodeLayoutMap, effectCells) {
  for (const layout of nodeLayoutMap.values()) {
    const { node, lane, relX, relY, width, height } = layout;
    const laneCellId = `lane_${lane.id}`;
    const baseStyle = node.style || node.__preset.style;
    const customFill = node.fillColor ? `fillColor=${node.fillColor};` : "";
    const customStroke = node.strokeColor ? `strokeColor=${node.strokeColor};` : "";
    const finalStyle = `${baseStyle}${customFill}${customStroke}`;
    const labelHtml = formatNodeHtmlLabel(node);

    xmlLines.push(
      `        <mxCell id="${escapeXml(node.id)}" value="${escapeXml(labelHtml)}" style="${escapeXml(finalStyle)}" vertex="1" parent="${laneCellId}">`
    );
    xmlLines.push(
      `          <mxGeometry x="${relX}" y="${relY}" width="${width}" height="${height}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);
  }

  for (const eff of effectCells) {
    const effStyle =
      "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=12;fillColor=#ffffc0;strokeColor=#b59b00;fontSize=11;align=left;spacingLeft=6;shadow=1;";
    xmlLines.push(
      `        <mxCell id="${escapeXml(eff.id)}" value="${escapeXml(eff.value)}" style="${effStyle}" vertex="1" parent="${eff.parentId}">`
    );
    xmlLines.push(
      `          <mxGeometry x="${eff.x}" y="${eff.y}" width="${eff.width}" height="${eff.height}" as="geometry" />`
    );
    xmlLines.push(`        </mxCell>`);
  }
}

const EDGE_LABEL_FONT_SIZE = 11;
const EDGE_LABEL_LINE_HEIGHT = 15;

/**
 * draw.io のエッジラベルは、幅が与えられるまで一切折り返さない。
 * `whiteSpace=wrap` だけでも折り返さないため、折り返し幅と高さをここで計算して
 * `edgeLabel` 子セルとして明示的に持たせる。
 */
function splitLabelSegments(label) {
  if (!label) return [];
  return String(label)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n");
}

function measureLabelWidth(text, fontSize = EDGE_LABEL_FONT_SIZE) {
  let w = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1100 && (cp <= 0x11ff || (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6))) {
      w += fontSize; // 全角（ひらがな・カタカナ・漢字・全角記号・丸数字など）
    } else if (/[A-Z0-9]/.test(ch)) {
      w += fontSize * 0.66;
    } else {
      w += fontSize * 0.55;
    }
  }
  return w;
}

function wrapLabelLines(segments, width, fontSize = EDGE_LABEL_FONT_SIZE) {
  const lines = [];
  for (const seg of segments) {
    if (!seg) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const ch of seg) {
      if (cur && measureLabelWidth(cur + ch, fontSize) > width) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * ラベルを収める幅の候補を広い順に返す。
 * 広いほど見やすいが衝突しやすいため、広い候補から試して空いている場所を優先する。
 */
function edgeLabelWidthTiers(segments, dominant, widthLimit, edge) {
  const natural = Math.max(...segments.map((seg) => measureLabelWidth(seg)));
  if (edge && edge.labelWidth) return [Math.round(Number(edge.labelWidth))];

  const hardCap = dominant === "v" ? 170 : 210;
  let cap = Math.min(hardCap, Math.max(48, Math.round(natural)));
  if (widthLimit) cap = Math.max(90, Math.min(cap, widthLimit));

  const tiers = [cap];
  for (const narrow of dominant === "v" ? [140, 112, 84] : [168, 132, 100]) {
    const w = widthLimit ? Math.max(76, Math.min(narrow, widthLimit)) : narrow;
    if (w < cap - 8) tiers.push(w);
  }
  return tiers;
}

/** 指定幅で折り返した結果（箱の幅と高さ）を返す。折返し不要なら幅は文字数のぶんだけ。 */
function buildEdgeLabelBox(segments, width) {
  const fits = segments.every((seg) => measureLabelWidth(seg) <= width);
  const lines = fits ? segments : wrapLabelLines(segments, width);
  const natural = Math.max(...lines.map((seg) => measureLabelWidth(seg)));
  return {
    width: Math.round(fits ? Math.max(40, natural) : width),
    height: lines.length * EDGE_LABEL_LINE_HEIGHT + 6,
    lineCount: lines.length,
  };
}

/** 衝突回避に試す配置候補（線のどこに・どちら側へ・どれくらい離して置くか）。 */
function edgeLabelCandidates(dominant) {
  const sides = dominant === "h" ? ["above", "below"] : ["right", "left"];
  const out = [];
  for (const ratio of [-0.1, -0.34, 0.34, -0.58, 0.58, -0.8, 0.8]) {
    for (const side of sides) {
      for (const gap of [6, 18, 30, 44]) out.push({ ratio, side, gap });
    }
  }
  out.push({ ratio: -0.1, side: "center", gap: 0 });
  return out;
}

/** 折れ線の分位点（source 側が 0、target 側が 1）上の点を返す。 */
function polylinePoint(points, fraction) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segs.push(d);
    total += d;
  }
  let rest = total * Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < segs.length; i++) {
    if (rest <= segs[i]) {
      const r = segs[i] === 0 ? 0 : rest / segs[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * r,
        y: points[i].y + (points[i + 1].y - points[i].y) * r,
      };
    }
    rest -= segs[i];
  }
  return points[points.length - 1];
}

/**
 * 1 pass 目で実測した図面ジオメトリを、ラベル配置の制約として採用する。
 * 予測ジオメトリでの衝突判定は取り消し、実測のノード・レーン枠・折れ線を優先する。
 */
function applyMeasuredLayout(labelObstacles, labelBounds, measured) {
  labelObstacles.length = 0;
  labelObstacles.push(...measuredLabelObstacles(measured));
  if (measured.bounds) {
    labelBounds.x = measured.bounds.x - 8;
    labelBounds.y = measured.bounds.y - 8;
    labelBounds.w = measured.bounds.w + 16;
    labelBounds.h = measured.bounds.h + 16;
  }
}

function inflateRect(rect, m) {
  return { x: rect.x - m, y: rect.y - m, w: rect.w + m * 2, h: rect.h + m * 2 };
}

function rectOverlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** ラベル箱の衝突スコア。ノードやノートとの重なりと、図枠外へのはみ出しを penalty にする。 */
function scoreLabelRect(rect, obstacles, bounds) {
  let score = 0;
  for (const o of obstacles) {
    const area = rectOverlapArea(rect, o);
    if (area > 0) score += area * (o.hard ? 50000 : o.weight || 10);
  }
  if (bounds) {
    // 図枠外へはみ出すと描画が切り込まれるため、何があっても避ける。
    const outW =
      Math.max(0, bounds.x - rect.x) +
      Math.max(0, rect.x + rect.w - (bounds.x + bounds.w));
    const outH =
      Math.max(0, bounds.y - rect.y) +
      Math.max(0, rect.y + rect.h - (bounds.y + bounds.h));
    score += (outW * rect.h + outH * rect.w) * 50000;
  }
  return score;
}

function labelOffsetFor(side, box, gap = 6) {
  if (side === "above") return { dx: 0, dy: -Math.round(box.height / 2 + gap) };
  if (side === "below") return { dx: 0, dy: Math.round(box.height / 2 + gap) };
  if (side === "left") return { dx: -Math.round(box.width / 2 + gap + 4), dy: 0 };
  if (side === "right") return { dx: Math.round(box.width / 2 + gap + 4), dy: 0 };
  return { dx: 0, dy: 0 };
}

function emitEdgeXml(xmlLines, edgeId, edgeLabel, fullStyle, sourceId, targetId, waypoints, labelLayout, labelPositionRatio) {
  const useChildLabel = Boolean(edgeLabel) && Boolean(labelLayout);
  const edgeStyle = useChildLabel ? fullStyle : `${fullStyle}labelBackgroundColor=#ffffff;`;

  xmlLines.push(
    `        <mxCell id="${escapeXml(edgeId)}" value="${useChildLabel ? "" : escapeXml(edgeLabel)}" style="${escapeXml(edgeStyle)}" edge="1" parent="1" source="${escapeXml(sourceId)}" target="${escapeXml(targetId)}">`
  );
  if (waypoints.length > 0) {
    xmlLines.push(`          <mxGeometry relative="1" as="geometry">`);
    xmlLines.push(`            <Array as="points">`);
    for (const wp of waypoints) {
      xmlLines.push(`              <mxPoint x="${wp.x}" y="${wp.y}" />`);
    }
    xmlLines.push(`            </Array>`);
    xmlLines.push(`          </mxGeometry>`);
  } else {
    xmlLines.push(`          <mxGeometry relative="1" as="geometry" />`);
  }
  xmlLines.push(`        </mxCell>`);

  if (!useChildLabel) return;

  const xRatio = labelPositionRatio == null ? -0.1 : labelPositionRatio;
  xmlLines.push(
    `        <mxCell id="${escapeXml(`${edgeId}_lbl`)}" value="${escapeXml(edgeLabel)}" style="edgeLabel;html=1;whiteSpace=wrap;align=center;verticalAlign=middle;resizable=0;points=[];labelBackgroundColor=#ffffff;fontSize=${EDGE_LABEL_FONT_SIZE};" vertex="1" connectable="0" parent="${escapeXml(edgeId)}">`
  );
  xmlLines.push(
    `          <mxGeometry x="${xRatio}" y="0" relative="1" as="geometry" width="${labelLayout.width}" height="${labelLayout.height}"><mxPoint x="${labelLayout.dx}" y="${labelLayout.dy}" as="offset" /></mxGeometry>`
  );
  xmlLines.push(`        </mxCell>`);
}

/**
 * エッジラベルの折り返し幅と、線・ノード・ノートと重ならない置き場所を決める。
 * 採用した箱は obstacles に積み増すので、後から置くラベル同士も重なりにくい。
 */
function resolveEdgeLabelLayout(
  edge,
  src,
  trg,
  waypoints,
  obstacles,
  bounds,
  widthLimit,
  triedKeys,
  measuredPath
) {
  if (!edge || !edge.label) return null;
  const segments = splitLabelSegments(edge.label);
  if (segments.length === 0) return null;

  const dx = trg.centerX - src.centerX;
  const dy = trg.centerY - src.centerY;
  const dominant = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
  const path =
    measuredPath && measuredPath.length > 1
      ? measuredPath
      : [
          { x: src.centerX, y: src.centerY },
          ...(waypoints || []),
          { x: trg.centerX, y: trg.centerY },
        ];

  // 実測時は全エッジの折れ線がすでに障害物へ入っているため、自分の線を二重に足さない。
  for (let i = 1; measuredPath == null && i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    obstacles.push({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.max(3, Math.abs(b.x - a.x)),
      h: Math.max(3, Math.abs(b.y - a.y)),
      weight: 4,
    });
  }

  // "auto" は位置指定なしと同じ。未指定扱いにしないと中心基準の既定オフセットに落ちる。
  const declaredSide = edge.labelPosition ? String(edge.labelPosition).trim().toLowerCase() : "";
  const forcedSide = declaredSide && declaredSide !== "auto" ? declaredSide : null;
  const forcedRatio = edge.labelRatio == null ? null : Number(edge.labelRatio);
  let candidates = forcedSide
    ? [{ ratio: forcedRatio == null ? -0.1 : forcedRatio, side: forcedSide, gap: 6 }]
    : edgeLabelCandidates(dominant);
  if (forcedRatio != null && !forcedSide) {
    candidates = candidates.map((c) => ({ ...c, ratio: forcedRatio }));
  }

  const tried = triedKeys || new Set();
  const scan = [];
  let best = null;
  let tierIndex = -1;
  let candIndex = -1;
  const tiers = edgeLabelWidthTiers(segments, dominant, widthLimit, edge);
  for (const tier of tiers) {
    tierIndex++;
    candIndex = -1;
    const box = buildEdgeLabelBox(segments, tier);
    for (const cand of candidates) {
      candIndex++;
      const key = `${tierIndex}:${candIndex}`;
      const anchor = polylinePoint(path, (1 + cand.ratio) / 2);
      const off = labelOffsetFor(cand.side, box, cand.gap);
      // 書き出す offset と同じ式で予測矩形を出す（実測では 1〜2px しか狂わない）。
      const rect = {
        x: Math.round(anchor.x + off.dx - box.width / 2),
        y: Math.round(anchor.y + off.dy - box.height / 2),
        w: box.width,
        h: box.height,
      };
      let score = scoreLabelRect(rect, obstacles, bounds);
      if (cand.side === "center") score += 120000; // 線を消すので最終手段
      // 同等なら「線の中央寄り・線に近い置き場所」を選ぶ（重なり penalty より十分小さい）
      score += Math.abs(cand.ratio) * 20 + (cand.gap - 6) * 2;
      const cost = tried.has(key) ? score + 1e12 : score;
      scan.push({ key, ratio: cand.ratio, side: cand.side, gap: cand.gap, w: box.width, h: box.height, score, rect });
      if (!best || cost < best.cost - 1) {
        best = {
          width: box.width,
          height: box.height,
          // draw.io は「線上の基準点 + offset」をラベル箱の左上に置くため、
          // 中心基準の off を左上基準へ読み替えてから書き出す。
          dx: off.dx - Math.round(box.width / 2),
          dy: off.dy - Math.round(box.height / 2),
          ratio: cand.ratio,
          score,
          cost,
          key,
          rect,
        };
      }
      if (score === 0 && !tried.has(key)) {
        obstacles.push(rect);
        return best;
      }
    }
  }

  if (process.env.DWL_DEBUG_LABELS && edge) {
    const ranked = scan.slice().sort((a, b) => a.score - b.score).slice(0, 4);
    console.error(
      `[label ${edge.id}] path=${JSON.stringify(path.map((p) => `${p.x},${p.y}`)).slice(0, 90)} ` +
        `best=${best && best.key} bestScore=${best && best.score} zero=${scan.filter((c) => c.score === 0).length} ` +
        `top=${ranked.map((r) => `${r.key}:${r.score}(${r.rect.x},${r.rect.y},${r.w}x${r.h})`).join(" ")}`
    );
  }
  if (best) obstacles.push(best.rect);
  return best;
}

/** ノード・状態変化ノート・見出しバーなど、ラベルを置いてはいけない長方形を集める。 */
function collectLabelObstacles(nodeLayoutMap, effectCells) {
  const rects = [];
  for (const l of nodeLayoutMap.values()) {
    rects.push(
      inflateRect(
        { x: l.absX, y: l.absY, w: l.width, h: l.height + (l.node.__iconExtra || 0) },
        6
      )
    );
  }
  for (const eff of effectCells) {
    if (eff.absX == null || eff.absY == null) continue;
    rects.push(inflateRect({ x: eff.absX, y: eff.absY, w: eff.width, h: eff.height }, 6));
  }
  return rects;
}

/** 実測ジオメトリ（check-layout.mjs）から、ラベルが避けるべき領域を作る。 */
function measuredLabelObstacles(measured) {
  const rects = [];
  for (const n of measured.nodes) rects.push(inflateRect(n, 4));
  // 障害物にするのは描画されるものだけ。measured.nodeTexts は塗り・枠線の無い
  // text セルの枠（透明な余白）なので、そのまま障害物にすると過剰に避ける。
  // アイコン下のキャプションなどノード枠から出た文字は vertexLabels 側で測れる。
  for (const t of measured.vertexLabels) rects.push(inflateRect(t, 3));
  for (const l of measured.lanes) {
    rects.push(laneBorderObstacle(l.x, l.y, l.w, 2));
    rects.push(laneBorderObstacle(l.x, l.y + l.h - 2, l.w, 2));
    rects.push(laneBorderObstacle(l.x, l.y, 2, l.h));
    rects.push(laneBorderObstacle(l.x + l.w - 2, l.y, 2, l.h));
  }
  for (const e of measured.edgePaths) {
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1];
      const b = e.pts[i];
      // 斜め線分を外接矩形のまま障害物にすると、線から遠い場所まで避けてしまう。
      // 軸平行なら矩形が線そのものなのでそのまま、斜めなら小さな区間に割って近似する。
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const pieces =
        dx > 24 && dy > 24 ? Math.min(12, Math.max(1, Math.ceil(Math.max(dx, dy) / 60))) : 1;
      for (let k = 0; k < pieces; k++) {
        const x0 = a.x + (b.x - a.x) * (k / pieces);
        const y0 = a.y + (b.y - a.y) * (k / pieces);
        const x1 = a.x + (b.x - a.x) * ((k + 1) / pieces);
        const y1 = a.y + (b.y - a.y) * ((k + 1) / pieces);
        rects.push({
          x: Math.min(x0, x1) - 1.5,
          y: Math.min(y0, y1) - 1.5,
          w: Math.max(3, Math.abs(x1 - x0)) + 3,
          h: Math.max(3, Math.abs(y1 - y0)) + 3,
          weight: 4,
        });
      }
    }
  }
  return rects;
}

/** レーン枠の線（幅 2px）を、周囲 mpx ごと避けたい障害物として返す。 */
function laneBorderObstacle(x, y, w, h, m = 5) {
  return { x: x - m, y: y - m, w: w + m * 2, h: h + m * 2, hard: true };
}

/**
 * Builds draw.io `<mxfile>` XML string in either `"horizontal"` or `"vertical"` swimlane direction.
 */
export function generateWorkflowDrawioXml(
  spec,
  overrideDirection = null,
  placementState = null,
  out = null,
  measured = null
) {
  const dir = (overrideDirection || spec.direction || "horizontal").toLowerCase();
  if (dir === "vertical" || dir === "v") {
    return generateVerticalWorkflowXml(spec, placementState, out, measured);
  }
  return generateHorizontalWorkflowXml(spec, placementState, out, measured);
}

const HELP_TEXT = `
build-workflow.mjs - Horizontal / Vertical Swimlane Workflow & Resource Behavior Diagram Builder

Usage:
  node scripts/build-workflow.mjs --spec <workflow.json> [-o output.drawio.png] [options]

Options:
  -i, --spec <path>              Input workflow JSON specification file
  -o, --output <path>            Output PNG or SVG path (default: <spec-name>.drawio.png)
      --xml-out <path>           Also save intermediate .drawio XML file
  -d, --direction <dir>          Swimlane direction: horizontal | vertical (default: spec.direction or horizontal)
  -s, --scale <number>           PNG scale factor (default: 2)
  -b, --border <px>              Border padding in pixels (default: 16)
      --theme <theme>            Color theme: light | dark (default: light)
  -h, --help                     Show help
`.trim();

/**
 * XML を作っては内蔵レンダラーで実測し、重なったラベルだけ別候補に置き換えて作り直す。
 * 置き場所の予測は実際の折れ線ルーティングと数pxずれるため、実測値をフィードバックする。
 */
export function buildWorkflowWithLabelCheck(spec, overrideDirection, maxRounds = 5) {
  // 1 pass 目: 仮のラベルで描画し、実際の折れ線・ノード・レーン枠の位置を測る。
  const probe = generateWorkflowDrawioXml(spec, overrideDirection);
  let measured;
  try {
    measured = measureDiagram(probe, null);
  } catch (err) {
    return { xml: probe, problems: [], rounds: 1, inspectError: err };
  }
  measured.edgePathsById = new Map(measured.edgePaths.map((p) => [p.id, p.pts]));

  // 2 pass 目以降: 実測ジオメトリを基準に置き場所を探す。当たったラベルだけ候補を
  // 潰して作り直し、重なり合計が最少の図を採る（置き場所の予測は実測と一致する）。
  const placementState = new Map();
  let best = null;
  const seen = new Set();

  for (let round = 0; round < maxRounds; round++) {
    const out = { placements: new Map() };
    const xml = generateWorkflowDrawioXml(spec, overrideDirection, placementState, out, measured);
    if (seen.has(xml)) break; // 同じ置き場所に戻った（打ち手を使い切った）
    seen.add(xml);

    let report;
    try {
      report = inspectDiagram(xml, null);
    } catch (err) {
      return { xml, problems: [], rounds: round + 2, inspectError: err };
    }
    const problems = report.problems.filter((p) => p.kind !== "ラベルサイズ未確定");
    const total = problems.reduce((sum, p) => sum + p.area, 0);
    if (best == null || total < best.total) {
      best = { xml, problems, total, rounds: round + 2 };
    }
    if (total === 0) break;

    const badLabels = new Set(problems.map((p) => p.labelId));
    let advanced = false;
    for (const [edgeId, placed] of out.placements) {
      if (!badLabels.has(`${edgeId}_lbl`)) continue;
      let st = placementState.get(edgeId);
      if (!st) {
        st = { tried: new Set(), bias: { byKey: new Map(), fallback: null } };
        placementState.set(edgeId, st);
      }
      if (!st.tried.has(placed.key)) {
        st.tried.add(placed.key);
        advanced = true;
      }
    }
    if (!advanced) break;
  }

  return best || { xml: probe, problems: [], rounds: 1 };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      spec: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      "xml-out": { type: "string" },
      direction: { type: "string", short: "d" },
      scale: { type: "string", short: "s", default: "2" },
      border: { type: "string", short: "b", default: "16" },
      theme: { type: "string", default: "light" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  const specPath = values.spec || positionals[0];
  if (values.help || !specPath) {
    console.log(HELP_TEXT);
    process.exit(values.help ? 0 : 1);
  }

  const rawJson = await fs.readFile(specPath, "utf8");
  const spec = JSON.parse(rawJson);
  const { xml, problems, rounds } = buildWorkflowWithLabelCheck(spec, values.direction);

  const outPath =
    values.output ||
    path.join(
      path.dirname(specPath),
      `${path.basename(specPath, path.extname(specPath))}.drawio.png`
    );
  const xmlOutPath =
    values["xml-out"] ||
    outPath.replace(/\.drawio\.png$|\.png$|\.svg$/i, "") + ".drawio";

  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(xmlOutPath)), { recursive: true });
  await fs.writeFile(xmlOutPath, xml, "utf8");

  if (problems.length > 0) {
    console.log(
      `レイアウト検査: 重なり ${problems.length} 件が残っています（rounds=${rounds}。edge の labelPosition / labelWidth、colPitch で微調できます）`
    );
    for (const p of problems.slice(0, 6)) {
      console.log(`  - [${p.kind}] "${p.label}" × ${p.other}`);
    }
  } else {
    console.log(`レイアウト検査: 文字と線・ノード・レーン枠の重なりなし（rounds=${rounds}）`);
  }

  const scale = parseFloat(values.scale) || 2;
  const border = parseInt(values.border, 10) || 16;

  if (outPath.toLowerCase().endsWith(".svg")) {
    const res = convertXmlToSvg(xml, {
      scale: 1,
      border,
      theme: values.theme,
      embedXml: true,
    });
    await fs.writeFile(outPath, res.svg, "utf8");
    console.log(`Generated XML: ${xmlOutPath}`);
    console.log(`Generated SVG: ${outPath} (${res.width}x${res.height}px)`);
  } else {
    const res = convertXmlToPng(xml, {
      scale,
      border,
      theme: values.theme,
      embedXml: true,
      dpi: 144,
    });
    await fs.writeFile(outPath, res.png);
    console.log(`Generated XML: ${xmlOutPath}`);
    console.log(`Generated PNG: ${outPath} (${res.width}x${res.height}px)`);
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(fsSync.realpathSync(process.argv[1])).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Error:", err.message || err);
    process.exit(1);
  });
}
