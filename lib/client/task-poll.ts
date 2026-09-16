/** Idle workspace polls slowly. Active tasks stay at 3s. Hidden tabs already skip. */
export function taskPollDelayMs(hasActiveTask: boolean) {
  return hasActiveTask ? 3_000 : 20_000;
}
