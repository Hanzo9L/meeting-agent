import type { LiveAssistProjection } from "@shared/types";

export function updateProjectionFeed(
  current: LiveAssistProjection[],
  projection: LiveAssistProjection
): LiveAssistProjection[] {
  const next = current.filter(
    (item) => item.answerRunId !== projection.answerRunId
  );
  return [...next, projection];
}
