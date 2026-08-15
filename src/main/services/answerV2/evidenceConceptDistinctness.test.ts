import assert from "node:assert/strict";
import test from "node:test";
import type { FusedRetrievalCandidate } from "../retrievalV2";
import {
  areConceptsRedundant,
  computeConceptSignature,
  isBroadSelectionAspect
} from "./evidenceConceptDistinctness";
import type { EvidenceAspect, EvidenceAspectSubject } from "./types";

function subject(kind: EvidenceAspectSubject["kind"], terms: string[]): EvidenceAspectSubject {
  return {
    kind,
    value: terms.join(" "),
    terms,
    aliases: [terms.join(" ")],
    questionSpans: [terms.join(" ")]
  };
}

function makeAspect(overrides: Partial<EvidenceAspect> = {}): EvidenceAspect {
  return {
    aspectId: "mandatory:unresolved:example:general",
    requirement: "mandatory",
    subject: "example",
    subjectTerms: ["example"],
    subjects: [subject("unresolved", ["example"])],
    operation: null,
    methodConstraints: [],
    answerObject: "fact",
    relationship: null,
    breadth: "bounded",
    requiredFacets: ["behavior"],
    authorityRequirement: {
      requiredRoles: [],
      requiredDomains: [],
      requireCanonicalIdentity: false,
      identityType: null
    },
    minimumSupportStrength: "direct",
    supportType: "concept_definition",
    canonicalIdentifier: null,
    derivation: { ruleIds: [], questionSpans: [], unresolved: false },
    ...overrides
  };
}

function makeCandidate(params: {
  documentId: string;
  sectionId: string;
  title: string;
  headingPath?: string[];
  text?: string;
}): FusedRetrievalCandidate {
  return {
    candidateId: `cand-${params.documentId}-${params.sectionId}`,
    method: "semantic",
    documentId: params.documentId,
    chunkId: `chunk-${params.documentId}-${params.sectionId}`,
    sectionId: params.sectionId,
    headingPath: params.headingPath ?? [params.title],
    title: params.title,
    text: params.text ?? params.title,
    authority: {
      sourceId: "ms-sharepoint-docs",
      trackId: "ga",
      sourceStatus: "ga",
      authorityTier: "tier1",
      authorityRoles: ["sharepoint_admin_primary"],
      routePriority: "primary"
    },
    provenance: {
      sourcePath: "path/to/doc.md",
      canonicalUrl: "https://learn.microsoft.com/x",
      sourceRevision: { transport: "github", commitSha: "abc" },
      headingPath: params.headingPath ?? [params.title],
      sectionId: params.sectionId
    },
    scores: { lexical: 0.4, exactMatch: null, semanticSimilarity: 0.8 },
    retrievalReasons: [],
    methods: ["semantic"],
    methodSignals: {
      methods: ["semantic"],
      exact: { matched: false, score: null, rank: null },
      lexical: { score: 0.4, rank: 1 },
      semantic: { similarity: 0.8, rank: 1 }
    },
    fusion: {
      rank: 1,
      score: 90,
      contributions: {
        exactScore: 0,
        lexicalRank: 2,
        semanticRank: 3,
        methodAgreement: 0,
        routePriority: 7,
        authorityRole: 6,
        betaPolicy: 0,
        implicitCmdletSpecificity: 0,
        total: 90
      },
      rationale: ["test"]
    },
    sourceDedup: { mergedFromCandidateIds: [] }
  };
}

test("isBroadSelectionAspect: unresolved fallback subject is broad", () => {
  const aspect = makeAspect({ subjects: [subject("unresolved", ["secure", "sharepoint", "data"])] });
  assert.equal(isBroadSelectionAspect(aspect), true);
});

test("isBroadSelectionAspect: subject reducing to only generic scaffolding terms is broad", () => {
  const aspect = makeAspect({
    subjects: [subject("technology", ["microsoft", "teams"])],
    answerObject: "procedure",
    requiredFacets: ["procedure"]
  });
  assert.equal(isBroadSelectionAspect(aspect), true);
});

test("isBroadSelectionAspect: a specific named entity/policy subject is not broad", () => {
  const aspect = makeAspect({
    subjects: [subject("entity", ["restricted", "content", "discovery"])]
  });
  assert.equal(isBroadSelectionAspect(aspect), false);
});

