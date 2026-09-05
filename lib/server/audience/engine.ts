import { randomUUID } from "node:crypto";
import { classifyFact } from "../audience";
import type {
  AudienceEvidence,
  AudienceHypothesis,
  AudienceProfile,
  GraphEdge,
  GraphNode,
} from "./types";

export function contextGraph(institution: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const campus =
    /淡江/.test(institution)
      ? ["Dorm", "Campus", "Clubs", "Friends", "Food", "Study", "Commute", "Tamsui", "Kenanpo"]
      : /台大|臺灣大學|台灣大學/.test(institution)
        ? ["Dorm", "Campus", "Clubs", "Friends", "Food", "Study", "Commute", "Gongguan"]
        : ["Dorm", "Campus", "Clubs", "Friends", "Food", "Study", "Commute"];
  const extra = ["SelfDiscovery", "Stress", "FreeTime", "SocialMedia"];
  const nodes = [...campus, ...extra].map((id) => ({
    id,
    label: id,
    kind: "context",
  }));
  const chain = campus;
  const edges: GraphEdge[] = chain.slice(1).map((to, index) => ({
    from: chain[index],
    to,
    sourceId: null,
  }));
  return { nodes, edges };
}

export function splitClaims(
  audienceId: string,
  claims: Array<{ claim: string; sourceId?: string | null; category: string }>,
): { evidence: AudienceEvidence[]; hypotheses: AudienceHypothesis[] } {
  const evidence: AudienceEvidence[] = [];
  const hypotheses: AudienceHypothesis[] = [];
  for (const item of claims) {
    const kind = classifyFact(item.claim, item.sourceId || null);
    if (kind === "evidence" && item.sourceId) {
      evidence.push({
        id: randomUUID(),
        audienceId,
        claim: item.claim,
        sourceId: item.sourceId,
        confidence: 0.7,
        category: item.category,
        createdAt: new Date().toISOString(),
      });
    } else {
      hypotheses.push({
        id: randomUUID(),
        audienceId,
        statement: item.claim,
        basis: item.sourceId ? "untrusted claim" : "no source",
        confidence: 0.35,
        status: "active",
      });
    }
  }
  return { evidence, hypotheses };
}

export function buildProfile(input: {
  projectId: string;
  institution: string;
  location: string;
  name: string;
  evidence?: AudienceEvidence[];
}): AudienceProfile {
  const now = new Date().toISOString();
  const tku = /淡江/.test(input.institution);
  const ntu = /台大|臺灣大學|台灣大學/.test(input.institution);
  return {
    id: randomUUID(),
    projectId: input.projectId,
    name: input.name,
    description: `${input.institution} 大一生活轉換期模擬，不是調查樣本。`,
    location: input.location,
    institution: input.institution,
    ageRange: "18–19",
    lifeStage: "university-entry",
    goals: tku
      ? ["在淡水找到生活節奏", "認識社團朋友", "搞懂校園動線"]
      : ntu
        ? ["熟悉公館生活圈", "認識社團", "適應大班課"]
        : ["認識朋友", "適應大學"],
    needs: tku
      ? ["克難坡／交通怎麼走", "低門檻的見面場合", "吃的與住宿線索"]
      : ntu
        ? ["公館移動", "社團攤位怎麼逛", "宿舍或通勤選擇"]
        : ["活動時間地點清楚"],
    painPoints: ["新環境", "選擇過載", "怕看起來很外行"],
    fears: ["太正式", "看不懂主標", "被當成宣教"],
    questions: tku
      ? ["在淡水校園好找嗎？", "大一也會去嗎？"]
      : ["在哪集合？", "去了會認識人嗎？"],
    socialContext: ["IG", "社團群組", "同學邀約"],
    dailyScenes: tku
      ? ["淡水捷運", "克難坡", "校園坡地", "社團博覽"]
      : ntu
        ? ["公館商圈", "校總區", "社團博覽"]
        : ["校園", "宿舍"],
    mediaHabits: ["IG 快速滑過", "同學轉傳才停"],
    decisionTriggers: ["同學一起", "時間地點清楚", "現場好找"],
    scrollTriggers: ["抽象口號", "資訊過載", "企業感排版"],
    rejectionTriggers: ["像在上課", "權利義務不明", "距離感高的術語"],
    evidenceIds: (input.evidence || []).map((item) => item.id),
    hypotheses: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function antiGeneric(a: AudienceProfile, b: AudienceProfile) {
  const same =
    a.location === b.location &&
    a.institution === b.institution &&
    a.dailyScenes.join() === b.dailyScenes.join() &&
    a.needs.join() === b.needs.join();
  return { tooGeneric: same, reason: same ? "institution/location context missing" : null };
}
