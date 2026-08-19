import assert from "node:assert/strict";
import test from "node:test";
import { routeQueryIntent } from "./domainPolicies";
import { extractQueryIntent } from "./queryIntentRules";
import { buildScopeDocumentFilter } from "./retrievalSqliteCommon";

test("document allowlist is the hard bound for pack-only retrieval", () => {
  const route = routeQueryIntent(
    extractQueryIntent(
      "How do you troubleshoot one-way audio in Teams Direct Routing?"
    ).intent
  );
  const bounded = buildScopeDocumentFilter({
    ...route.scope,
    eligibleDocumentIds: ["document-a", "document-b", "document-a"]
  });
  assert.equal(bounded.sql, "d.document_id IN (?, ?)");
  assert.deepEqual(bounded.params, ["document-a", "document-b"]);

  const empty = buildScopeDocumentFilter({
    ...route.scope,
    eligibleDocumentIds: []
  });
  assert.deepEqual(empty, { sql: "1 = 0", params: [] });

  const unbounded = buildScopeDocumentFilter(route.scope);
  assert.match(unbounded.sql, /d\.source_id = \? AND d\.track_id = \?/);
});
