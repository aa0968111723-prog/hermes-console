import { buildProfile, contextGraph } from "../audience/engine";
import { evaluateArtifact, evaluationEnvelope } from "../audience/evaluation";
import { wantsReverseThinking } from "../audience";
import { runReverseThinkingEvaluation } from "../audience-twin/reverse-thinking";
import { debateFromEvaluations } from "../audience/debate";
import { searchInspiration } from "../inspiration/engine";
import { researchBundle } from "../research/providers";
import { canvaStatus } from "../canva";
import { WORKSPACE_OWNER } from "../security";
import {
  directionToSpec,
  validateSpecForTemplate,
  revisionFromAudience,
} from "./spec";
import {
  rankDirections,
  creativeFingerprint,
  type RankableDirection,
} from "./ranking";
import { socialDrafts } from "./social";
import { routeToolsets } from "../projects/router";
import { instagramPublishStatus } from "../publish";

function directionsFor(prompt: string): RankableDirection[] {
  if (/攝影/.test(prompt))
    return [
      {
        title: "帶一臺相機，認識淡水的光",
        coreIdea: "用拍攝任務當見面理由",
        claim: "大一用鏡頭認識校園與淡水，不是比賽。",
        visual: "克難坡逆光、同學並肩看螢幕",
        copy: "週三傍晚，淡江校園集合，一起拍到捷運站的路。",
        cta: "帶手機就好，來走一段。",
      },
      {
        title: " fort-a",
        coreIdea: "x",
        claim: "x",
        visual: "x",
        copy: "xxxxxxxx",
        cta: "x",
      },
    ].filter((d) => !d.title.includes("fort"));
  const zen = /禪|靜定/.test(prompt);
  return [
    {
      title: "先找人，再慢慢坐下來",
      coreIdea: "茶會是認識朋友的低門檻場合",
      claim: "給淡江大一一個不用先懂術語的見面方式。",
      visual: "白天校園座位、紙杯、同學聊天",
      copy: "週三傍晚在淡江校園，禪學社請你來坐一下。時間地點寫在圖上。",
      cta: "來坐一下",
    },
    {
      title: zen ? "改變自己，從靜定開始" : "改變自己，從第一堂課開始",
      coreIdea: zen ? "以靜定為方法" : "以學習為方法",
      claim: zen ? "靜定是練習，不是口號。" : "一起把課堂外的時間用掉。",
      visual: zen ? "抽象留白與香爐" : "教室走廊人流",
      copy: zen
        ? "改變自己，從靜定開始。"
        : "課堂結束後來走廊集合，帶上你的問題。",
      cta: "了解活動",
    },
    {
      title: "淡水捷運出站後的第一個社團",
      coreIdea: "把交通動線寫進文案",
      claim: "告訴新生怎麼走到現場。",
      visual: "淡水捷運與坡道示意",
      copy: "出站後往校園方向走，看板會寫禪學社茶會。",
      cta: "看路線",
    },
  ];
}

export function runCreativeIntelligence(input: {
  prompt: string;
  projectId?: string;
  tamkangReachable?: boolean;
}) {
  const projectId = input.projectId || "personal";
  const research = researchBundle({
    prompt: input.prompt,
    mcpReachable: input.tamkangReachable,
  });
  const profile = buildProfile({
    projectId,
    institution: /台大/.test(input.prompt) ? "國立臺灣大學" : "淡江大學",
    location: /台大/.test(input.prompt) ? "公館" : "淡水",
    name: /台大/.test(input.prompt) ? "台大大一新生" : "淡江大一新生",
  });
  const graph = contextGraph(profile.institution);
  const directions = directionsFor(input.prompt);
  const evaluations = directions.map((direction) =>
    evaluateArtifact({
      profile,
      copy: direction.copy,
      title: direction.title,
    }),
  );
  const ranking = rankDirections({
    directions,
    scores: evaluations.map((roles) => roles[0].scores.scores),
  });
  const selected = directions[ranking.ranking[0]?.index || 0];
  const canva = canvaStatus(WORKSPACE_OWNER);
  const spec = directionToSpec(selected, "生活場景優先，術語放副標。");
  const datasetCheck = validateSpecForTemplate(spec, {
    TITLE: { type: "text" },
    SUBTITLE: { type: "text" },
    CTA: { type: "text" },
  });
  const inspiration = searchInspiration({
    prompt: input.prompt,
    projectId,
  });
  return {
    research,
    profile,
    graph,
    inspiration,
    directions,
    evaluations: evaluations.map(evaluationEnvelope),
    debate: debateFromEvaluations(evaluations[ranking.ranking[0]?.index || 0]),
    ranking,
    fingerprint: creativeFingerprint(
      /攝影/.test(input.prompt) ? "攝影社" : "禪學社",
      selected.copy + directions.map((d) => d.copy).join(" "),
    ),
    canva: {
      spec,
      datasetCheck,
      revision: revisionFromAudience(selected.copy),
      status: canva.needsAuthorization
        ? "Needs Canva Authorization"
        : canva.configured
          ? canva.state
          : "unconfigured",
    },
    social: socialDrafts({
      title: selected.title,
      copy: selected.copy,
      cta: selected.cta,
      audience: profile.name,
    }),
    tools: routeToolsets(input.prompt),
    publish: instagramPublishStatus(),
    reverseThinking: wantsReverseThinking(input.prompt)
      ? runReverseThinkingEvaluation({
          prompt: input.prompt,
          conceptTitle: selected.title,
          description: selected.copy,
          copyExcerpt: selected.copy,
          projectId,
          institution: profile.institution,
          location: profile.location,
        })
      : null,
  };
}
