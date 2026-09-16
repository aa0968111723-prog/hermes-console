import type { Message, Task } from "../contracts";

/** Drop duplicate assistant bubbles from double-submit or live+saved overlap. */
export function visibleChatMessages(messages: Message[]): Message[] {
  const seenTask = new Set<string>();
  const seenContent = new Set<string>();
  const visible: Message[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      if (message.taskId && seenTask.has(message.taskId)) continue;
      if (seenContent.has(message.content)) continue;
      if (message.taskId) seenTask.add(message.taskId);
      seenContent.add(message.content);
    }
    visible.push(message);
  }
  return visible;
}

export function liveTaskCovered(messages: Message[], task: Task) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.taskId === task.id ||
        (!!task.output && message.content === task.output)),
  );
}
