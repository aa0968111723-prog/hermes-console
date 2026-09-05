import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAS,
  TAMKANG_PERSONAS,
  NTU_PERSONAS,
  GENERAL_PERSONAS,
  extractContextFacts,
  resolveContextDomain,
  resolvePersonasForContext,
  simulateAudienceReaction,
} from "../lib/server/audience-twin/engine.ts";
import { AUDIENCE_DISCLAIMER } from "../lib/server/audience.ts";
import { officialWebSources } from "../lib/server/research/providers.ts";

test("Phase 5 Audience Twin is contextual and evidence grounded", async (t) => {
  await t.test("named personas are console fixtures, not live respondents", () => {
    assert.equal(PERSONAS.length, 5);
    for (const persona of [...TAMKANG_PERSONAS, ...NTU_PERSONAS, ...GENERAL_PERSONAS]) {
      assert.equal(persona.sourceKind, "console_fixture");
      assert.equal(persona.simulation, true);
      assert.equal(persona.method, "ai_heuristic");
    }
    assert.ok(TAMKANG_PERSONAS.every((p) => p.domain === "tamkang"));
    assert.ok(NTU_PERSONAS.every((p) => p.domain === "ntu"));
    assert.ok(GENERAL_PERSONAS.every((p) => p.domain === "general"));
  });

  await t.test("domain resolution is contextual and does not treat 腳踏車 as NTU", () => {
    assert.equal(resolveContextDomain("幫我做給淡江大學大一新生看的禪學社茶會網宣"), "tamkang");
    assert.equal(resolveContextDomain("幫我做給臺灣大學大一新生看的野餐茶會網宣"), "ntu");
    assert.equal(resolveContextDomain("社團迎新海報", "personal"), "general");
    assert.equal(resolveContextDomain("腳踏車停車格怎麼畫"), "general");
    const ntu = resolvePersonasForContext("台大椰林大道迎新", "ntu");
    assert.equal(ntu.domain, "ntu");
    assert.equal(ntu.personas[0].name, "大一新生・宇軒 (電機系)");
  });

  await t.test("evidence requires official URL, console notes, or project spec", () => {
    const tku = extractContextFacts("克難坡茶會", "tamkang");
    const evidence = tku.filter((f) => f.kind === "evidence");
    const hypotheses = tku.filter((f) => f.kind === "hypothesis");
    assert.ok(evidence.length >= 3);
    assert.ok(hypotheses.length >= 2);
    assert.ok(evidence.every((f) => f.sourceTag.startsWith("[")));
    assert.ok(evidence.every((f) => f.liveFetch === false));
    assert.ok(
      evidence.every((f) =>
        f.sourceKind === "official_web" ||
        f.sourceKind === "console_notes" ||
        f.sourceKind === "console_spec",
      ),
    );
    assert.ok(evidence.some((f) => f.sourceUrl === "https://www.tku.edu.tw/"));
    assert.ok(hypotheses.every((f) => f.sourceKind === "heuristic"));
    assert.ok(hypotheses.some((f) => /停留秒數|0\.8s|赴約意願/.test(f.statement)));
    assert.ok(!tku.some((f) => f.kind === "evidence" && /好感度統計|問卷/.test(f.sourceTag)));
  });

  await t.test("NTU facts stay on NTU sources and do not leak Tamkang landmarks", () => {
    const ntu = extractContextFacts("椰林大道野餐", "ntu");
    const blob = ntu.map((f) => f.statement).join(" ");
    assert.ok(blob.includes("椰林大道") || blob.includes("醉月湖"));
    assert.ok(!blob.includes("克難坡"));
    assert.ok(!blob.includes("福園"));
    assert.ok(ntu.some((f) => f.sourceUrl === "https://www.ntu.edu.tw/"));
    const sources = officialWebSources();
    assert.ok(sources.some((s) => s.url.includes("tku.edu.tw")));
    assert.ok(sources.some((s) => s.url.includes("ntu.edu.tw")));
  });

  await t.test("simulation envelope is heuristic and not a market survey", () => {
    const result = simulateAudienceReaction(
      "克難坡登頂後的 15 分鐘心靈茶席",
      "以大一新生每天爬 132 階克難坡的痛點為切入，提供免費清香冷泡茶與大一選課不踩雷攻略分享，保證零社交壓力。",
      "日系雜誌排版，留白充足，手作三色光道具印章置於右下角 36px，符合規範。",
      "到底誰發明了 132 階克難坡？爬上來的大一新生，這杯冷泡茶我們請你喝。",
    );
    assert.equal(result.simulation, true);
    assert.equal(result.method, "ai_heuristic");
    assert.equal(result.personaSource, "console_fixture");
    assert.equal(result.domain, "tamkang");
    assert.equal(result.disclaimer, AUDIENCE_DISCLAIMER);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.scores, "conversionRate"),
      false,
    );
    assert.ok(result.facts?.every((f) => f.liveFetch === false));
    const ntu = simulateAudienceReaction(
      "台大椰林大道迎新野餐交流會",
      "以大一新生椰林迷路與通識避雷為切入。",
      "手作三色光道具印章置於右下角 36px。",
      "初到椰林大道總是在迷路嗎？",
      "ntu",
    );
    assert.equal(ntu.domain, "ntu");
    assert.equal(ntu.feedback[0].name, "大一新生・宇軒 (電機系)");
    const ntuFacts = ntu.facts?.map((f) => f.statement).join(" ") || "";
    assert.ok(!ntuFacts.includes("克難坡"));
  });
});
