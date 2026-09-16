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

export function selectDirection(workflowId: string, direction: number) {
  return {
    text: "已選定方向 " + direction + "。請依此製作。",
    focus: { workflowId, direction } satisfies TaskFocus,
  };
}
