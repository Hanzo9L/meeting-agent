import type {
  AnswerPresentationProfile,
  PresentationCaveatRef,
  PresentationUnsupportedGap
} from "./answerPresentationTypes";
import type { CitationMappingResult } from "./citationTypes";
import type {
  AnswerPlan,
  EvidenceBundle,
  ExtractiveAssemblyProvenance,
  GroundedAnswer
} from "./types";
import type { QueryAnswerType } from "../retrievalV2/queryIntent";

export type GroundedSynthesisBlockType =
  | "direct_answer"
  | "step"
  | "fact"
  | "transition"
  | "script";

export interface GroundedSynthesisSource {
  claimId: string;
  evidenceId: string;
  sourceId: string;
  sourceTitle: string;
  canonicalUrl: string;
  authorityRole: string;
  headingPath?: string[];
}

export interface GroundedSynthesisClaim {
  claimId: string;
  aspectId: string;
  aspectSubject: string;
  text: string;
  mandatory: boolean;
  requestedMethods: string[];
  sources: GroundedSynthesisSource[];
}

export interface GroundedSynthesisUnsupportedAspect {
  aspectId: string;
  subject: string;
  detail: string;
}

export interface GroundedSynthesisCaveat {
  code: string;
  text: string;
}

export interface GroundedSynthesisPayload {
  schemaVersion: "grounded-answer-synthesis/v1";
  question: string;
  profile: AnswerPresentationProfile;
  answerability: "answered" | "partial";
  answerType: QueryAnswerType;
  requestedMethods: string[];
  requestedAspects: Array<{
    aspectId: string;
    subject: string;
    answerObject: string;
    operation: string | null;
    supported: boolean;
    requestedMethods: string[];
  }>;
  claims: GroundedSynthesisClaim[];
  unsupportedAspects: GroundedSynthesisUnsupportedAspect[];
  caveats: GroundedSynthesisCaveat[];
  executableWorkflow?: {
    language: "powershell";
    script: string;
    supportingClaimIds: string[];
  } | null;
}

export interface GroundedSynthesisBlock {
  blockType: GroundedSynthesisBlockType;
  text: string;
  supportingClaimIds: string[];
}

export interface GroundedSynthesisOutput {
  schemaVersion: "grounded-answer-synthesis-output/v1";
  profile: AnswerPresentationProfile;
  blocks: GroundedSynthesisBlock[];
  unsupportedAspectIds: string[];
  caveatCodes: string[];
}

export interface GroundedSynthesisProviderResult {
  output: GroundedSynthesisOutput;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export interface GroundedSynthesisProvider {
  readonly providerId: string;
  synthesize(
    payload: GroundedSynthesisPayload
  ): Promise<GroundedSynthesisProviderResult>;
}

export interface GroundedSynthesisValidation {
  valid: boolean;
  issues: string[];
}

export interface RenderedGroundedSynthesis {
  answerText: string;
  proofFactRanges: Array<{
    claimId: string;
    startOffset: number;
    endOffset: number;
  }>;
}

export type GroundedSynthesisStatus =
  | "not_configured"
  | "bypassed_insufficient_evidence"
  | "succeeded"
  | "provider_failed"
  | "validation_failed";

export interface GroundedSynthesisAttempt {
  rendered: RenderedGroundedSynthesis | null;
  requestCount: 0 | 1;
  status: GroundedSynthesisStatus;
  fallbackReason: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
}

const TECHNICAL_WORDS = new Set([
  "admin",
  "center",
  "cmdlet",
  "command",
  "license",
  "licensing",
  "module",
  "parameter",
  "policy",
  "powershell",
  "prerequisite",
  "property",
  "role",
  "tenant"
]);

const BEHAVIOR_WORDS = new Set([
  "all",
  "always",
  "any",
  "automatically",
  "can",
  "cannot",
  "could",
  "disabled",
  "each",
  "enabled",
  "every",
  "must",
  "never",
  "only",
  "required",
  "requires",
  "will"
]);

const TECHNICAL_NOUNS = new Set([
  "control",
  "controls",
  "license",
  "licenses",
  "parameter",
  "parameters",
  "plan",
  "plans",
  "policy",
  "policies",
  "property",
  "properties",
  "role",
  "roles"
]);

const PHRASE_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "determine",
  "for",
  "find",
  "from",
  "gather",
  "identify",
  "in",
  "information",
  "obtain",
  "of",
  "on",
  "read",
  "report",
  "retrieve",
  "return",
  "returned",
  "show",
  "use",
  "the",
  "to",
  "with"
]);

