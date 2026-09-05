import { heuristicScores } from "./scoring";
import {
  AUDIENCE_ROLES,
  SIMULATION,
  type AudienceProfile,
  type AudienceRole,
  type RoleEvaluation,
} from "./types";

export function evaluateArtifact(input: {
  profile: AudienceProfile;
  copy: string;
  title?: string;
}): RoleEvaluation[] {
  const base = heuristicScores({
    copy: (input.title || "") + "\n" + input.copy,
    audienceLocation: input.profile.location,
    audienceInstitution: input.profile.institution,
  });
  const jargon = /靜定|禪修/.test(input.copy + input.title);
  const local = new RegExp(input.profile.location).test(input.copy + (input.title || ""));
  return AUDIENCE_ROLES.map((role: AudienceRole) => {
    const freshmanConfused = role === "Target" && jargon;
    const skepticReligion = role === "Skeptic" && jargon;
    return {
      role,
      firstReaction: freshmanConfused
        ? "我不太確定「靜定」是什麼。"
        : skepticReligion
          ? "這看起來可能像宗教活動。"
          : role === "Peer"
            ? local
              ? "有校園生活感比較想轉傳。"
              : "還不知道跟我們的生活有什麼關係。"
            : role === "Bystander"
              ? "如果一眼看不懂就滑掉。"
              : "主標用生活場景，術語放副標。",
      positiveSignals: local ? ["有在地線索"] : [],
      questions: freshmanConfused ? ["這跟社團茶會有什麼關係？"] : [],
      objections: skepticReligion ? ["資訊不夠透明，距離感偏高"] : [],
      dropOffReasons: jargon && !local ? ["術語先行", "缺少生活場景"] : [],
      shareReasons: local ? ["同學用得到的地點／時間"] : [],
      joinReasons: /茶會|迎新|朋友/.test(input.copy) ? ["低門檻見面"] : [],
      recommendedChanges:
        role === "CreativeDirector"
          ? ["主標改生活場景", "靜定／禪轉副標", "放時間地點"]
          : [],
      scores: base,
      confidence: 0.4,
      sources: [],
    } satisfies RoleEvaluation;
  });
}

export function evaluationEnvelope(roles: RoleEvaluation[]) {
  return {
    ...SIMULATION,
    roles,
    note: "分數是 AI heuristic simulation，不是 conversionRate／CTR／actualStopRate。",
  };
}
