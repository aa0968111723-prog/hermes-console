export const CLAIM_STATUSES = [
  "VERIFIED",
  "LIKELY",
  "UNVERIFIED",
  "CONFLICTING",
  "UNKNOWN",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type KnowledgeKind =
  | "activity"
  | "person"
  | "place"
  | "document"
  | "year"
  | "form"
  | "promo"
  | "camp"
  | "conflict";

export type DriveMime =
  | "folder"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "form"
  | "pdf"
  | "docx"
  | "pptx"
  | "video"
  | "shortcut"
  | "other";

export interface DriveSource {
  fileId: string;
  title: string;
  url: string;
  mime: DriveMime;
  modifiedAt: string | null;
  year: string | null;
  readable: boolean;
  piiRestricted: boolean;
}

export interface KnowledgeClaim {
  id: string;
  entityId: string;
  field: string;
  value: string | null;
  status: ClaimStatus;
  note: string | null;
  sources: DriveSource[];
}

export interface KnowledgeEntity {
  id: string;
  kind: KnowledgeKind;
  title: string;
  aliases: string[];
  year: string | null;
  semester: string | null;
  claims: KnowledgeClaim[];
}

export interface KnowledgeConflict {
  id: string;
  field: string;
  entityIds: string[];
  values: string[];
  status: "CONFLICTING";
  note: string;
  sources: DriveSource[];
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relation: string;
}

export interface DriveArea {
  id: string;
  name: string;
  folderId: string;
  url: string;
  kind:
    | "year"
    | "camp"
    | "evaluation"
    | "speaker"
    | "teachings"
    | "music"
    | "database"
    | "media"
    | "other";
  modifiedAt: string | null;
  indexed: boolean;
  note: string | null;
}

export interface DriveCatalogFile {
  id: string;
  name: string;
  fileId: string;
  url: string;
  mime: DriveMime;
  parentArea: string;
  year: string | null;
  docType: string;
  modifiedAt: string | null;
  piiRestricted: boolean;
  readable: boolean;
  extractStatus: "extracted" | "unread_binary" | "catalog_only" | "redacted";
}

export interface DriveCatalog {
  source: {
    kind: "google_drive";
    folderId: string;
    url: string;
    indexedAt: string;
    method: "mcp_list_folder_and_read";
    live: false;
    note: string;
  };
  areas: DriveArea[];
  files: DriveCatalogFile[];
}

export interface KnowledgeGraphSnapshot {
  snapshotAt: string;
  live: false;
  entities: KnowledgeEntity[];
  conflicts: KnowledgeConflict[];
  edges: KnowledgeEdge[];
}

export interface KnowledgeHit {
  entity: KnowledgeEntity;
  score: number;
  matched: string[];
}

export interface KnowledgeSearchResult {
  query: string;
  live: false;
  snapshotAt: string;
  method: "indexed_snapshot";
  hits: KnowledgeHit[];
  conflicts: KnowledgeConflict[];
  unknowns: string[];
  redacted: number;
  notice: string;
  forHermes: {
    snapshotAt: string;
    live: false;
    hits: Array<{
      id: string;
      kind: KnowledgeKind;
      title: string;
      year: string | null;
      semester: string | null;
      claims: Array<{
        field: string;
        value: string | null;
        status: ClaimStatus;
        sourceTitle: string | null;
        sourceUrl: string | null;
      }>;
    }>;
    conflicts: Array<{
      field: string;
      values: string[];
      note: string;
    }>;
    unknowns: string[];
    notice: string;
  };
}