const CONTENT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "their",
  "this",
  "to",
  "with",
  "you",
  "your"
]);

const FIXED_PRESENTATION_WORDS = new Set([
  "answer",
  "based",
  "collect",
  "current",
  "currently",
  "determine",
  "direct",
  "each",
  "find",
  "finally",
  "first",
  "following",
  "gather",
  "grounded",
  "here",
  "identify",
  "information",
  "next",
  "obtain",
  "provide",
  "process",
  "read",
  "relay",
  "report",
  "result",
  "retrieve",
  "run",
  "show",
  "step",
  "then",
  "use",
  "using",
  "validated",
  "verified",
  "workflow"
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeWord(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith("ies") && lower.length > 4) {
    return `${lower.slice(0, -3)}y`;
  }
  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 3) {
    return lower.slice(0, -1);
  }
  return lower;
}

function words(value: string): string[] {
  return value.match(/[A-Za-z0-9][A-Za-z0-9+_.:-]*/g) ?? [];
}

function protectedTokens(value: string): Set<string> {
  const protectedSet = new Set<string>();
  for (const parameter of value.match(/(^|\s)-[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    protectedSet.add(parameter.trim().toLowerCase());
  }
  for (const url of value.match(/https?:\/\/[^\s)]+/gi) ?? []) {
    protectedSet.add(url.toLowerCase());
  }
  for (const token of words(value)) {
    const normalized = token
      .replace(/^[.:+]+|[.:+]+$/g, "")
      .toLowerCase();
    if (
      /^(?:get|set|grant|new|remove|enable|disable|test|show|find|search|measure|select|compare)-/i.test(
        token
      ) ||
      /^[A-Z]{2,}[A-Z0-9]*$/.test(token) ||
      /^[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+$/.test(token) ||
      /^\d+(?:\.\d+)*$/.test(token) ||
      TECHNICAL_WORDS.has(normalized) ||
      BEHAVIOR_WORDS.has(normalized)
    ) {
      protectedSet.add(normalized);
    }
  }
  return protectedSet;
}

function technicalPhrases(value: string): Set<string> {
  const phrases = new Set<string>();
  for (const segment of value.split(/[.,;:()[\]{}\n]/)) {
    const normalizedWords = words(segment).map(normalizeWord);
    for (let end = 0; end < normalizedWords.length; end += 1) {
      if (!TECHNICAL_NOUNS.has(normalizedWords[end]!)) continue;
      let start = end;
      while (
        start > 0 &&
        end - start < 4 &&
        !PHRASE_STOPWORDS.has(normalizedWords[start - 1]!)
      ) {
        start -= 1;
      }
      const phraseWords = normalizedWords.slice(start, end + 1);
      if (phraseWords.length >= 2) phrases.add(phraseWords.join(" "));
    }
  }
  return phrases;
}

function semanticWords(value: string): string[] {
  return words(value).flatMap((word) =>
    word
      .replace(/^[.:+]+|[.:+]+$/g, "")
      .split(/[-_]/)
      .filter(Boolean)
      .map(normalizeWord)
  );
}

function allowedTextForClaim(claim: GroundedSynthesisClaim): string {
  return [
    claim.text,
    claim.aspectSubject,
    ...claim.requestedMethods,
    ...claim.sources.flatMap((source) => [
      source.sourceId,
      source.sourceTitle,
      source.authorityRole,
      source.authorityRole.replaceAll("_", " "),
      ...(source.headingPath ?? [])
    ])
  ].join(" ");
}

export function approvedSynthesisContentWords(
  claim: GroundedSynthesisClaim
): string[] {
  return unique([
    ...semanticWords(allowedTextForClaim(claim)),
    ...CONTENT_STOPWORDS,
    ...FIXED_PRESENTATION_WORDS
  ]).sort();
}

function factualBlockIssues(
  block: GroundedSynthesisBlock,
  claims: GroundedSynthesisClaim[]
): string[] {
  const issues: string[] = [];
  const allowedText = claims.map(allowedTextForClaim).join(" ");
  const allowedTokens = protectedTokens(allowedText);
  const allowedWords = new Set(semanticWords(allowedText));
  for (const token of protectedTokens(block.text)) {
    if (
      !allowedTokens.has(token) &&
      !FIXED_PRESENTATION_WORDS.has(token)
    ) {
      issues.push(`unattributed_technical_token:${token}`);
    }
  }
  for (const phrase of technicalPhrases(block.text)) {
    if (
      semanticWords(phrase).some((word) => !allowedWords.has(word))
    ) {
      issues.push(`unattributed_technical_phrase:${phrase}`);
    }
  }
  for (const word of semanticWords(block.text)) {
    if (
      word.length > 2 &&
      !CONTENT_STOPWORDS.has(word) &&
      !FIXED_PRESENTATION_WORDS.has(word) &&
      !allowedWords.has(word)
    ) {
      issues.push(`unattributed_content_word:${word}`);
    }
  }
  return issues;
}

function connectiveBlockIssues(block: GroundedSynthesisBlock): string[] {
  if (block.text.length > 240) return ["connective_block_too_long"];
  return [
    ...protectedTokens(block.text)
  ].map((token) => `connective_contains_technical_token:${token}`);
}

export function validateExecutablePowerShellAgainstClaims(
  script: string,
  claims: GroundedSynthesisClaim[]
): GroundedSynthesisValidation {
  const allowed = claims.map(allowedTextForClaim).join(" ").toLowerCase();
  const issues: string[] = [];
  const requireAllowed = (kind: string, token: string): void => {
    const normalized = token.toLowerCase();
    const namedParameter =
      kind === "parameter" && normalized.startsWith("-")
        ? `${normalized.slice(1)} parameter`
        : null;
    if (
      !allowed.includes(normalized) &&
      (!namedParameter || !allowed.includes(namedParameter))
    ) {
      issues.push(`ungrounded_script_${kind}:${token.toLowerCase()}`);
    }
  };
  for (const cmdlet of script.match(
    /\b[A-Z][A-Za-z0-9]+-[A-Z][A-Za-z0-9]+\b/g
  ) ?? []) {
    requireAllowed("cmdlet", cmdlet);
  }
  for (const parameter of script.match(
    /(^|\s)-[A-Za-z][A-Za-z0-9]*/gm
  ) ?? []) {
    requireAllowed("parameter", parameter.trim());
  }
  for (const match of script.matchAll(/\.([A-Za-z][A-Za-z0-9]*)/g)) {
    const property = match[1]!;
    if (property.toLowerCase() !== "csv") {
      requireAllowed("property", property);
    }
  }
  for (const match of script.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*)\s*=/gm)) {
    requireAllowed("property", match[1]!);
  }
  for (const primitive of ["ForEach-Object", "Where-Object", "[pscustomobject]"]) {
    if (script.toLowerCase().includes(primitive.toLowerCase())) {
      requireAllowed("primitive", primitive);
    }
  }
  return { valid: issues.length === 0, issues: unique(issues) };
}

