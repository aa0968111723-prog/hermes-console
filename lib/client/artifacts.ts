export function revisionLabel(revision: number) {
  return "V" + revision;
}

export function continueCopyPrompt(artifactId: string, revision: number) {
  return (
    "請用 workspace_get_copy 讀取文案 " +
    artifactId +
    "，以 v" +
    revision +
    " 為修改基礎。先問我要改哪一頁或語氣，再沿用相同 id 保存新版本；不要重新搜尋或重建無關作品。"
  );
}

export function continueDesignPrompt(workflowId: string) {
  return (
    "請查回創作流程 " +
    workflowId +
    " 的現有設計，接續修改同一作品。"
  );
}
