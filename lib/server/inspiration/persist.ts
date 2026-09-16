import { createHash } from "node:crypto";
import { saveActivity, saveCopy, copyDocument } from "../creative";
import { bindWorkflowDraft, type Workflow } from "../workflows";
import type { DirectionBriefPack } from "../../direction-brief";

export function uuidFromSeed(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-" +
    variant +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

function existingCopy(owner: string, id: string | null | undefined) {
  if (!id) return null;
  try {
    return copyDocument(owner, id);
  } catch {
    return null;
  }
}

export function persistSelectedDirectionDraft(
  owner: string,
  record: Workflow,
): Workflow {
  const brief = record.directionBrief;
  if (!brief || record.selected === null) return record;
  const activity =
    record.activityId
      ? { id: record.activityId }
      : saveActivity(
          owner,
          {
            projectId: record.projectId,
            expectedRevision: 0,
            operationId: uuidFromSeed("activity:" + record.id),
            title: (record.brief || brief.title).slice(0, 120) || "未確認活動",
            facts: [],
          },
          "owner",
        );
  const bound = record.activityId
    ? record
    : bindWorkflowDraft(owner, record.id, { activityId: activity.id });
  const previous = existingCopy(owner, bound.copyId);
  const last = previous?.revisions.at(-1);
  const pages = [
    {
      title: "A 最自然",
      body: brief.copy.a,
      visual: brief.formats[0]?.compositionHint || "",
    },
    {
      title: "B 最有梗",
      body: brief.copy.b,
      visual: brief.formats[1]?.compositionHint || "",
    },
    {
      title: "C 最溫暖",
      body: brief.copy.c,
      visual: brief.formats[2]?.compositionHint || "",
    },
  ];
  const title = ("方向 " + brief.selected + "｜" + brief.title).slice(0, 150);
  const unchanged =
    last &&
    last.title === title &&
    last.pages.length === pages.length &&
    last.pages.every(
      (page, index) =>
        page.title === pages[index].title && page.body === pages[index].body,
    );
  const document =
    unchanged && previous
      ? previous
      : saveCopy(
          owner,
          {
            id: previous?.id,
            projectId: bound.projectId,
            activityId: activity.id,
            workflowId: bound.id,
            expectedRevision: last?.revision || 0,
            operationId: uuidFromSeed(
              "copy:" +
                bound.id +
                ":" +
                brief.selected +
                ":" +
                (last?.revision || 0),
            ),
            title,
            format: "post",
            tone: "規則草稿，不是 Hermes 生成。",
            audience: "模擬，不是民調。",
            pages,
            materialIds: [],
            factIds: [],
          },
          "owner",
        );
  const nextBrief: DirectionBriefPack = {
    ...brief,
    activityId: activity.id,
    copyId: document.id,
    revision: document.revisions.at(-1)?.revision || null,
  };
  return bindWorkflowDraft(owner, bound.id, {
    activityId: activity.id,
    copyId: document.id,
    directionBrief: nextBrief,
  });
}