function buildExecutableWorkflow(
  profile: AnswerPresentationProfile,
  claims: GroundedSynthesisClaim[],
  unsupportedAspects: GroundedSynthesisUnsupportedAspect[]
): GroundedSynthesisPayload["executableWorkflow"] {
  if (profile !== "helpdesk_detailed" || unsupportedAspects.length > 0) {
    return null;
  }
  const requiredSubjects = [
    "enterprise voice",
    "phone number",
    "voice routing policy",
    "dial plan",
    "calling policy",
    "per-user iteration",
    "policy assignment filtering",
    "output object construction",
    "csv export"
  ];
  const subjects = new Set(
    claims.map((claim) => claim.aspectSubject.toLowerCase())
  );
  if (!requiredSubjects.every((subject) => subjects.has(subject))) return null;
  const script = `$users = Get-CsOnlineUser -Filter {(EnterpriseVoiceEnabled -eq $True) -and (FeatureTypes -contains 'PhoneSystem') -and (AccountEnabled -eq $True)} -AccountType User

$users | ForEach-Object {
  $user = $_
  $dialPlan = Get-CsEffectiveTenantDialPlan -Identity $user.Identity
  $callingPolicy = $user.EffectivePolicyAssignments |
    Where-Object { $_.PolicyType -eq 'TeamsCallingPolicy' }

  [pscustomobject]@{
    Identity = $user.Identity
    EnterpriseVoiceEnabled = $user.EnterpriseVoiceEnabled
    TelephoneNumbers = $user.TelephoneNumbers
    OnlineVoiceRoutingPolicy = $user.OnlineVoiceRoutingPolicy
    EffectiveTenantDialPlanName = $dialPlan.EffectiveTenantDialPlanName
    TeamsCallingPolicy = $callingPolicy.PolicyAssignment.displayName
  }
} | Export-Csv -Path .\\TeamsVoiceReport.csv -NoTypeInformation`;
  const validation = validateExecutablePowerShellAgainstClaims(script, claims);
  if (!validation.valid) return null;
  return {
    language: "powershell",
    script,
    supportingClaimIds: claims.map((claim) => claim.claimId)
  };
}

