import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const PROJECT_ENV_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.env"
);

export function loadCliEnvironment(path = PROJECT_ENV_PATH): void {
  config({ path, quiet: true });
}

loadCliEnvironment();
