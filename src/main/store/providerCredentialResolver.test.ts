import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialPresentationStatus,
  resolveProviderCredential
} from "./providerCredentialResolver";

test("environment-managed credential status never exposes plaintext", () => {
  const secret = "external-deepgram-secret-1234";
  const resolved = resolveProviderCredential({
    environmentValue: secret,
    storedValue: "ignored-stored-value",
    decryptor: {
      available: true,
      decrypt: () => "stored-secret"
    }
  });
  const status = credentialPresentationStatus(
    "deepgram",
    resolved
  );

  assert.equal(resolved.value, secret);
  assert.deepEqual(status, {
    provider: "deepgram",
    state: "configured",
    source: "environment",
    externallyManaged: true,
    maskedSuffix: "1234"
  });
  assert.equal(JSON.stringify(status).includes(secret), false);
});

test("secure stored credentials expose only masked status", () => {
  const resolved = resolveProviderCredential({
    environmentValue: "",
    storedValue: "encrypted",
    decryptor: {
      available: true,
      decrypt: () => "stored-openai-secret-abcd"
    }
  });
  const status = credentialPresentationStatus(
    "openai_embeddings",
    resolved
  );

  assert.equal(status.state, "configured");
  assert.equal(status.source, "secure_store");
  assert.equal(status.maskedSuffix, "abcd");
  assert.equal(
    JSON.stringify(status).includes("stored-openai-secret"),
    false
  );
});

test("unreadable secure storage reports invalid without fallback", () => {
  const resolved = resolveProviderCredential({
    environmentValue: "",
    storedValue: "encrypted",
    decryptor: {
      available: false,
      decrypt: () => {
        throw new Error("must not decrypt");
      }
    }
  });

  assert.deepEqual(resolved, {
    state: "invalid",
    value: "",
    source: "secure_store"
  });
});
