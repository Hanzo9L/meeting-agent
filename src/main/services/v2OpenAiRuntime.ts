export const V2_REASONING_EFFORT = "medium" as const;

export function resolveV2OpenAiModel(
  explicitModel?: string
): string {
  const model =
    explicitModel?.trim() ||
    process.env["RELAY_V2_MODEL"]?.trim() ||
    process.env["RELAY_QUESTION_UNDERSTANDING_MODEL"]?.trim();
  if (!model) throw new Error("relay_v2_model_not_configured");
  return model;
}
