#!/usr/bin/env node
/**
 * check-layout.mjs - 生成した .drawio の「文字と線の重なり」を機械的に検査する
 *
 * 描画エンジン（drawio2png.mjs に内蔵の draw.io コア）で実際にレイアウトを展開し、
 * 確定したラベル矩形・ノード矩形・折れ線座標を読み取って次を確かめる。
 *   1. エッジラベルが折れ線（自分の線を含む）をまたいでいないか
 *   2. エッジラベルがノードや状態変化ノートに重なっていないか
 *   3. ラベルがレーン（スイムレーン）の枠線を跨いでいないか
 *   4. エッジラベルが折り返し幅を指定されず 1 行に伸びていないか
 *
 * Usage:
 *   node scripts/check-layout.mjs <file.drawio|file.drawio.png> [--page <n|name>] [--json]
 *
 * 終了コード: 問題なし 0 / 重なり等の問題あり 1 / 入力エラー 2
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractDrawioPages,
  parseRichTextLines,
  wrapRichTextLines,
  computeLinesMetrics,
  getDrawioOssRuntime,
  decodeGraphModel,
  createHeadlessGraphAndView,
  extractDrawioXmlFromPng,
} from "./drawio2png.mjs";

const MIN_OVERLAP_AREA = 10; // px²。掠った程度は無視する
const WRAP_WIDTH_WARN = 240; // この幅を超えて 1 行になっているラベルは折返し未指定とみなす

/**
 * 生成直前の XML から、実描画で確定する幾何（ノード・レーン・折れ線）を取り出す。
 * ラベル配置の予測に使う。
 */
export function measureDiagram(inputText, pageSelector) {
  return inspectDiagram(inputText, pageSelector);
}

function parseArgs(argv) {
  const out = { input: null, page: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--page") out.page = argv[++i];
    else if (!out.input) out.input = a;
  }
  return out;
}

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

/**
 * SVG 化（renderTextToSvgNodes）と同じ計算で、実際に描画されるラベルの枠を再現する。
 * mxText の bounds は「折返しに使う幅」に過ぎず、折返さないラベル（アイコン下の注記など）は
 * bounds より広く描かれるため、bounds をそのまま衝突判定に使うと誤検出になる。
 */
function paintedLabelRect(text, style) {
  const b = text.bounds;
  if (!b) return null;
  const fontSize = Number(style.fontSize) || 12;
  const isHtml =
    Number(style.html) === 1 || /<[a-zA-Z!/]/.test(String(text.value || ""));
  let maxWidth;
  let totalHeight;
  let lineCount = 1;
  try {
    const parsed = parseRichTextLines(
      String(text.value || ""),
      {
        fontSize,
        fontFamily: "Helvetica, Arial, sans-serif",
        fontColor: "#000000",
        fontStyle: Number(style.fontStyle) || 0,
      },
      isHtml
    );
    const wrap = String(style.whiteSpace || "") === "wrap";
    const wrapWidth = wrap && b.width > 0 ? b.width : 0;
    const lines = wrapRichTextLines(parsed, wrapWidth, wrap && b.width > 0);
    const metrics = computeLinesMetrics(lines, fontSize, 1.2);
    maxWidth = metrics.maxWidth;
    totalHeight = metrics.totalHeight;
    lineCount = metrics.lineMetrics.length;
  } catch (err) {
    return labelRectFromBounds(b, style);
  }

  const x = b.x;
  const y = b.y;
  const h = b.height;
  const align = String(style.align || "center");
  const valign = String(style.verticalAlign || "middle");
  const overflow = String(style.overflow || "");
  const clip = overflow === "width" || overflow === "height" || overflow === "fill";
  const shown = clip && h > 0 ? Math.min(totalHeight, h) : totalHeight;

  let top = y;
  if (valign === "top") top = y + 3;
  else if (valign === "middle") top = overflow === "fill" ? y - h / 2 : y - shown / 2;
  else if (valign === "bottom") top = overflow === "fill" ? y - h : y - shown - 3;

  // labelBackgroundColor は文字幅 + 3px の白い箱として線を消す。その範囲を測る。
  const hasBg = Boolean(style.labelBackgroundColor || style.labelBorderColor);
  const w = hasBg ? Math.max(4, maxWidth + 3) : Math.max(4, maxWidth);
  const boxH = hasBg ? Math.max(4, totalHeight) : Math.max(4, totalHeight);
  let left = x;
  if (align === "center") left = x - w / 2;
  else if (align === "right") left = x - w;
  else if (hasBg) left = x - 1.5;
  const topY = hasBg ? top + 0.5 : top;

  const box = rectOf(left, topY, w, boxH);
  // 回転ラベル（swimlane;horizontal=0 の直接ラベルなど）は回転後の枠で判定する。
  const rotation = Number(style.rotation) || 0;
  return { ...(rotation ? rotateRect(box, x, y, rotation) : box), lineCount };
}

