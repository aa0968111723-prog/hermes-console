"use client";

import { ListTodo, RefreshCw } from "lucide-react";
import type { Conversation, Task } from "@/lib/contracts";
import { isDirectionSet } from "@/lib/client/direction-result";
import { formatWorkspaceTime, taskLabels } from "@/lib/client/workspace-ui";
import type { Workflow } from "@/lib/server/workflows";
import ArtifactDeck from "../visual/ArtifactDeck";
import DirectionPick from "../visual/DirectionPick";

export default function TasksPage({
  project,
  workflows,
  tasks,
  conversations,
  onPickDirection,
  onContinueDesign,
  onPollDraft,
  onOpenTask,
  onRefresh,
}: {
  project: string;
  workflows: Workflow[];
  tasks: Task[];
  conversations: Conversation[];
  onPickDirection: (workflowId: string, index: number, title: string) => void;
  onContinueDesign: (id: string) => void;
  onPollDraft: (id: string) => void;
  onOpenTask: (task: Task) => void;
  onRefresh: () => void;
}) {
  const scoped = workflows.filter((item) => item.projectId === project);
  const polling = scoped.filter((item) => item.canvaJobId && !item.design);
  const projectTasks = tasks.filter(
    (task) =>
      conversations.find((item) => item.id === task.conversationId)
        ?.projectId === project,
  );
  return (
    <section className="secondary-page page-scroll">
      <h1>任務</h1>
      <ArtifactDeck
        items={scoped}
        onContinue={onContinueDesign}
        onChanged={onRefresh}
      />
      {scoped.map((workflow) => {
        if (workflow.design || !isDirectionSet(workflow)) return null;
        return (
          <div key={workflow.id}>
            <DirectionPick
              workflow={{
                id: workflow.id,
                state: workflow.state,
                selected: workflow.selected,
                directions: workflow.directions,
                brief: workflow.brief,
              }}
              onPick={onPickDirection}
            />
            {workflow.error && <p className="error">{workflow.error}</p>}
          </div>
        );
      })}
      {polling.map((workflow) => (
        <button
          key={workflow.id}
          type="button"
          onClick={() => onPollDraft(workflow.id)}
        >
          <RefreshCw size={16} />
          查回 Canva 製作結果
        </button>
      ))}
      {!projectTasks.length && !scoped.length && (
        <div className="empty-state">
          <ListTodo size={30} />
          <h2>目前沒有任務</h2>
          <p>送出第一則訊息後，便能在這裡查回執行結果。</p>
        </div>
      )}
      {projectTasks.map((task) => (
        <button
          className="task-row"
          key={task.id}
          onClick={() => onOpenTask(task)}
        >
          <span>
            <strong>{task.input.slice(0, 70)}</strong>
            <small>{formatWorkspaceTime(task.createdAt)}</small>
          </span>
          <span className={"badge " + task.state}>{taskLabels[task.state]}</span>
        </button>
      ))}
    </section>
  );
}
