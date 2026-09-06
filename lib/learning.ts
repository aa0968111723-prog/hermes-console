import { z } from "zod";
import { projectKey, sourceURL } from "./creative";
export const learningCategories = {
  preference: "語言與偏好", brand: "品牌與視覺", knowledge: "專案知識", skill: "工作方法與技能",
} as const;
export const learningInput = z.object({
  id: z.string().uuid().optional(),
  projectId: projectKey,
  expectedRevision: z.number().int().min(0),
  operationId: z.string().uuid(),
  parentId: z.string().uuid().nullable().default(null),
  category: z.enum(["preference", "brand", "knowledge", "skill"]),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(1600),
  sources: z.array(sourceURL.max(300)).max(4).default([]),
  materialIds: z.array(z.string().uuid()).max(4).default([]),
}).strict();
export type LearningVersion = Pick<z.infer<typeof learningInput>, "category" | "title" | "content" | "sources" | "parentId" | "materialIds"> & {
  revision: number; savedAt: string;
};
export type LearningAttempt = {
  id: string; action: "learn" | "forget"; revision: number; createdAt: string;
  taskId: string | null; conversationId: string | null; error: string | null;
};
export type LearningNode = LearningVersion & {
  id: string; projectId: string; history: LearningVersion[]; attempts: LearningAttempt[];
};
export type LearningView = LearningNode & {
  state: "draft" | "waiting_configuration" | "running" | "review_required" | "failed" | "uncertain";
  taskState: string | null; lastAction: "learn" | "forget" | null;
  remoteVerified: false;
};
export const learningStates = {
  draft: "學習資料草稿", waiting_configuration: "等待連線／設定",
  running: "Hermes 執行中", review_required: "執行完成・保存待驗證",
  failed: "執行失敗／已停止", uncertain: "結果待確認，勿重複執行",
} as const;