test("isBroadSelectionAspect: a specific named entity is not broad merely because it carries the legacy 'broad' mechanism-breadth flag", () => {
  // "How does Direct Routing voice routing work?" / "How do Microsoft Teams
  // Calling Plans work?" bind to one specific, non-generic named entity and
  // set breadth: "broad" only to require both purpose+mechanism facets. That
  // must not, by itself, turn on multi-concept selection: these narrow
  // "how X works" answers must stay compact (the primary anti-overselection
  // regression for this slice).
  const aspect = makeAspect({
    subjects: [subject("technology", ["direct", "routing"])],
    answerObject: "mechanism",
    breadth: "broad",
    requiredFacets: ["purpose", "mechanism"]
  });
  assert.equal(isBroadSelectionAspect(aspect), false);
});

test("isBroadSelectionAspect: identity/relationship/comparison aspects are never broad", () => {
  const cmdlet = makeAspect({
    subjects: [subject("unresolved", ["set", "spo", "site"])],
    answerObject: "cmdlet_identifier",
    requiredFacets: ["identifier", "operation"]
  });
  const relationship = makeAspect({
    subjects: [subject("unresolved", ["policy", "device"])],
    answerObject: "relationship",
    requiredFacets: ["relationship"]
  });
  assert.equal(isBroadSelectionAspect(cmdlet), false);
  assert.equal(isBroadSelectionAspect(relationship), false);
});

test("isBroadSelectionAspect: optional aspects are never broad", () => {
  const aspect = makeAspect({
    requirement: "optional",
    subjects: [subject("unresolved", ["thing"])]
  });
  assert.equal(isBroadSelectionAspect(aspect), false);
});

test("computeConceptSignature + areConceptsRedundant: distinct SharePoint concepts are not redundant", () => {
  const aspect = makeAspect({ subjectTerms: ["secure", "sharepoint", "data", "accessible"] });
  const permissions = computeConceptSignature(
    makeCandidate({
      documentId: "doc-permissions",
      sectionId: "s1",
      title: "Manage access to agents in SharePoint",
      headingPath: ["Manage access to agents in SharePoint", "Control user access through licensing"],
      text: "Control who can access Copilot agents in SharePoint through licensing assignment."
    }),
    aspect
  );
  const restrictedDiscovery = computeConceptSignature(
    makeCandidate({
      documentId: "doc-rcd",
      sectionId: "s1",
      title: "Restrict discovery of SharePoint sites and content",
      headingPath: ["Restrict discovery of SharePoint sites and content"],
      text: "Restricted Content Discovery prevents high-risk sites and files from being referenced by Copilot."
    }),
    aspect
  );
  assert.equal(areConceptsRedundant(restrictedDiscovery, [permissions]), false);
});

test("computeConceptSignature + areConceptsRedundant: same document section is always redundant", () => {
  const aspect = makeAspect();
  const candidate = makeCandidate({
    documentId: "doc-1",
    sectionId: "section-a",
    title: "Overview of external sharing"
  });
  const signatureA = computeConceptSignature(candidate, aspect);
  const signatureB = computeConceptSignature(candidate, aspect);
  assert.equal(areConceptsRedundant(signatureB, [signatureA]), true);
});

test("computeConceptSignature + areConceptsRedundant: near-verbatim body text is redundant despite a superficially different title", () => {
  const aspect = makeAspect({ subjectTerms: ["direct", "routing", "voice"] });
  const sharedText =
    "Direct Routing voice routing enables PSTN connectivity and routes calls by policy.";
  const original = computeConceptSignature(
    makeCandidate({
      documentId: "doc-a",
      sectionId: "s1",
      title: "Direct Routing voice routing overview",
      text: sharedText
    }),
    aspect
  );
  const copy = computeConceptSignature(
    makeCandidate({
      documentId: "doc-b",
      sectionId: "s2",
      title: "Direct Routing voice routing overview copy",
      text: sharedText
    }),
    aspect
  );
  assert.equal(areConceptsRedundant(copy, [original]), true);
});

test("computeConceptSignature + areConceptsRedundant: a candidate contributing no distinctive terms of its own is redundant", () => {
  const aspect = makeAspect({ subjectTerms: ["secure", "sharepoint", "data"] });
  const primary = computeConceptSignature(
    makeCandidate({ documentId: "doc-1", sectionId: "s1", title: "Secure SharePoint data overview" }),
    aspect
  );
  const genericRestatement = computeConceptSignature(
    makeCandidate({
      documentId: "doc-2",
      sectionId: "s2",
      title: "SharePoint data overview",
      text: "An overview of secure SharePoint data."
    }),
    aspect
  );
  assert.equal(areConceptsRedundant(genericRestatement, [primary]), true);
});