export function buildGroundedSynthesisPayload(params: {
  question: string;
  profile: AnswerPresentationProfile;
  bundle: EvidenceBundle;
  plan: AnswerPlan;
  answer: GroundedAnswer;
  provenance: ExtractiveAssemblyProvenance;
  citationMapping: CitationMappingResult;
  selectedClaimIds: string[];
  selectedCaveats: PresentationCaveatRef[];
  selectedUnsupportedGaps: PresentationUnsupportedGap[];
}): GroundedSynthesisPayload | null {
  if (params.answer.answerability === "insufficient_evidence") return null;
  const aspectById = new Map(
    params.bundle.aspectCoverage.aspects.map((aspect) => [
      aspect.aspectId,
      aspect
    ])
  );
  const plannedClaimById = new Map(
    params.plan.plannedClaims.map((claim) => [claim.claimId, claim])
  );
  const renderedById = new Map(
    params.provenance.renderedClaims.map((claim) => [claim.claimId, claim])
  );
  const aspectOrder = new Map(
    params.bundle.aspectCoverage.aspects.map((aspect, index) => [
      aspect.aspectId,
      index
    ])
  );
  const normalizedQuestion = params.question
    .toLowerCase()
    .replace(/[-_]+/g, " ");
  const subjectPosition = (subject: string): number => {
    const position = normalizedQuestion.indexOf(
      subject.toLowerCase().replace(/[-_]+/g, " ")
    );
    return position < 0 ? Number.MAX_SAFE_INTEGER : position;
  };
  const validSources = params.citationMapping.citations.filter(
    (citation) =>
      citation.validation.state === "valid" && citation.canonicalUrl !== null
  );
  const evidenceById = new Map(
    params.bundle.evidence.map((evidence) => [
      evidence.evidenceId,
      evidence
    ])
  );
  const claims = params.selectedClaimIds
    .map((claimId): GroundedSynthesisClaim | null => {
      const planned = plannedClaimById.get(claimId);
      const rendered = renderedById.get(claimId);
      if (!planned || !rendered) return null;
      const aspect = aspectById.get(planned.requiredAspectId);
      return {
        claimId,
        aspectId: planned.requiredAspectId,
        aspectSubject: aspect?.subject ?? planned.requiredAspectId,
        text: rendered.renderedText,
        mandatory: planned.mandatory,
        requestedMethods:
          aspect?.methodConstraints
            .filter((constraint) => constraint.required)
            .map((constraint) => constraint.label) ?? [],
        sources: validSources
          .filter((citation) => citation.claimId === claimId)
          .map((citation) => ({
            claimId,
            evidenceId: citation.evidenceId,
            sourceId: citation.sourceId,
            sourceTitle: citation.sourceTitle,
            canonicalUrl: citation.canonicalUrl!,
            authorityRole: citation.authorityRole,
            headingPath:
              evidenceById.get(citation.evidenceId)?.location.headingPath ?? []
          }))
      };
    })
    .filter((claim): claim is GroundedSynthesisClaim => claim !== null)
    .sort(
      (left, right) =>
        subjectPosition(left.aspectSubject) -
          subjectPosition(right.aspectSubject) ||
        (aspectOrder.get(left.aspectId) ?? Number.MAX_SAFE_INTEGER) -
          (aspectOrder.get(right.aspectId) ?? Number.MAX_SAFE_INTEGER)
    );
  const unsupportedAspects = params.selectedUnsupportedGaps
    .map((unsupported) => {
      const aspectId = unsupported.aspectId;
      const aspect = aspectById.get(aspectId);
      return {
        aspectId,
        subject: aspect?.subject ?? aspectId,
        detail: unsupported.detail
      };
    })
    .filter((aspect) => Boolean(aspect.detail));
  const caveats = params.selectedCaveats.map((caveat) => ({
    code: caveat.code,
    text: caveat.text
  }));
  const executableWorkflow = buildExecutableWorkflow(
    params.profile,
    claims,
    unsupportedAspects
  );
  return {
    schemaVersion: "grounded-answer-synthesis/v1",
    question: params.question,
    profile: params.profile,
    answerability: params.answer.answerability,
    answerType: params.plan.answerType,
    requestedMethods: unique(
      claims.flatMap((claim) => claim.requestedMethods)
    ),
    requestedAspects: params.bundle.aspectCoverage.aspects
      .filter((aspect) => aspect.requirement === "mandatory")
      .map((aspect) => ({
        aspectId: aspect.aspectId,
        subject: aspect.subject,
        answerObject: aspect.answerObject,
        operation: aspect.operation,
        supported:
          params.bundle.aspectCoverage.supportedMandatoryAspectIds.includes(
            aspect.aspectId
          ),
        requestedMethods: aspect.methodConstraints
          .filter((constraint) => constraint.required)
          .map((constraint) => constraint.label)
      })),
    claims,
    unsupportedAspects,
    caveats,
    executableWorkflow
  };
}

