#!/usr/bin/env node
/**
 * drawio-workflow スキルの回帰テスト。
 *
 * 生成結果の「あたりまえ」を機械的に確かめる:
 *   1. ラベル付きエッジが、折返し幅を持つ edgeLabel 子セルとして出ている
 *      （エッジの value に直接書くと折り返し幅が未確定のまま 1 行に伸びる）
 *   2. レーンヘッダーの向きが正しい（横方向レーンは horizontal=0 + text 子セル、
 *      縦方向レーンは horizontal=1）。value を直接置くと日本語が 90° 回転して見える
 *   3. 実測レイアウトで、文字が線・ノード・レーン枠と重なっていない
 *
 * 実行: node scripts/selftest.mjs  もしくな `npm test`
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildWorkflowWithLabelCheck } from "./build-workflow.mjs";
import { extractDrawioXmlFromPng } from "./drawio2png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(here, "..", "examples", "order-checkout-workflow.json");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dwf-selftest-"));

const failures = [];
const notes = [];

function check(ok, message) {
  if (ok) notes.push(`  ok  ${message}`);
  else failures.push(message);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function lintXml(xml, direction, expectedLabels) {
  const labelTags = xml.match(/<mxCell[^>]*style="edgeLabel[^>]*>/g) || [];
  const labeledEdges = (xml.match(/<mxCell[^>]*edge="1"[^>]*>/g) || []).filter(
    (tag) => attr(tag, "value") && attr(tag, "value").trim() !== ""
  );

  check(
    labeledEdges.length === 0,
    `${direction}: エッジの value に直接書いたラベルが無い（実測 ${labeledEdges.length} 件）`
  );

  check(
    labelTags.length === expectedLabels,
    `${direction}: edgeLabel 子セルが ${expectedLabels} 個（実測 ${labelTags.length} 個）`
  );
  const labelCells = labelTags;

  let badBox = 0;
  for (const tag of labelCells) {
    const id = attr(tag, "id");
    const geom = new RegExp(`${id}"[\\s\\S]{0,400}?<mxGeometry[^>]*width="(\\d+)" height="(\\d+)"`).exec(xml);
    if (!geom || Number(geom[1]) < 20 || Number(geom[2]) < 12) badBox++;
  }
  check(badBox === 0, `${direction}: 全ての edgeLabel に折返し幅と高さがある（不足 ${badBox} 個）`);

  const lanes = xml.match(/<mxCell[^>]*style="[^"]*swimlane[^"]*"[^>]*>/g) || [];
  const rotatedLanes = lanes.filter((tag) => /horizontal=0/.test(attr(tag, "style") || ""));
  // horizontal=0 の swimlane に value を置くと日本語が 90° 回転して縦読みに見える。
  const rotatedTitled = rotatedLanes.filter(
    (tag) => (attr(tag, "value") || "").trim() !== ""
  );
  check(
    rotatedTitled.length === 0,
    `${direction}: 回転したレーンに直接ラベルを置いていない（実測 ${rotatedTitled.length} 件）`
  );

  if (direction === "horizontal") {
    check(
      rotatedLanes.length === lanes.length && lanes.length > 0,
      `horizontal: 全レーンが swimlane;horizontal=0（${rotatedLanes.length}/${lanes.length}）`
    );
    const headers = xml.match(/<mxCell[^>]*style="text;html=1[^>]*>/g) || [];
    check(headers.length >= lanes.length, `horizontal: レーン見出しが text 子セル（${headers.length} 個）`);
  } else {
    check(
      rotatedLanes.length === 0 && lanes.length > 0,
      `vertical: 全レーンが swimlane;horizontal=1（回転 ${rotatedLanes.length}/${lanes.length}）`
    );
  }
}

for (const direction of ["horizontal", "vertical"]) {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const expectedLabels = (spec.edges || []).filter((e) => e.label).length;
  const { xml, problems, rounds } = buildWorkflowWithLabelCheck(spec, direction);
  lintXml(xml, direction, expectedLabels);
  check(
    problems.length === 0,
    `${direction}: 文字と線・ノード・レーン枠の重なり 0 件（rounds=${rounds}${
      problems.length ? ` → ${problems.map((p) => `${p.kind}:${p.label}`).join(" / ")}` : ""
    }）`
  );

  const drawioPath = path.join(outDir, `${direction}.drawio`);
  const pngPath = path.join(outDir, `${direction}.drawio.png`);
  fs.writeFileSync(drawioPath, xml);
  execFileSync(
    process.execPath,
    [
      path.join(here, "drawio2png.mjs"),
      drawioPath,
      "--output",
      pngPath,
    ],
    { stdio: "pipe" }
  );
  const pngBytes = fs.readFileSync(pngPath);
  check(pngBytes.subarray(1, 4).toString("latin1") === "PNG", `${direction}: PNG を書いた`);
  const roundTrip = extractDrawioXmlFromPng(pngBytes);
  check(
    typeof roundTrip === "string" && roundTrip.includes("mxGraphModel"),
    `${direction}: PNG から XML を復元できた（再編集可能）`
  );
}

// --- 検査器自身と上書きオプションの防衛（レビューで出た挙動の回帰） -------------
function checkerExit(args) {
  try {
    execFileSync(process.execPath, [path.join(here, "check-layout.mjs"), ...args], {
      stdio: "pipe",
    });
    return 0;
  } catch (err) {
    return err.status;
  }
}

const demoDrawio = path.join(outDir, "horizontal.drawio");
check(
  checkerExit([demoDrawio, "--page", "存在しないページ"]) === 2,
  "check-layout: 存在しない --page は先頭ページを黙って検査せず終了 2"
);
const truncatedPath = path.join(outDir, "truncated.drawio");
fs.writeFileSync(truncatedPath, '<mxGraphModel><root><mxCell id="0" />');
check(
  checkerExit([truncatedPath]) === 2,
  "check-layout: 途中で切れた XML を「問題なし」にせず終了 2"
);

const autoSpec = JSON.parse(fs.readFileSync(specPath, "utf8"));
autoSpec.edges = (autoSpec.edges || []).map((e) => ({ ...e, labelPosition: "auto" }));
const autoBuild = buildWorkflowWithLabelCheck(autoSpec, "vertical");
check(
  autoBuild.problems.length === 0,
  `edges[].labelPosition "auto" は位置指定なしとして自動配置（重なり ${autoBuild.problems.length} 件）`
);

console.log("drawio-workflow selftest");
for (const line of notes) console.log(line);
if (failures.length) {
  console.log(`\nFAIL ${failures.length} 件:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nPASS（${notes.length} 項目）`);
fs.rmSync(outDir, { recursive: true, force: true });
