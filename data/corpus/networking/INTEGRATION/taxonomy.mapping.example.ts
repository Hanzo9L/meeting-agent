/**
 * EXAMPLE ONLY.
 * Match this to the actual types and constant names in your taxonomy.ts.
 * The important requirement is that `networking_beginner` resolves to at
 * least one domain selected by the queries that should retrieve this corpus.
 */

export const NETWORKING_BEGINNER_SOURCE_ID = "networking_beginner";

// Example shape only. Do not paste until matched to the project's taxonomy contract.
export const networkingBeginnerSourceDomains = {
  [NETWORKING_BEGINNER_SOURCE_ID]: [
    "REPLACE_WITH_PROJECT_NETWORKING_DOMAIN",
    "REPLACE_WITH_PROJECT_UC_OR_VOICE_DOMAIN_IF_APPLICABLE",
  ],
};

/*
Eligibility test to add:

Given a query whose selected domain includes the mapped networking/UC domain,
sourceId === "networking_beginner" MUST NOT be rejected as:
  not_applicable_to_selected_domains

Given an unrelated domain, normal source eligibility rules should still apply.
*/