export function validateGroundedSynthesisOutput(
  payload: GroundedSynthesisPayload,
  output: GroundedSynthesisOutput
): GroundedSynthesisValidation {
  const issues: string[] = [];
  if (output.schemaVersion !== "grounded-answer-synthesis-output/v1") {
    issues.push("schema_version_invalid");
  }
  if (output.profile !== payload.profile) issues.push("profile_mismatch");
  const claimById = new Map(
    payload.claims.map((claim) => [claim.claimId, claim])
  );
  const seenClaimIds = new Set<string>();
  let factualBlockCount = 0;
  let scriptBlockCount = 0;
  for (const block of output.blocks) {
    if (!block.text.trim()) {
      issues.push("empty_block");
      continue;
    }
    if (block.blockType === "script") {
      scriptBlockCount += 1;
      const expected = payload.executableWorkflow;
      if (!expected) {
        issues.push("executable_script_not_authorized");
        continue;
      }
      if (block.text.trim() !== expected.script.trim()) {
        issues.push("executable_script_mismatch");
      }
      const actualIds = unique(block.supportingClaimIds).sort();
      const expectedIds = [...expected.supportingClaimIds].sort();
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
        issues.push("executable_script_claim_coverage_invalid");
      }
      const scriptValidation = validateExecutablePowerShellAgainstClaims(
        block.text,
        payload.claims
      );
      issues.push(...scriptValidation.issues);
      continue;
    }
    const referencedClaims: GroundedSynthesisClaim[] = [];
    for (const claimId of block.supportingClaimIds) {
      const claim = claimById.get(claimId);
      if (!claim) {
        issues.push(`unknown_claim_id:${claimId}`);
        continue;
      }
      if (seenClaimIds.has(claimId)) {
        issues.push(`duplicate_claim_id:${claimId}`);
      }
      seenClaimIds.add(claimId);
      referencedClaims.push(claim);
    }
    if (referencedClaims.length === 0) {
      if (block.blockType !== "transition") {
        issues.push("factual_block_without_claim");
      }
      issues.push(...connectiveBlockIssues(block));
    } else {
      if (block.blockType === "transition") {
        issues.push("transition_block_has_claim");
      }
      factualBlockCount += 1;
      issues.push(...factualBlockIssues(block, referencedClaims));
    }
  }
  for (const claim of payload.claims) {
    if (!seenClaimIds.has(claim.claimId)) {
      issues.push(`required_claim_missing:${claim.claimId}`);
    }
  }
  if (payload.executableWorkflow && scriptBlockCount !== 1) {
    issues.push("executable_script_block_missing");
  }
  if (!payload.executableWorkflow && scriptBlockCount > 0) {
    issues.push("unexpected_executable_script_block");
  }
  if (
    payload.profile === "live_assist_quick" &&
    (factualBlockCount < Math.min(2, payload.claims.length) ||
      factualBlockCount > 5)
  ) {
    issues.push("quick_factual_block_count_invalid");
  }
  const expectedUnsupported = payload.unsupportedAspects
    .map((aspect) => aspect.aspectId)
    .sort();
  const actualUnsupported = unique(output.unsupportedAspectIds).sort();
  if (JSON.stringify(expectedUnsupported) !== JSON.stringify(actualUnsupported)) {
    issues.push("unsupported_aspect_coverage_invalid");
  }
  const expectedCaveats = payload.caveats.map((caveat) => caveat.code).sort();
  const actualCaveats = unique(output.caveatCodes).sort();
  if (JSON.stringify(expectedCaveats) !== JSON.stringify(actualCaveats)) {
    issues.push("caveat_coverage_invalid");
  }
  const unsupportedText = payload.unsupportedAspects
    .map((aspect) => `${aspect.subject} ${aspect.detail}`)
    .join(" ");
  const unsupportedTokens = protectedTokens(unsupportedText);
  for (const block of output.blocks.filter(
    (entry) => entry.supportingClaimIds.length > 0
  )) {
    for (const token of protectedTokens(block.text)) {
      if (unsupportedTokens.has(token)) {
        const supportedText = block.supportingClaimIds
          .map((claimId) => claimById.get(claimId))
          .filter(
            (claim): claim is GroundedSynthesisClaim => Boolean(claim)
          )
          .map(allowedTextForClaim)
          .join(" ");
        if (!protectedTokens(supportedText).has(token)) {
          issues.push(`unsupported_primitive_in_factual_block:${token}`);
        }
      }
    }
  }
  return { valid: issues.length === 0, issues: unique(issues) };
}

