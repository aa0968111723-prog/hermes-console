import type { TruthClass } from "./certification/types";

export type { TruthClass };

export const TRUTH_DISCLAIMERS: Record<TruthClass, string> = {
  FACT: "已核對的事實。",
  USER_PROVIDED: "使用者提供，尚未對外查證。",
  SOURCE_VERIFIED: "有外部來源證據。",
  INFERENCE: "推論，不是直接證據。",
  SIMULATION: "模擬評估，不代表真實市場調查或民調。",
  UNKNOWN: "尚未確認。",
};

export function classifyTruth(input: {
  userProvided?: boolean;
  sourceIds?: string[];
  retrieved?: boolean;
  simulation?: boolean;
  inferred?: boolean;
}): TruthClass {
  if (input.simulation) return "SIMULATION";
  if (input.userProvided && !input.retrieved) return "USER_PROVIDED";
  if (input.retrieved && (input.sourceIds || []).length > 0)
    return "SOURCE_VERIFIED";
  if (input.inferred) return "INFERENCE";
  if (input.retrieved) return "FACT";
  return "UNKNOWN";
}

export function audienceTruth(): TruthClass {
  return "SIMULATION";
}
