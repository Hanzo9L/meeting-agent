export type RenderSessionState = "active" | "inactive" | "expired";

export interface RenderAudioSession {
  processId: number;
  processName: string;
  displayName: string;
  state: RenderSessionState;
  peak: number;
}

export interface RenderEndpoint {
  id: string;
  name: string;
  isDefault: boolean;
  isCommunicationsDefault?: boolean;
  sessions: RenderAudioSession[];
}

export interface RenderEndpointSnapshot {
  defaultId: string | null;
  communicationsDefaultId?: string | null;
  endpoints: RenderEndpoint[];
}

export interface RenderResolveInput {
  endpoints: RenderEndpoint[];
  rememberedId?: string | null;
  explicitId?: string | null;
  currentId?: string | null;
  currentMissing?: boolean;
  excludeProcessIds?: number[];
}

export type RenderResolveStatus =
  | "selected"
  | "ambiguous"
  | "missing"
  | "none";

export interface RenderResolveResult {
  status: RenderResolveStatus;
  endpoint: RenderEndpoint | null;
  candidates: RenderEndpoint[];
  reason: string;
  automatic: boolean;
  prompt: string | null;
}

export type RenderCaptureListenState =
  | "idle"
  | "listening"
  | "no_system_audio"
  | "needs_selection"
  | "device_changed"
  | "error";

export interface RenderCaptureEndpointOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface RenderCaptureStatusView {
  listenState: RenderCaptureListenState;
  selectedEndpointId: string | null;
  selectedEndpointName: string | null;
  automatic: boolean;
  message: string | null;
  activityLevel: number;
  endpoints: RenderCaptureEndpointOption[];
}

export const DEVICE_CHANGED_PROMPT =
  "Audio output changed — select capture device";
export const SELECT_MEETING_OUTPUT_PROMPT = "Select meeting output";
export const AUTO_SOURCE_LABEL = "Auto — meeting app / active browser";

/**
 * Desktop meeting apps and browsers that commonly carry remote meeting
 * audio. Process-name matching is a heuristic: Windows does not expose a
 * reliable "Google Meet tab" identity.
 */
export const MEETING_CAPABLE_PROCESS_NAMES = new Set([
  "chrome",
  "msedge",
  "chromium",
  "brave",
  "opera",
  "firefox",
  "teams",
  "ms-teams",
  "msteams",
  "zoom",
  "cpthost",
  "atmgr",
  "webex",
  "ciscocollabhost",
  "ptoneclk",
  "slack"
]);

export const PCM16_ACTIVITY_THRESHOLD = 0.01;

export function normalizeProcessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "");
}

export function findEndpointById(
  endpoints: RenderEndpoint[],
  id: string | null | undefined
): RenderEndpoint | null {
  if (!id) return null;
  return endpoints.find((endpoint) => endpoint.id === id) ?? null;
}

export function computePcm16ActivityLevel(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = (samples[index] ?? 0) / 32768;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

export function describeListenState(
  state: RenderCaptureListenState
): string {
  switch (state) {
    case "listening":
      return "Listening";
    case "no_system_audio":
      return "No system audio detected";
    case "needs_selection":
      return SELECT_MEETING_OUTPUT_PROMPT;
    case "device_changed":
      return DEVICE_CHANGED_PROMPT;
    case "error":
      return "Audio capture error";
    default:
      return "Idle";
  }
}

export function formatRenderCaptureLine(
  status: Pick<
    RenderCaptureStatusView,
    "selectedEndpointName" | "listenState"
  >
): string {
  const device =
    status.selectedEndpointName?.trim() || SELECT_MEETING_OUTPUT_PROMPT;
  return `Audio: ${device} · ${describeListenState(status.listenState)}`;
}

export function toEndpointOptions(
  endpoints: RenderEndpoint[]
): RenderCaptureEndpointOption[] {
  return endpoints.map((endpoint) => ({
    id: endpoint.id,
    name: endpoint.name,
    isDefault: endpoint.isDefault
  }));
}

function selectedResult(
  endpoint: RenderEndpoint,
  reason: string,
  automatic: boolean
): RenderResolveResult {
  return {
    status: "selected",
    endpoint,
    candidates: [endpoint],
    reason,
    automatic,
    prompt: null
  };
}

function ambiguousResult(
  candidates: RenderEndpoint[],
  reason: string,
  prompt: string
): RenderResolveResult {
  return {
    status: "ambiguous",
    endpoint: null,
    candidates,
    reason,
    automatic: false,
    prompt
  };
}

function sessionIsMeetingCapable(
  session: RenderAudioSession,
  excludeProcessIds: Set<number>
): boolean {
  if (excludeProcessIds.has(session.processId)) return false;
  return MEETING_CAPABLE_PROCESS_NAMES.has(
    normalizeProcessName(session.processName)
  );
}

function endpointsWithMeetingSessions(
  endpoints: RenderEndpoint[],
  excludeProcessIds: Set<number>
): RenderEndpoint[] {
  return endpoints.filter((endpoint) =>
    endpoint.sessions.some((session) =>
      sessionIsMeetingCapable(session, excludeProcessIds)
    )
  );
}

/**
 * Choose the Windows render endpoint for WASAPI loopback.
 *
 * Never assumes the system-default speaker is the meeting speaker.
 * Never silently picks among multiple meeting-capable endpoints.
 * App/session matching is a process-name heuristic, not a Meet SDK.
 */
export function resolveRenderEndpoint(
  input: RenderResolveInput
): RenderResolveResult {
  const endpoints = input.endpoints.filter((endpoint) => endpoint.id);
  const excludeProcessIds = new Set(input.excludeProcessIds ?? []);

  if (endpoints.length === 0) {
    return {
      status: "none",
      endpoint: null,
      candidates: [],
      reason: "no_render_endpoints",
      automatic: true,
      prompt: SELECT_MEETING_OUTPUT_PROMPT
    };
  }

  if (input.explicitId) {
    const explicit = findEndpointById(endpoints, input.explicitId);
    if (explicit) {
      return selectedResult(explicit, "explicit", false);
    }
    return {
      status: "missing",
      endpoint: null,
      candidates: endpoints,
      reason: "explicit_missing",
      automatic: false,
      prompt: DEVICE_CHANGED_PROMPT
    };
  }

  const meetingEndpoints = endpointsWithMeetingSessions(
    endpoints,
    excludeProcessIds
  );
  const current = findEndpointById(endpoints, input.currentId);

  if (meetingEndpoints.length === 1) {
    const unique = meetingEndpoints[0];
    if (unique) {
      return selectedResult(unique, "unique_meeting_session", true);
    }
  }

  if (meetingEndpoints.length > 1) {
    return ambiguousResult(
      meetingEndpoints,
      "ambiguous_meeting_sessions",
      current ? DEVICE_CHANGED_PROMPT : SELECT_MEETING_OUTPUT_PROMPT
    );
  }

  if (current) {
    return selectedResult(current, "keep_current", true);
  }

  const remembered = findEndpointById(endpoints, input.rememberedId);
  if (remembered) {
    return selectedResult(remembered, "remembered", false);
  }

  if (input.currentMissing) {
    return {
      status: "missing",
      endpoint: null,
      candidates: endpoints,
      reason: "current_gone",
      automatic: false,
      prompt: DEVICE_CHANGED_PROMPT
    };
  }

  if (endpoints.length === 1 && endpoints[0]) {
    return selectedResult(endpoints[0], "single_endpoint", true);
  }

  return ambiguousResult(
    endpoints,
    "ambiguous_idle",
    SELECT_MEETING_OUTPUT_PROMPT
  );
}
