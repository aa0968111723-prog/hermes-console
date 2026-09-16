import type { TaskFocus } from "../contracts";

export function revisionLabel(revision: number) {
  return "V" + revision;
}

export function continueCopy(copyId: string, revision: number) {
  return {
    text:
      "請接續修改這個作品（第 " +
      revision +
      " 版）。不要另做無關的新作品。",
    focus: { copyId, revision } satisfies TaskFocus,
  };
}

export function continueDesign(workflowId: string) {
  return {
    text: "請接續修改這個作品。",
    focus: /^[a-f0-9]{64}$/.test(workflowId)
      ? ({ workflowId } satisfies TaskFocus)
      : undefined,
  };
}

export function continueActivity(activityId: string) {
  return {
    text: "請依這個活動已確認的資訊提出三個方向，保存後等我選擇。私人資訊不得用於公開文宣。",
    focus: { activityId } satisfies TaskFocus,
  };
}

export function continueProjectDraft() {
  return {
    text:
      "請查回這個專案的活動、來源及已有文案，核對後接續網宣草稿。" +
      "缺少日期或地點先問我，不要捏造。",
  };
}

export function continueCaptionSet() {
  return {
    text:
      "請先查回活動日期與地點；未確認就標未確認，不要捏造。" +
      "產出 IG caption A 最自然、B 最有梗、C 最溫暖三版，順序 " +
      "HOOK→生活場景→活動→為什麼來→時間地點→CTA。" +
      "不要宗教宣傳。寫完後做新生視角審核，不要發佈。",
  };
}

export function selectDirection(workflowId: string, direction: number) {
  return {
    text: "已選定方向 " + direction + "。請依此製作。",
    focus: /^[a-f0-9]{64}$/.test(workflowId)
      ? ({ workflowId, direction } satisfies TaskFocus)
      : undefined,
  };
}

export function continueCurrentDesign(
  workflows: { id: string; projectId: string; updatedAt: string }[],
  projectId: string,
) {
  const current = workflows
    .filter((row) => row.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (current) return continueDesign(current.id);
  return { text: "請接續我現有的設計。", focus: undefined };
}