/** bounds の揃え基準点から枠を復元する（上の計算が使えない場合のフォールバック）。 */
function labelRectFromBounds(b, style) {
  const h = String((style && style.align) || "center");
  const v = String((style && style.verticalAlign) || "middle");
  let x = b.x;
  let y = b.y;
  if (h === "left") x = b.x;
  else if (h === "right") x = b.x - b.width;
  else x = b.x - b.width / 2;
  if (v === "top") y = b.y;
  else if (v === "bottom") y = b.y - b.height;
  else y = b.y - b.height / 2;
  return rectOf(x, y, b.width, b.height);
}

function rectOf(x, y, w, h) {
  return { x, y, w: Math.max(0, w), h: Math.max(0, h) };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 線分を実際のストローク幅の短い矩形に刻む。
 * 外接矩形で判定すると斜線を大きな四角扱いになり、線から離れた文字を誤検出する。
 */
function segmentStrokes(a, b, stroke = 2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / stroke));
  const rects = [];
  for (let i = 0; i < steps; i++) {
    const p = (i + 0.5) / steps;
    rects.push(
      rectOf(a.x + dx * p - stroke / 2, a.y + dy * p - stroke / 2, stroke, stroke)
    );
  }
  return rects;
}

/** SVG の rotate(angle, cx, cy) と同じ中心回転で矩形の外接框を求める。 */
function rotateRect(r, cx, cy, deg) {
  const rad = (Number(deg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const dx = px - cx;
    const dy = py - cy;
    const x = cx + dx * cos - dy * sin;
    const y = cy + dx * sin + dy * cos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return rectOf(minX, minY, maxX - minX, maxY - minY);
}

function borderRects(r, t = 2) {
  return [
    { part: "上辺", rect: rectOf(r.x, r.y, r.w, t) },
    { part: "下辺", rect: rectOf(r.x, r.y + r.h - t, r.w, t) },
    { part: "左辺", rect: rectOf(r.x, r.y, t, r.h) },
    { part: "右辺", rect: rectOf(r.x + r.w - t, r.y, t, r.h) },
  ];
}

function shortText(value, n = 26) {
  const plain = String(value || "")
    .replace(/<br\s*\/?>/gi, "⏎")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
  return plain.length > n ? `${plain.slice(0, n)}…` : plain;
}

/** タグ対応をざっと見て、途中で切れた XML を「問題なし」にしないための検査。 */
function assertWellFormedXml(text) {
  const s = String(text);
  const stack = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XML が壊れています（コメントが閉じていません）");
      i = end + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", lt)) {
      const end = s.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XML が壊れています（CDATA が閉じていません）");
      i = end + 3;
      continue;
    }
    if (s.startsWith("<?", lt)) {
      const end = s.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XML が壊れています（宣言が閉じていません）");
      i = end + 2;
      continue;
    }
    const gt = s.indexOf(">", lt);
    if (gt < 0) throw new Error("XML が途中で切れています");
    const tag = s.slice(lt + 1, gt).trim();
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) {
        throw new Error(`XML が壊れています（</${name}> に対応する開始タグがありません）`);
      }
    } else if (!tag.endsWith("/")) {
      stack.push(tag.split(/[\s/]/)[0]);
    }
    i = gt + 1;
  }
  if (stack.length) {
    throw new Error(`XML が途中で切れています（<${stack[stack.length - 1]}> が閉じていません）`);
  }
}

