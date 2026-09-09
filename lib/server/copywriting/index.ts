export {
  COPY_CHANNELS,
  COPY_REVIEW_DISCLAIMER,
  COPY_STRUCTURE,
  COPY_VARIANT_LABELS,
  COPY_VARIANTS,
  CHANNEL_LIMITS,
  type CopyChannel,
  type CopyFacts,
  type CopyLintIssue,
  type CopyPersonaReview,
  type CopyReview,
  type CopyStructureSlot,
  type CopyVariantId,
} from "./types";
export { lintCopy } from "./lint";
export { FRESHMAN_TWINS } from "./freshmen";
export {
  detectStructure,
  emptyFacts,
  formatFromCopyFormat,
  normalizeFacts,
} from "./structure";
export { factsFromActivityRecord, reviewCopy, reviewSavedCopy } from "./review";
export { scaffoldVariants } from "./drafts";
