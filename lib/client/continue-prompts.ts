/** Student-facing continue prompts. Workflow IDs stay on the server. */
export function continueArtifactPrompt() {
  return "請接續修改這件作品，不要另做無關的。";
}

export function continueDirectionPrompt(index: number) {
  return (
    "請依我剛選的第 " +
    (index + 1) +
    " 個方向繼續做草稿；還沒授權就先保留進度。"
  );
}
