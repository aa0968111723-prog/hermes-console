import catalogJson from "../../../data/zenclub/catalog.json";
import graphJson from "../../../data/zenclub/graph.json";
import archive1141 from "../../../data/zenclub/archive-114-1.json";
import type {
  DriveCatalog,
  DriveCatalogFile,
  KnowledgeGraphSnapshot,
} from "./types";

export const ZENCLUB_DRIVE_FOLDER_ID = "1H-GuCfVw51D5_ipAoivjboabhb7iaKt6";

export function loadCatalog(): DriveCatalog {
  return catalogJson as DriveCatalog;
}

export function loadGraph(): KnowledgeGraphSnapshot {
  const base = graphJson as KnowledgeGraphSnapshot;
  const archive = archive1141 as Pick<
    KnowledgeGraphSnapshot,
    "entities" | "conflicts" | "edges"
  >;
  return {
    ...base,
    entities: [...base.entities, ...archive.entities],
    conflicts: [...base.conflicts, ...archive.conflicts],
    edges: [...base.edges, ...archive.edges],
  };
}

export function redactedFiles(): DriveCatalogFile[] {
  return loadCatalog().files.filter((file) => file.piiRestricted);
}

export function catalogNotice() {
  const catalog = loadCatalog();
  return {
    live: catalog.source.live,
    snapshotAt: catalog.source.indexedAt,
    method: catalog.source.method,
    folderUrl: catalog.source.url,
    note: catalog.source.note,
  };
}
