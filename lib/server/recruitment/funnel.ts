import type {
  FunnelLane,
  FunnelStageStatus,
  RecruitmentFunnelRead,
  RecruitmentFunnelStage,
} from "@/lib/contracts";
import { loadCatalog, loadGraph } from "@/lib/server/zenclub";
import type { DriveCatalog, KnowledgeGraphSnapshot } from "@/lib/server/zenclub/types";
import {
  SHEETS,
  sheetsSyncStatus,
  type SheetSyncResult,
} from "@/lib/server/inspiration/sheets-sync";

export type FunnelBuildDeps = {
  loadCatalog?: () => DriveCatalog;
  loadGraph?: () => KnowledgeGraphSnapshot;
  sheetsRegistry?: ReadonlyArray<{ id: string; projectId: string }>;
  sheetsSyncStatus?: () => (SheetSyncResult & { id: string }) | null;
  now?: () => Date;
};

const REDACTION = {
  rosterRows: "omitted",
  formReplies: "omitted",
  attendanceRows: "omitted",
} as const;

function isFormCatalogFile(file: DriveCatalog["files"][number]) {
  if (file.docType === "form_replies") return false;
  return (
    file.mime === "form" ||
    file.docType === "registration_form" ||
    /(?:^|-)form(?:-|$)/i.test(file.id)
  );
}

function isRosterCatalogFile(file: DriveCatalog["files"][number]) {
  return file.docType === "roster" || /(?:^|-)roster(?:-|$)/i.test(file.id);
}

function isAttendanceCatalogFile(file: DriveCatalog["files"][number]) {
  return (
    file.docType === "attendance" ||
    /(?:^|-)attendance(?:-|$)/i.test(file.id) ||
    /出席/.test(file.name)
  );
}

function stage(
  id: RecruitmentFunnelStage["id"],
  status: FunnelStageStatus,
  lane: FunnelLane,
  extras: Pick<RecruitmentFunnelStage, "pathKeys" | "notes"> = {},
): RecruitmentFunnelStage {
  const next: RecruitmentFunnelStage = { id, status, lane };
  if (extras.pathKeys?.length) next.pathKeys = [...extras.pathKeys].sort();
  if (extras.notes) next.notes = extras.notes;
  return next;
}

/**
 * Pure read-model for GET /api/recruitment/funnel.
 * Derives stage status from zenclub catalog/graph + SHEETS registry + sheetsSync
 * counters only. Never exposes roster/form-reply/attendance rows or headcounts.
 */
export function buildRecruitmentFunnelRead(
  deps: FunnelBuildDeps = {},
): RecruitmentFunnelRead {
  const asOf = (deps.now ?? (() => new Date()))().toISOString();
  const loadCat = deps.loadCatalog ?? loadCatalog;
  const loadG = deps.loadGraph ?? loadGraph;
  const registry = deps.sheetsRegistry ?? SHEETS;
  const readSync = deps.sheetsSyncStatus ?? sheetsSyncStatus;

  let degraded = false;
  let catalog: DriveCatalog | null = null;
  let graph: KnowledgeGraphSnapshot | null = null;

  try {
    catalog = loadCat();
  } catch {
    degraded = true;
  }
  try {
    graph = loadG();
  } catch {
    degraded = true;
  }

  // --- forms ---
  let forms: RecruitmentFunnelStage;
  if (!catalog && !graph) {
    forms = stage("forms", "degraded", "none", {
      notes: "catalog_unavailable",
    });
  } else {
    const formFiles = catalog?.files.filter(isFormCatalogFile) ?? [];
    const formEntities =
      graph?.entities.filter((entity) => entity.kind === "form") ?? [];
    const pathKeys = [
      ...formFiles.map((file) => file.id),
      ...formEntities.map((entity) => entity.id),
    ];
    const hasVerifiedUrl = formEntities.some((entity) =>
      entity.claims.some(
        (claim) =>
          claim.field === "public_url" &&
          claim.status === "VERIFIED" &&
          typeof claim.value === "string" &&
          claim.value.length > 0,
      ),
    );
    if (pathKeys.length === 0) {
      forms = stage("forms", "missing", "none", {
        notes: "no_form_catalog_or_claim_keys",
      });
    } else {
      forms = stage("forms", "wired_ok", "FACT", {
        pathKeys,
        notes: hasVerifiedUrl
          ? "public_form_url_claims_only"
          : "form_path_keys_only",
      });
    }
  }

  // --- sheets (INSPIRATION lane; never roster FACT) ---
  let inspirationSheets: RecruitmentFunnelRead["inspirationSheets"] = {
    registryCount: registry.length,
  };
  let sheets: RecruitmentFunnelStage;
  if (registry.length === 0) {
    sheets = stage("sheets", "missing", "none", {
      notes: "sheets_registry_empty",
    });
  } else {
    try {
      const sync = readSync();
      if (sync) {
        inspirationSheets = {
          registryCount: registry.length,
          lastSync: {
            read: sync.read,
            failed: sync.failed,
            skipped: sync.skipped,
            at: sync.finishedAt || sync.startedAt,
          },
        };
      }
      const pathKeys = registry.map((sheet) => sheet.projectId);
      const failed = sync?.failed ?? 0;
      sheets = stage(
        "sheets",
        failed > 0 ? "degraded" : "wired_ok",
        "INSPIRATION",
        {
          pathKeys,
          notes: "sheets_sync_inspiration_lane",
        },
      );
      if (failed > 0) degraded = true;
    } catch {
      degraded = true;
      sheets = stage("sheets", "degraded", "INSPIRATION", {
        pathKeys: registry.map((sheet) => sheet.projectId),
        notes: "sheets_sync_store_unavailable",
      });
    }
  }

  // --- roster (wired_redacted | missing only) ---
  let roster: RecruitmentFunnelStage;
  if (!catalog) {
    roster = stage("roster", "missing", "none", {
      notes: "catalog_unavailable",
    });
  } else {
    const rosterFiles = catalog.files.filter(isRosterCatalogFile);
    if (rosterFiles.length === 0) {
      roster = stage("roster", "missing", "none", {
        notes: "no_roster_catalog_keys",
      });
    } else {
      // Rows are never exposed; presence of roster keys is always redacted.
      roster = stage("roster", "wired_redacted", "redacted", {
        pathKeys: rosterFiles.map((file) => file.id),
        notes: "roster_rows_omitted",
      });
    }
  }

  // --- funnel (no store kind yet) ---
  const funnel = stage("funnel", "missing", "none", {
    notes: "no_funnel_snapshot_store",
  });

  // --- attendance (wired_redacted | missing only) ---
  let attendance: RecruitmentFunnelStage;
  if (!catalog) {
    attendance = stage("attendance", "missing", "none", {
      notes: "catalog_unavailable",
    });
  } else {
    const attendanceFiles = catalog.files.filter(isAttendanceCatalogFile);
    if (attendanceFiles.length === 0) {
      attendance = stage("attendance", "missing", "none", {
        notes: "no_attendance_catalog_keys",
      });
    } else {
      attendance = stage("attendance", "wired_redacted", "redacted", {
        pathKeys: attendanceFiles.map((file) => file.id),
        notes: "attendance_rows_omitted",
      });
    }
  }

  const read: RecruitmentFunnelRead = {
    contractVersion: 1,
    asOf,
    stages: [forms, sheets, roster, funnel, attendance],
    inspirationSheets,
    redaction: { ...REDACTION },
  };
  if (degraded) read.degraded = true;
  return read;
}