export function renderGroundedSynthesis(
  payload: GroundedSynthesisPayload,
  output: GroundedSynthesisOutput
): RenderedGroundedSynthesis {
  let answerText = "";
  const proofFactRanges: RenderedGroundedSynthesis["proofFactRanges"] = [];
  const append = (value: string): void => {
    answerText += value;
  };
  const appendLine = (value: string): void => {
    if (answerText.length > 0) append("\n\n");
    append(value);
  };
  let stepNumber = 0;
  for (const block of output.blocks) {
    if (block.blockType === "step") stepNumber += 1;
    if (answerText.length > 0) append("\n\n");
    if (
      payload.profile === "helpdesk_detailed" &&
      block.blockType === "step"
    ) {
      append(`${stepNumber}. `);
    }
    const startOffset = answerText.length;
    append(
      block.blockType === "script"
        ? `\`\`\`powershell\n${block.text.trim()}\n\`\`\``
        : block.text.trim()
    );
    const endOffset = answerText.length;
    for (const claimId of block.supportingClaimIds) {
      proofFactRanges.push({ claimId, startOffset, endOffset });
    }
  }
  if (payload.unsupportedAspects.length > 0) {
    const gapDetails = unique(
      payload.unsupportedAspects.map((aspect) => aspect.detail)
    );
    appendLine(
      `${
        payload.profile === "helpdesk_detailed"
          ? "Unsupported gaps\n"
          : ""
      }${gapDetails.join("\n")}`
    );
  }
  if (payload.caveats.length > 0) {
    const caveatTexts = unique(
      payload.caveats.map((caveat) => caveat.text)
    );
    appendLine(
      `${payload.profile === "helpdesk_detailed" ? "Caveats\n" : ""}${caveatTexts.join("\n")}`
    );
  }
  if (payload.profile === "helpdesk_detailed") {
    const sources = unique(
      payload.claims.flatMap((claim) =>
        claim.sources.map(
          (source) => `${source.sourceTitle} — ${source.canonicalUrl}`
        )
      )
    );
    if (sources.length > 0) appendLine(`Sources\n${sources.join("\n")}`);
  }
  return { answerText: answerText.trim(), proofFactRanges };
}

