import type {
  ProviderCredentialId,
  ProviderCredentialStatus
} from "@shared/types";

export interface CredentialDecryptor {
  available: boolean;
  decrypt(encryptedValue: string): string;
}

export type ResolvedCredential =
  | {
      state: "configured";
      value: string;
      source: "environment" | "secure_store";
    }
  | {
      state: "missing" | "invalid";
      value: "";
      source: "missing" | "secure_store";
    };

export function resolveProviderCredential(input: {
  environmentValue: string;
  storedValue: string;
  decryptor: CredentialDecryptor;
}): ResolvedCredential {
  const environmentValue = input.environmentValue.trim();
  if (environmentValue) {
    return {
      state: "configured",
      value: environmentValue,
      source: "environment"
    };
  }
  if (!input.storedValue) {
    return {
      state: "missing",
      value: "",
      source: "missing"
    };
  }
  if (!input.decryptor.available) {
    return {
      state: "invalid",
      value: "",
      source: "secure_store"
    };
  }
  try {
    const value = input.decryptor
      .decrypt(input.storedValue)
      .trim();
    return value
      ? { state: "configured", value, source: "secure_store" }
      : { state: "invalid", value: "", source: "secure_store" };
  } catch {
    return {
      state: "invalid",
      value: "",
      source: "secure_store"
    };
  }
}

export function credentialPresentationStatus(
  provider: ProviderCredentialId,
  resolved: ResolvedCredential
): ProviderCredentialStatus {
  return {
    provider,
    state: resolved.state,
    source: resolved.source,
    externallyManaged: resolved.source === "environment",
    maskedSuffix:
      resolved.state === "configured"
        ? resolved.value.slice(-4)
        : null
  };
}
