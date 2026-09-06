/**
 * Connect a ranked creative direction to Canva.
 * Does not create a live design unless Connect is actually verified.
 */
import { canvaStatus } from "../canva.ts";
import { WORKSPACE_OWNER } from "../security.ts";
import {
  directionToSpec,
  revisionFromAudience,
  validateSpecForTemplate,
  type CanvaCreativeSpec,
} from "./spec.ts";

export type CanvaWorkflowMode =
  | "unconfigured"
  | "needs_authorization"
  | "local_blueprint"
  | "vault_partial"
  | "live_connected";

export interface CanvaLayer {
  layer: number;
  type: string;
  content?: string;
  note?: string;
}

export interface ConnectedCanvaWorkflow {
  mode: CanvaWorkflowMode;
  created: false;
  liveDesignId: null;
  liveFetch: false;
  executableInCanva: false;
  status: string;
  message: string;
  openUrl: string;
  spec: CanvaCreativeSpec;
  datasetCheck: ReturnType<typeof validateSpecForTemplate>;
  revision: ReturnType<typeof revisionFromAudience>;
  blueprint: {
    title: string;
    dimensions: string;
    layers: CanvaLayer[];
    exportDraftUrl: string;
    mode: CanvaWorkflowMode;
    created: false;
  };
}

export function resolveCanvaWorkflowMode(): CanvaWorkflowMode {
  const status = canvaStatus(WORKSPACE_OWNER);
  if (!status.configured) return "unconfigured";
  if (status.needsAuthorization) return "needs_authorization";
  if (status.state === "verified") return "live_connected";
  if (status.state === "partial") return "vault_partial";
  return "local_blueprint";
}

export function connectCreativeToCanva(input: {
  title: string;
  subtitle?: string;
  copy: string;
  cta: string;
  visual: string;
  coreIdea?: string;
  claim?: string;
  layers: CanvaLayer[];
}): ConnectedCanvaWorkflow {
  const mode = resolveCanvaWorkflowMode();
  const spec = directionToSpec(
    {
      title: input.title,
      claim: input.claim || input.subtitle || input.title,
      coreIdea: input.coreIdea || input.subtitle,
      visual: input.visual,
      copy: input.copy,
      cta: input.cta,
    },
    "生活場景優先，術語放副標。Canva 未授權時只產生本機藍圖。",
  );
  const datasetCheck = validateSpecForTemplate(spec, {
    TITLE: { type: "text" },
    SUBTITLE: { type: "text" },
    CTA: { type: "text" },
  });
  const statusLabel =
    mode === "needs_authorization"
      ? "Needs Canva Authorization"
      : mode === "unconfigured"
        ? "unconfigured"
        : mode === "live_connected"
          ? "verified"
          : mode === "vault_partial"
            ? "partial"
            : "local_blueprint";
  const message =
    mode === "live_connected"
      ? "Canva Connect 已驗證；此步驟仍只輸出欄位規格，未自動建立遠端設計。"
      : mode === "vault_partial"
        ? "Canva Vault 僅驗證清單讀取。未建立遠端設計。"
        : mode === "needs_authorization"
          ? "Needs Canva Authorization。已產生本機 1080x1350 藍圖，不是已建立的 Canva 檔案。"
          : "未配置 CANVA_CLIENT_ID。本機藍圖可用，未呼叫 Canva API。";
  const openUrl = "https://www.canva.com/";
  return {
    mode,
    created: false,
    liveDesignId: null,
    liveFetch: false,
    executableInCanva: false,
    status: statusLabel,
    message,
    openUrl,
    spec,
    datasetCheck,
    revision: revisionFromAudience(input.copy),
    blueprint: {
      title: `${input.title} (Canva 1080x1350)`,
      dimensions: "1080x1350 (IG 最佳 4:5 直式直拍比例)",
      layers: input.layers,
      exportDraftUrl: openUrl,
      mode,
      created: false,
    },
  };
}
