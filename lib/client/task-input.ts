export type TaskInputPresentation = {
  preview: string;
  truncated: boolean;
};

export function presentTaskInput(
  input: string,
  maxLength = 140,
): TaskInputPresentation {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength)
    return { preview: normalized, truncated: false };

  const candidate = normalized.slice(0, maxLength + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  const end =
    wordBoundary >= Math.floor(maxLength * 0.72) ? wordBoundary : maxLength;
  return {
    preview: normalized.slice(0, end).trimEnd() + "…",
    truncated: true,
  };
}
