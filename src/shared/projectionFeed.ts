import type { LiveAssistProjection } from "./types";

export function updateProjectionFeed(
  current: LiveAssistProjection[],
  projection: LiveAssistProjection
): LiveAssistProjection[] {
  const index = current.findIndex(
    (item) => item.answerRunId === projection.answerRunId
  );
  if (index < 0) {
    return [...current, projection];
  }
  const next = current.slice();
  next[index] = projection;
  return next;
}
