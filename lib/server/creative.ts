import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  activityInput,
  copyInput,
  fieldLabels,
  type Activity,
  type ActivityRevision,
  type CopyDocument,
  type CopyRevision,
  type CopyCheck,
  type Fact,
} from "../creative";
import { get, list, put, transaction } from "./store";
import { ApiError, hash, redact } from "./security";
import { material } from "./materials";
import type { Material, Task } from "../contracts";
export function assertProject(owner: string, project: string) {
  if (project !== "personal" && !get("project", owner, project))
    throw new ApiError(404, "project_not_found", "專案不存在。");
}
function noSecrets(input: unknown) {
  const value = JSON.stringify(input);
  if (redact(value) !== value)
    throw new ApiError(
      400,
      "sensitive_content",
      "內容含有憑證，不能寫入活動或草稿。",
    );
}
function version(current: number, expected: number) {
  if (current !== expected)
    throw new ApiError(
      409,
      "revision_conflict",
      "資料已被修改，請重新讀取最新版本後再儲存；原版本未覆寫。",
    );
}
function once<T>(
  owner: string,
  operationId: string,
  input: unknown,
  fn: () => T,
): T {
  return transaction(() => {
    const signature = hash(JSON.stringify(input));
    const old = get<{ id: string; signature: string; result: T }>(
      "creative_operation",
      owner,
      operationId,
    );
    if (old) {
      if (old.signature !== signature)
        throw new ApiError(
          409,
          "operation_conflict",
          "操作識別已用於其他內容。",
        );
      return old.result;
    }
    const result = fn();
    put("creative_operation", owner, { id: operationId, signature, result });
    return result;
  });
}
export function activity(owner: string, id: string) {
  const record = get<Activity>("activity", owner, id);
  if (!record) throw new ApiError(404, "activity_not_found", "找不到活動。");
  return record;
}
export function copyDocument(owner: string, id: string) {
  const record = get<CopyDocument>("copy", owner, id);
  if (!record) throw new ApiError(404, "copy_not_found", "找不到文案。");
  return record;
}
function includesPrivate(info: Activity, content: unknown) {
  const text = JSON.stringify(content);
  return info.facts.some(
    (f) =>
      f.visibility === "private" &&
      f.value.length > 0 &&
      text.includes(f.value),
  );
}
export function publicCopy(owner: string, id: string) {
  const record = copyDocument(owner, id);
  if (includesPrivate(activity(owner, record.activityId), record.revisions))
    throw new ApiError(
      403,
      "private_content",
      "此作品歷史含現已標示私人的資訊；請在 Console 人工查閱，另建不含私人資訊的文案供工具使用。",
    );
  return record;
}
export function publicActivity(record: Activity) {
  const publicFacts = record.facts.filter((f) => f.visibility === "public" && f.state !== "rejected");
  return {
    ...record,
    history: undefined,
    title: includesPrivate(record, record.title) ? "活動（標題含私人資訊）" : record.title,
    facts: publicFacts.filter(f => !includesPrivate(record, f)),
  };
}
export function saveActivity(
  owner: string,
  raw: z.infer<typeof activityInput>,
  actor: "owner" | "hermes",
) {
  const input = activityInput.parse(raw);
  noSecrets(input);
  assertProject(owner, input.projectId);
  return once(
    owner,
    input.operationId,
    { kind: "activity", actor, input },
    () => {
      const old = input.id ? activity(owner, input.id) : null;
      if (old && old.projectId !== input.projectId)
        throw new ApiError(403, "project_mismatch", "不能跨專案覆寫活動。");
      version(old?.revision || 0, input.expectedRevision);
      if (actor === "hermes" && old && includesPrivate(old, input.facts.filter(f => f.visibility === "public")))
        throw new ApiError(403, "private_content", "工具不能將既有私人資訊改為公開。");
      const facts = input.facts.map((f): Fact => {
        const id = hash(JSON.stringify(f));
        const previous = old?.facts.find((v) => v.id === id);
        return {
          ...f,
          id,
          state:
            previous?.state ||
            (actor === "owner" ? "user_provided" : "pending"),
        };
      });
      // A model receives only public context and cannot overwrite private fields it cannot see.
      if (actor === "hermes")
        for (const f of old?.facts || [])
          if (f.visibility === "private" && !facts.some((v) => v.id === f.id))
            facts.push(f);
      const revision: ActivityRevision = {
        title: input.title,
        facts,
        revision: (old?.revision || 0) + 1,
        at: new Date().toISOString(),
        actor,
      };
      if ((old?.history.length || 0) >= 200)
        throw new ApiError(
          409,
          "revision_limit",
          "活動已達 200 個版本；請建立新的活動，不會刪除舊版本。",
        );
      return put("activity", owner, {
        ...revision,
        id: old?.id || randomUUID(),
        projectId: input.projectId,
        history: [...(old?.history || []), revision],
      } satisfies Activity);
    },
  );
}
export function confirmFacts(
  owner: string,
  id: string,
  expected: number,
  ids: string[],
) {
  return transaction(() => {
    const record = activity(owner, id);
    version(record.revision, expected);
    const chosen = ids.map((id) => record.facts.find((f) => f.id === id));
    if (!ids.length || chosen.some((f) => !f || f.visibility !== "public"))
      throw new ApiError(
        400,
        "invalid_confirmation",
        "只能確認實際存在的公開資訊。",
      );
    const fields = chosen.map((f) => f!.field);
    if (new Set(fields).size !== fields.length)
      throw new ApiError(
        409,
        "fact_conflict",
        "同一欄位請選定一個版本，其他來源仍保留於歷史。",
      );
    const facts = record.facts.map((f): Fact => ({
      ...f,
      state: ids.includes(f.id)
        ? "confirmed"
        : fields.includes(f.field) && f.visibility === "public"
          ? "rejected"
          : f.state,
    }));
    if (record.history.length >= 200)
      throw new ApiError(409, "revision_limit", "活動版本已達上限。");
    const revision: ActivityRevision = {
      revision: record.revision + 1,
      title: record.title,
      facts,
      at: new Date().toISOString(),
      actor: "owner",
    };
    return put("activity", owner, {
      ...record,
      ...revision,
      history: [...record.history, revision],
    });
  });
}
export function checkCopy(
  owner: string,
  record: CopyDocument,
  revision = record.revisions.at(-1)!,
): CopyCheck {
  const info = activity(owner, record.activityId),
    issues: string[] = [],
    checkedFacts: string[] = [];
  const text = revision.pages
    .map((p) => p.title + "\n" + p.body + "\n" + p.visual)
    .join("\n");
  if (revision.activityRevision !== info.revision)
    issues.push("活動資料已有新版本，請重新核對文案。");
  for (const field of ["name", "date", "location"] as const) {
    const facts = info.facts.filter(
      (f) =>
        f.field === field &&
        f.visibility === "public" &&
        f.state !== "rejected",
    );
    if (facts.length !== 1 || facts[0].state !== "confirmed")
      issues.push(fieldLabels[field] + "尚未確認或仍有衝突。");
    else if (!text.includes(facts[0].value))
      issues.push("文案未包含已確認的" + fieldLabels[field] + "，請人工核對。");
    else checkedFacts.push(fieldLabels[field] + "：" + facts[0].value);
  }
  for (const id of revision.factIds) {
    const f = info.facts.find((f) => f.id === id && f.visibility === "public");
    if (!f || f.state !== "confirmed")
      issues.push("引用資訊已變更或尚未確認：" + id.slice(0, 8));
    else if (!text.includes(f.value))
      issues.push("引用內容未在文案中找到：" + fieldLabels[f.field]);
  }
  for (const id of revision.materialIds) {
    try {
      const m = material(owner, id);
      issues.push("素材使用權仍需人工確認：" + m.title);
    } catch {
      issues.push("引用素材已移除：" + id);
    }
  }
  return {
    issues,
    checkedFacts,
    readyForHumanReview: issues.length === 0,
    automaticVerificationComplete: false,
  };
}
export function saveCopy(
  owner: string,
  raw: z.infer<typeof copyInput>,
  actor: "owner" | "hermes",
) {
  const input = copyInput.parse(raw);
  noSecrets(input);
  assertProject(owner, input.projectId);
  return once(owner, input.operationId, { kind: "copy", actor, input }, () => {
    const info = activity(owner, input.activityId),
      old = input.id ? copyDocument(owner, input.id) : null;
    if (
      info.projectId !== input.projectId ||
      (old &&
        (old.projectId !== input.projectId ||
          old.activityId !== input.activityId))
    )
      throw new ApiError(
        403,
        "project_mismatch",
        "活動、文案與專案範圍不一致。",
      );
    version(old?.revisions.at(-1)?.revision || 0, input.expectedRevision);
    if (input.workflowId) {
      const direction = get<{ projectId: string; activityId?: string; selected: number | null }>("workflow", owner, input.workflowId);
      if (!direction || direction.projectId !== input.projectId || direction.activityId !== input.activityId)
        throw new ApiError(403, "workflow_scope", "方向與活動、專案不一致。");
      if (direction.selected === null)
        throw new ApiError(409, "selection_required", "請先由使用者選定創作方向。");
    }
    for (const id of input.materialIds)
      if (material(owner, id).projectId !== input.projectId)
        throw new ApiError(403, "material_scope", "不能引用其他專案素材。");
    for (const id of input.factIds)
      if (
        !info.facts.some(
          (f) =>
            f.id === id && f.visibility === "public" && f.state !== "rejected",
        )
      )
        throw new ApiError(
          403,
          "private_fact",
          "不能引用私人或已排除的活動資訊。",
        );
    if (
      info.facts.some(
        (f) =>
          f.visibility === "private" &&
          f.value.length > 0 &&
          JSON.stringify(input).includes(f.value),
      )
    )
      throw new ApiError(
        403,
        "private_content",
        "文案含私人活動資訊，請移除後再儲存。",
      );
    if ((old?.revisions.length || 0) >= 200)
      throw new ApiError(
        409,
        "revision_limit",
        "文案版本已達上限，請另建文案。",
      );
    const {
      id: _id,
      operationId: _op,
      expectedRevision: _expected,
      ...content
    } = input;
    const revision: CopyRevision = {
      ...content,
      revision: (old?.revisions.length || 0) + 1,
      at: new Date().toISOString(),
      actor,
      activityRevision: info.revision,
    };
    return put("copy", owner, {
      id: old?.id || randomUUID(),
      projectId: input.projectId,
      activityId: input.activityId,
      selectedRevision: old?.selectedRevision || null,
      revisions: [...(old?.revisions || []), revision],
    } satisfies CopyDocument);
  });
}
export function selectCopy(
  owner: string,
  id: string,
  expected: number,
  selected: number,
) {
  return transaction(() => {
    const record = copyDocument(owner, id);
    version(record.revisions.at(-1)!.revision, expected);
    if (!record.revisions.some((r) => r.revision === selected))
      throw new ApiError(404, "revision_not_found", "文案版本不存在。");
    return put("copy", owner, { ...record, selectedRevision: selected });
  });
}
export function projectContext(owner: string, projectId: string) {
  assertProject(owner, projectId);
  return {
    projectId,
    queriedAt: new Date().toISOString(),
    memorySynced: false,
    activities: list<Activity>("activity", owner)
      .filter((a) => a.projectId === projectId)
      .slice(0, 50)
      .map((a) => ({
        id: a.id,
        title: publicActivity(a).title,
        revision: a.revision,
        publicFactCount: a.facts.filter((f) => f.visibility === "public")
          .length,
        notice: "用 workspace_get_activity 讀取來源與核對狀態。",
      })),
    copies: list<CopyDocument>("copy", owner)
      .filter(
        (d) =>
          d.projectId === projectId &&
          !includesPrivate(activity(owner, d.activityId), d.revisions),
      )
      .slice(0, 50)
      .map((d) => ({
        id: d.id,
        activityId: d.activityId,
        title: d.revisions.at(-1)!.title,
        latestRevision: d.revisions.at(-1)!.revision,
        selectedRevision: d.selectedRevision,
        check: checkCopy(owner, d),
      })),
    materials: list<Material>("material", owner)
      .filter((m) => m.projectId === projectId)
      .slice(0, 100),
    tasks: list<Task>("task", owner)
      .filter(
        (t) =>
          get<{ projectId: string }>("conversation", owner, t.conversationId)
            ?.projectId === projectId,
      )
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        state: t.state,
        error: t.error,
      })),
    notice:
      "這是 Console 專案索引，不是 Hermes 長期記憶；最多列出最近 50 項活動／文案、100 項素材。使用 get 工具查回指定作品。若多個成果符合需求，先詢問使用者，勿覆寫其他作品。",
  };
}
export function exportCopy(owner: string, id: string, number: number) {
  const record = copyDocument(owner, id),
    revision = record.revisions.find((r) => r.revision === number);
  if (!revision)
    throw new ApiError(404, "revision_not_found", "找不到文案版本。");
  if (includesPrivate(activity(owner, record.activityId), revision))
    throw new ApiError(
      403,
      "private_content",
      "此版本含現已標示私人的資訊，不能匯出為公開文案。",
    );
  const check = checkCopy(owner, record, revision);
  const info = activity(owner, record.activityId);
  const sources = [
    ...new Set(
      (
        info.history.find((r) => r.revision === revision.activityRevision)
          ?.facts || []
      )
        .filter(
          (f) =>
            f.visibility === "public" &&
            f.state === "confirmed" &&
            !info.facts.some(
              (current) =>
                current.visibility === "private" &&
                current.field === f.field &&
                current.value === f.value,
            ),
        )
        .flatMap((f) => f.sources.map((s) => s.url)),
    ),
  ];
  return `# ${revision.title}\n\n草稿 v${revision.revision} · ${revision.format} · ${revision.at}\n\n${revision.pages.map((p, i) => `## ${i + 1}. ${p.title}\n\n${p.body}\n\n視覺備註：${p.visual}`).join("\n\n")}\n\n## 核對結果（不等於可直接發佈）\n\n${[...check.checkedFacts, ...check.issues, "仍須人工確認全文、來源、日期時區與素材權利。"].map((s) => "- " + s).join("\n")}\n\n## 此版本活动來源\n\n${sources.length ? sources.map((s) => "- " + s).join("\n") : "尚未記錄可核對來源。"}\n`;
}