export function inspectDiagram(inputText, pageSelector) {
  if (!Buffer.isBuffer(inputText) && /^\s*</.test(String(inputText))) {
    assertWellFormedXml(inputText);
  }
  const { pages } = extractDrawioPages(inputText);
  if (!pages || pages.length === 0) throw new Error("図面ページが見つかりません");
  let page = pages[0];
  if (pageSelector != null) {
    const byIndex = Number(pageSelector);
    page =
      (Number.isFinite(byIndex) && pages[byIndex - 1]) ||
      pages.find((p) => p.id === pageSelector || p.name === pageSelector);
    if (!page) {
      const names = pages.map((p, i) => `${i + 1}:${p.name || p.id}`).join(", ");
      throw new Error(
        `ページ "${pageSelector}" が見つかりません（このファイルのページ: ${names}）`
      );
    }
  }

  const runtime = getDrawioOssRuntime();
  const themeOptions = {
    defaultFill: "#ffffff",
    defaultStroke: "#000000",
    defaultFont: "#000000",
    isDark: false,
  };
  const modelNode = page.modelNode;
  const globalShadow = modelNode.getAttribute("shadow") === "1";
  const { model } = decodeGraphModel(modelNode, runtime, {
    pageId: page.id,
    pageName: page.name,
    pageIndex: page.index,
    pageCount: pages.length,
  });
  const { view } = createHeadlessGraphAndView(
    model,
    runtime.lightStyles,
    themeOptions,
    runtime,
    globalShadow
  );
  view.validate();

  const edgeLabels = [];
  const vertexLabels = [];
  const nodes = [];
  const nodeTexts = [];
  const lanes = [];
  const polylines = [];

  for (const [cell, state] of view.getStatesMap().entries()) {
    if (cell === model.getRoot()) continue;
    const parent = model.getParent(cell);
    if (parent === model.getRoot() || parent == null) continue;

    const value = model.getValue(cell);
    const style = state.style || {};
    // 解決後の style.shape は text でも "label" になるため、元のスタイル文字列で判別する。
    const rawStyle = String(model.getStyle(cell) || "");
    const isBareText =
      /^text(;|$)/.test(rawStyle.trim()) ||
      ((style.shape == null || style.shape === "text" || style.shape === "label") &&
        !style.fillColor &&
        !style.strokeColor);
    const isEdge = model.isEdge(cell);
    // ラベルを子セルとして持つエッジがあるため、親がエッジならラベル扱い。
    const isEdgeLabelCell = !isEdge && parent != null && model.isEdge(parent);

    if (isEdge) {
      if (state.absolutePoints) {
        const pts = state.absolutePoints.map((p) => ({ x: p.x, y: p.y }));
        const strokes = [];
        for (let i = 1; i < pts.length; i++) {
          strokes.push(...segmentStrokes(pts[i - 1], pts[i]));
        }
        polylines.push({ id: cell.id, text: shortText(value), pts, strokes });
      }
    } else {
      const rect = rectOf(state.x, state.y, state.width, state.height);
      const isLane = style.shape === "swimlane";
      const entry = { id: cell.id, text: shortText(value), rect };
      if (isLane) lanes.push(entry);
      else if (!isEdgeLabelCell && !isBareText) nodes.push(entry);
      else if (!isEdgeLabelCell) nodeTexts.push(entry);
    }

    const text = state.text;
    if (text && text.bounds && String(text.value || "").trim()) {
      const painted = paintedLabelRect(text, style);
      if (!painted) continue;
      const { lineCount, ...rect } = painted;
      const entry = {
        id: cell.id,
        text: shortText(text.value),
        rect,
        lineCount,
      };
      if (isEdge || isEdgeLabelCell) edgeLabels.push(entry);
      else vertexLabels.push(entry);
    }
  }

  if (
    nodes.length + nodeTexts.length + vertexLabels.length + edgeLabels.length +
      polylines.length ===
    0
  ) {
    throw new Error("検査対象の図形がありません（空のページか、XML が壊れています）");
  }

  const problems = [];
  const push = (kind, detail) => problems.push({ kind, ...detail });

  for (const lbl of edgeLabels) {
    for (const line of polylines) {
      // 線の実体は幅 1〜2px のストローク。刻んだ矩形の合計で重なり面積を出す。
      let area = 0;
      for (const seg of line.strokes) area += overlapArea(lbl.rect, seg);
      if (area > MIN_OVERLAP_AREA) {
        push("線と文字の重なり", {
          label: lbl.text,
          labelId: lbl.id,
          other: line.id === lbl.id.split("_")[0] ? "自分の矢印" : line.id,
          area: Math.round(area),
        });
      }
    }

    for (const n of nodes) {
      const area = overlapArea(lbl.rect, n.rect);
      if (area > MIN_OVERLAP_AREA) {
        push("ノード／ノートと文字の重なり", {
          label: lbl.text,
          labelId: lbl.id,
          other: n.id,
          otherText: n.text,
          area: Math.round(area),
        });
      }
    }
  }

  for (const lane of lanes) {
    for (const { part, rect } of borderRects(lane.rect)) {
      // nodeTexts は「透明な text セルの枠」なので枠線とは交差してよい。
      // 判定に使うのは実際に描画される文字枠（vertexLabels / edgeLabels）だけ。
      for (const lbl of [...edgeLabels, ...vertexLabels]) {
        const area = overlapArea(lbl.rect, rect);
        if (area > MIN_OVERLAP_AREA) {
          push("レーン枠と文字の重なり", {
            label: lbl.text,
            labelId: lbl.id,
            other: `${lane.id} の${part}`,
            area: Math.round(area),
          });
        }
      }
    }
  }

  for (const lbl of edgeLabels) {
    if (lbl.rect.w < 4 || lbl.rect.h < 4) {
      push("ラベルサイズ未確定", {
        label: lbl.text,
        labelId: lbl.id,
        other: "折り返し幅が未指定のため 1 行に伸びる",
        area: 1,
      });
      continue;
    }
    if (lbl.rect.w > WRAP_WIDTH_WARN && lbl.lineCount <= 1) {
      push("折り返しなしの長ラベル", {
        label: lbl.text,
        labelId: lbl.id,
        other: `幅 ${Math.round(lbl.rect.w)}px`,
        area: Math.round(lbl.rect.w * lbl.rect.h),
      });
    }
  }

  const allLabels = [...edgeLabels, ...vertexLabels, ...nodeTexts];
  for (let i = 0; i < edgeLabels.length; i++) {
    for (const other of allLabels) {
      if (other === edgeLabels[i]) continue;
      const area = overlapArea(edgeLabels[i].rect, other.rect);
      if (area > MIN_OVERLAP_AREA) {
        push("ラベル同士の重なり", {
          label: edgeLabels[i].text,
          labelId: edgeLabels[i].id,
          other: `${other.id}（${other.text}）`,
          area: Math.round(area),
        });
      }
    }
  }

  const boxes = [...nodes, ...nodeTexts, ...lanes].map((r) => r.rect);
  let bounds = null;
  if (boxes.length > 0) {
    const minX = Math.min(...boxes.map((r) => r.x));
    const minY = Math.min(...boxes.map((r) => r.y));
    const maxX = Math.max(...boxes.map((r) => r.x + r.w));
    const maxY = Math.max(...boxes.map((r) => r.y + r.h));
    bounds = { x: Math.round(minX), y: Math.round(minY), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
  }

  return {
    page: { id: page.id, name: page.name },
    bounds,
    nodes: nodes.map((n) => ({ id: n.id, ...roundRect(n.rect) })),
    nodeTexts: nodeTexts.map((n) => ({ id: n.id, ...roundRect(n.rect) })),
    lanes: lanes.map((l) => ({ id: l.id, ...roundRect(l.rect) })),
    vertexLabels: vertexLabels.map((l) => ({ id: l.id, ...roundRect(l.rect) })),
    edgePaths: polylines.map((p) => ({
      id: p.id,
      pts: p.pts.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) })),
    })),
    counts: {
      edgeLabels: edgeLabels.length,
      vertexLabels: vertexLabels.length,
      nodes: nodes.length,
      lanes: lanes.length,
      edges: polylines.length,
    },
    edgeLabelRects: edgeLabels.map((l) => ({
      id: l.id,
      text: l.text,
      x: Math.round(l.rect.x),
      y: Math.round(l.rect.y),
      w: Math.round(l.rect.w),
      h: Math.round(l.rect.h),
    })),
    problems,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("Usage: node scripts/check-layout.mjs <file.drawio> [--page <n|name>] [--json]");
    process.exit(2);
  }
  const buf = fs.readFileSync(args.input);
  let text;
  if (buf.slice(1, 4).toString() === "PNG") {
    text = extractDrawioXmlFromPng(buf);
    if (!text) {
      console.error("PNG に draw.io XML が埋め込まれていません。");
      process.exit(2);
    }
  } else {
    text = buf.toString("utf8");
  }

  let result;
  try {
    result = inspectDiagram(text, args.page);
  } catch (err) {
    console.error(`検査に失敗しました: ${err && err.message ? err.message : err}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const c = result.counts;
    console.log(
      `ページ "${result.page.name}": エッジラベル ${c.edgeLabels} / ノードラベル ${c.vertexLabels} / ノード ${c.nodes} / レーン ${c.lanes} / 矢印 ${c.edges}`
    );
    if (result.problems.length === 0) {
      console.log("重なりなし：文字は線・ノード・レーン枠と交差していません。");
    } else {
      for (const p of result.problems) {
        const extra = p.otherText ? `（${p.otherText}）` : "";
        console.log(`- [${p.kind}] "${p.label}" × ${p.other}${extra} 重なり ${p.area}px²`);
      }
      console.log(`→ 合計 ${result.problems.length} 件の重なりを検出`);
    }
  }
  process.exit(result.problems.length > 0 ? 1 : 0);
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (invokedDirectly) await main();
