import { Folder, Plus } from "lucide-react";
import type { Conversation, Material } from "@/lib/contracts";
export default function ProjectShelf({
  projects,
  materials,
  conversations,
  selected,
  onSelect,
  onCreate,
}: {
  projects: { id: string; name: string }[];
  materials: Material[];
  conversations: Conversation[];
  selected: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="project-shelf" role="group" aria-label="專案架">
      {[{ id: "personal", name: "個人工作區" }, ...projects].map((project) => {
        const cover = materials
          .filter((m) => m.projectId === project.id && m.kind === "image")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const recent = conversations
          .filter((c) => c.projectId === project.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        return (
          <button
            key={project.id}
            className="project-cover"
            aria-label={"開啟專案：" + project.name}
            aria-pressed={selected === project.id}
            onClick={() => onSelect(project.id)}
          >
            <span className="project-thumbnail">
              {cover ? (
                <img
                  src={"/api/materials?id=" + cover.id}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <Folder size={40} strokeWidth={1} />
              )}
            </span>
            <strong>{project.name}</strong>
            <span className="project-activity">
              {recent
                ? new Date(recent.updatedAt).toLocaleDateString("zh-TW")
                : "尚無對話"}
            </span>
          </button>
        );
      })}
      <button
        className="project-cover create-project"
        onClick={onCreate}
        aria-label="建立新專案"
      >
        <Plus size={26} />
        <span>新專案</span>
      </button>
    </div>
  );
}
