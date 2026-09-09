import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONSOLE_DATA_DIR = await mkdtemp(
  join(tmpdir(), "hermes-audience-twin-"),
);
process.env.CONSOLE_ORIGIN = "http://localhost:3240";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
delete process.env.CONSOLE_GATEWAY_SECRET;
process.env.CONSOLE_REQUIRE_GATEWAY = "false";

const { FRESHMAN_PERSONA_IDS, TWIN_METRICS } = await import(
  "../lib/server/audience/types"
);
const {
  simulateFreshmanReactions,
  isTwinPanel,
  assertComparativeScores,
} = await import("../lib/server/audience/personas");
const { evaluateArtifact, evaluateWithTwins } = await import(
  "../lib/server/audience/evaluation"
);
const { buildProfile } = await import("../lib/server/audience/engine");
const { permissionClass, autoAllowed } = await import(
  "../lib/server/permissions"
);
const { toolsList, callTool } = await import("../lib/server/mcp");
const audienceRoute = await import("../app/api/audience/route");
const { AUDIENCE_INSTRUCTION_PACK } = await import("../lib/server/hermes");

function request(body: unknown) {
  return new Request("http://localhost:3240/api/audience", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: JSON.stringify(body),
  });
}

const slogan = {
  kind: "poster",
  title: "改變自己，從靜定開始",
  copy: "改變自己，從靜定開始。",
};
const tea = {
  kind: "event",
  title: "淡水校園茶會",
  copy: "週五晚上 7 點，淡水校園茶會。來坐一下認識朋友，不用準備。",
};
const slop = {
  kind: "ig",
  title: "靈魂覺醒",
  copy: "在金色光暈中遇見內在宇宙，讓靈魂覺醒。",
};
const form = {
  kind: "form",
  title: "報名",
  copy: "請填寫宗教信仰與家長電話後再送出。",
};

test("ten freshman personas simulate first reactions with comparative scores", () => {
  const panel = simulateFreshmanReactions(slogan);
  assert.equal(isTwinPanel(panel), true);
  assert.equal(panel.simulation, true);
  assert.equal(panel.truth, "SIMULATION");
  assert.equal(panel.scoreUse, "comparative");
  assert.equal(panel.personas.length, FRESHMAN_PERSONA_IDS.length);
  assert.deepEqual(
    panel.personas.map((item) => item.personaId),
    [...FRESHMAN_PERSONA_IDS],
  );
  const check = assertComparativeScores(panel);
  assert.equal(check.varied, true);
  assert.equal(check.inflated, false);
  for (const persona of panel.personas) {
    for (const key of TWIN_METRICS) {
      const value = persona.scores.scores[key];
      assert.ok(value >= 12 && value <= 78, `${persona.personaId}.${key}=${value}`);
      assert.equal(Object.hasOwn(persona.scores.scores, "conversionRate"), false);
    }
    assert.ok(persona.firstReaction.length > 8);
    assert.ok(persona.why.length >= 1);
    assert.equal(JSON.stringify(persona).includes("chain-of-thought"), false);
  }
  const wary = panel.personas.find((item) => item.personaId === "religion_wary");
  assert.ok(wary);
  assert.ok(wary.scores.scores.religiousPressure >= 50);
  assert.equal(wary.wouldFillForm, false);
});

test("tea event beats slogan on stop/trust for social and religion-wary personas", () => {
  const hard = simulateFreshmanReactions(slogan);
  const easy = simulateFreshmanReactions(tea);
  const socialHard = hard.personas.find((item) => item.personaId === "social")!;
  const socialEasy = easy.personas.find((item) => item.personaId === "social")!;
  const waryHard = hard.personas.find((item) => item.personaId === "religion_wary")!;
  const waryEasy = easy.personas.find((item) => item.personaId === "religion_wary")!;
  assert.ok(socialEasy.scores.scores.stopRate > socialHard.scores.scores.stopRate);
  assert.ok(
    waryEasy.scores.scores.religiousPressure <
      waryHard.scores.scores.religiousPressure,
  );
  assert.ok(easy.personas.some((item) => item.wouldStop));
});

test("missing visual notes stay UNKNOWN; AI slop raises design-eye risk", () => {
  const poster = simulateFreshmanReactions(slogan);
  assert.ok(poster.unknowns.some((item) => item.includes("沒有視覺描述")));
  const design = simulateFreshmanReactions(slop).personas.find(
    (item) => item.personaId === "design_eye",
  )!;
  assert.ok(design.scores.scores.aiSlop >= 50);
  assert.ok(design.firstReaction.includes("AI") || design.firstReaction.includes("套版"));
});

test("religion field on a form blocks fill for the wary twin", () => {
  const panel = simulateFreshmanReactions(form);
  const wary = panel.personas.find((item) => item.personaId === "religion_wary")!;
  assert.equal(wary.wouldFillForm, false);
  assert.ok(wary.scores.scores.religiousPressure >= 58);
});

test("evaluateArtifact contract stays and evaluateWithTwins attaches the panel", () => {
  const profile = buildProfile({
    projectId: "personal",
    institution: "淡江大學",
    location: "淡水",
    name: "淡江大一新生",
  });
  const roles = evaluateArtifact({
    profile,
    title: slogan.title,
    copy: slogan.copy,
  });
  assert.ok(
    roles.find((role) => role.role === "Target")?.firstReaction.includes("靜定"),
  );
  const evaluated = evaluateWithTwins({
    profile,
    title: slogan.title,
    copy: slogan.copy,
    kind: "poster",
  });
  assert.equal(evaluated.simulation, true);
  assert.equal(evaluated.twinPanel.personas.length, 10);
});

test("API simulate/evaluate and MCP tool stay labelled simulation", async () => {
  assert.equal(permissionClass("workspace_simulate_audience"), "read");
  assert.equal(autoAllowed("workspace_simulate_audience"), true);
  const listed = toolsList("workspace").map((tool) => tool.name);
  assert.ok(listed.includes("workspace_simulate_audience"));
  const tool = await callTool("workspace", "workspace_simulate_audience", tea);
  const text = JSON.parse(
    (tool as { content: Array<{ text: string }> }).content[0].text,
  );
  assert.equal(isTwinPanel(text), true);
  const api = await audienceRoute.POST(
    request({
      action: "simulate",
      ...tea,
    }),
  );
  assert.equal(api.status, 200);
  const json = await api.json();
  assert.equal(json.simulation, true);
  assert.equal(json.scoreUse, "comparative");
  const evaluate = await audienceRoute.POST(
    request({
      action: "evaluate",
      ...slogan,
    }),
  );
  assert.equal(evaluate.status, 200);
  const evalJson = await evaluate.json();
  assert.equal(evalJson.twinPanel.personas.length, 10);
  assert.ok(AUDIENCE_INSTRUCTION_PACK.includes("workspace_simulate_audience"));
  assert.ok(AUDIENCE_INSTRUCTION_PACK.includes("比較工具"));
});