export async function attemptGroundedSynthesis(params: {
  provider: GroundedSynthesisProvider | null | undefined;
  payload: GroundedSynthesisPayload | null;
}): Promise<GroundedSynthesisAttempt> {
  if (!params.provider) {
    return {
      rendered: null,
      requestCount: 0,
      status: "not_configured",
      fallbackReason: null,
      usage: null
    };
  }
  if (!params.payload) {
    return {
      rendered: null,
      requestCount: 0,
      status: "bypassed_insufficient_evidence",
      fallbackReason: null,
      usage: null
    };
  }
  try {
    const result = await params.provider.synthesize(params.payload);
    const validation = validateGroundedSynthesisOutput(
      params.payload,
      result.output
    );
    if (!validation.valid) {
      return {
        rendered: null,
        requestCount: 1,
        status: "validation_failed",
        fallbackReason: validation.issues.join(","),
        usage: result.usage
      };
    }
    const rendered = renderGroundedSynthesis(params.payload, result.output);
    if (
      !rendered.answerText ||
      !rendered.proofFactRanges.every(
        (range) =>
          range.startOffset >= 0 &&
          range.endOffset > range.startOffset &&
          range.endOffset <= rendered.answerText.length
      )
    ) {
      return {
        rendered: null,
        requestCount: 1,
        status: "validation_failed",
        fallbackReason: "rendered_synthesis_range_invalid",
        usage: result.usage
      };
    }
    return {
      rendered,
      requestCount: 1,
      status: "succeeded",
      fallbackReason: null,
      usage: result.usage
    };
  } catch (error) {
    return {
      rendered: null,
      requestCount: 1,
      status: "provider_failed",
      fallbackReason:
        error instanceof Error ? error.message : "provider_failed",
      usage: null
    };
  }
}
