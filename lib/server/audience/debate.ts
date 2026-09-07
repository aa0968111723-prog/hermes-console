import type { RoleEvaluation } from "./types";

export function debateFromEvaluations(roles: RoleEvaluation[]) {
  const perspectives = roles.map((role) => ({
    perspective: role.role,
    position: role.firstReaction,
    keyConcern: role.objections[0] || role.questions[0] || role.dropOffReasons[0] || "無明顯疑慮",
    recommendation: role.recommendedChanges[0] || "保留生活場景與時間地點",
  }));
  const concerns = perspectives.map((item) => item.keyConcern);
  return {
    perspectives,
    consensus: [
      "主標要讓大一立刻懂",
      "放進校園／生活線索",
      "時間地點清楚",
    ],
    unresolved: concerns.filter((item, index) => concerns.indexOf(item) === index).slice(0, 4),
    recommendedDirection: "生活場景當主標，活動特質放副標，避免術語當第一眼。",
  };
}
