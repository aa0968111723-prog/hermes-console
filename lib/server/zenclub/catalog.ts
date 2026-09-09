import catalogJson from "../../../data/zenclub/catalog.json";
import graphJson from "../../../data/zenclub/graph.json";
import archive1141 from "../../../data/zenclub/archive-114-1.json";
import archiveCamp10th from "../../../data/zenclub/archive-camp-10th.json";
import type {
  DriveCatalog,
  DriveCatalogFile,
  KnowledgeGraphSnapshot,
} from "./types";

export const ZENCLUB_DRIVE_FOLDER_ID = "1H-GuCfVw51D5_ipAoivjboabhb7iaKt6";

export function loadCatalog(): DriveCatalog {
  return catalogJson as DriveCatalog;
}

type GraphSlice = Pick<
  KnowledgeGraphSnapshot,
  "entities" | "conflicts" | "edges"
>;

export function loadGraph(): KnowledgeGraphSnapshot {
  const base = graphJson as KnowledgeGraphSnapshot;
  const extras: GraphSlice[] = [
    archive1141 as GraphSlice,
    archiveCamp10th as GraphSlice,
  ];
  let entities = base.entities;
  let conflicts = base.conflicts;
  let edges = base.edges;
  for (const archive of extras) {
    entities = [...entities, ...archive.entities];
    conflicts = [...conflicts, ...archive.conflicts];
    edges = [...edges, ...archive.edges];
  }
  return { ...base, entities, conflicts, edges };
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
