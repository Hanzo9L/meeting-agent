import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LearnRagChild, LearnRagChildError } from "./learnRagChild";

async function withTempRoot(
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-evidence-child-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function stubScript(body: string): string {
  return `import json, sys, time
${body}
`;
}

test("real bridge source uses select_scope and top_k=5, not GET /search", () => {
  const source = readFileSync(
    "C:/Users/joegc/projects/learn-rag/learn-rag/service/relay_bridge.py",
    "utf8"
  );
  assert.match(source, /select_scope\(/);
  assert.match(source, /top_k=TOP_K/);
  assert.match(source, /TOP_K = 5/);
  assert.doesNotMatch(source, /GET \/search/);
  assert.doesNotMatch(source, /service\.api/);
  assert.doesNotMatch(source, /engine\.search\([^)]*top_k=3/);
});

test("python unavailable fails cleanly", async () => {
  const child = new LearnRagChild({
    pythonExecutable: "relay-python-missing-i1",
    learnRagRoot: "C:/Users/joegc/projects/learn-rag/learn-rag",
    startTimeoutMs: 3_000
  });
  await assert.rejects(
    () => child.start(),
    (error: unknown) => {
      assert.ok(error instanceof LearnRagChildError);
      assert.equal(error.code, "python_unavailable");
      return true;
    }
  );
  child.dispose();
});

test("invalid learn-rag path fails cleanly", async () => {
  const child = new LearnRagChild({
    learnRagRoot: join(tmpdir(), "relay-missing-learn-rag"),
    startTimeoutMs: 1_000
  });
  await assert.rejects(
    () => child.start(),
    (error: unknown) => {
      assert.ok(error instanceof LearnRagChildError);
      assert.equal(error.code, "learn_rag_path_invalid");
      return true;
    }
  );
  child.dispose();
});

test("missing corpus fails before search", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "service"));
    await writeFile(join(root, "service", "relay_bridge.py"), "print('nope')\n");
    const child = new LearnRagChild({
      learnRagRoot: root,
      startTimeoutMs: 1_000
    });
    await assert.rejects(
      () => child.start(),
      (error: unknown) => {
        assert.ok(error instanceof LearnRagChildError);
        assert.equal(error.code, "corpus_missing");
        return true;
      }
    );
    child.dispose();
  });
});

test("missing index fails before search", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "service"));
    await mkdir(join(root, "data"));
    await writeFile(join(root, "service", "relay_bridge.py"), "print('nope')\n");
    await writeFile(join(root, "data", "corpus.db"), "not-a-db");
    const child = new LearnRagChild({
      learnRagRoot: root,
      startTimeoutMs: 1_000
    });
    await assert.rejects(
      () => child.start(),
      (error: unknown) => {
        assert.ok(error instanceof LearnRagChildError);
        assert.equal(error.code, "index_missing");
        return true;
      }
    );
    child.dispose();
  });
});

test("child crash fails in-flight requests and dispose kills the process", async () => {
  await withTempRoot(async (root) => {
    const script = join(root, "stub.py");
    await writeFile(
      script,
      stubScript(`
print(json.dumps({"id":"__bridge_ready__","ok":True,"event":"ready","engine":"stub","corpusFingerprint":"c","indexFingerprint":"i"}), flush=True)
line = sys.stdin.readline()
sys.exit(2)
`)
    );
    const child = new LearnRagChild({
      learnRagRoot: root,
      bridgeScript: script,
      startTimeoutMs: 5_000,
      searchTimeoutMs: 5_000
    });
    await child.start();
    await assert.rejects(() => child.request({ query: "crash please" }));
    child.dispose();
    await child.waitUntilStopped();
  });
});

test("search timeout does not hang the run", async () => {
  await withTempRoot(async (root) => {
    const script = join(root, "stub.py");
    await writeFile(
      script,
      stubScript(`
print(json.dumps({"id":"__bridge_ready__","ok":True,"event":"ready","engine":"stub","corpusFingerprint":"c","indexFingerprint":"i"}), flush=True)
for line in sys.stdin:
    time.sleep(5)
`)
    );
    const child = new LearnRagChild({
      learnRagRoot: root,
      bridgeScript: script,
      startTimeoutMs: 5_000,
      searchTimeoutMs: 300
    });
    await child.start();
    await assert.rejects(
      () => child.request({ query: "slow" }),
      (error: unknown) => {
        assert.ok(error instanceof LearnRagChildError);
        assert.equal(error.code, "search_timeout");
        return true;
      }
    );
    child.dispose();
    await child.waitUntilStopped();
  });
});

test("Python child is spawned with UTF-8 stdio encoding", () => {
  const source = readFileSync(
    resolve("src/main/services/evidence/learnRagChild.ts"),
    "utf8"
  );
  assert.match(source, /PYTHONIOENCODING: "utf-8"/);
  assert.match(source, /PYTHONUTF8: "1"/);
});

test("curly quotes from ensure_ascii=False JSON survive the child protocol", async () => {
  await withTempRoot(async (root) => {
    const script = join(root, "stub.py");
    await writeFile(
      script,
      stubScript(`
ready = {"id":"__bridge_ready__","ok":True,"event":"ready","engine":"stub","corpusFingerprint":"c","indexFingerprint":"i"}
print(json.dumps(ready, ensure_ascii=False), flush=True)
req = json.loads(sys.stdin.readline())
body = "Identity \\u201cAnalogInteropPolicy\\u201d"
print(json.dumps({"id": req["id"], "ok": True, "body": body}, ensure_ascii=False), flush=True)
`)
    );
    const child = new LearnRagChild({
      learnRagRoot: root,
      bridgeScript: script,
      startTimeoutMs: 5_000,
      searchTimeoutMs: 5_000
    });
    await child.start();
    const payload = await child.request({ query: "quotes" });
    assert.equal(
      payload["body"],
      "Identity \u201cAnalogInteropPolicy\u201d"
    );
    assert.equal(String(payload["body"]).includes("\uFFFD"), false);
    child.dispose();
    await child.waitUntilStopped();
  });
});

test("child status starts warming then ready, and start() coalesces", async () => {
  await withTempRoot(async (root) => {
    const script = join(root, "stub.py");
    await writeFile(
      script,
      stubScript(`
print(json.dumps({"id":"__bridge_ready__","ok":True,"event":"ready","engine":"stub","corpusFingerprint":"c","indexFingerprint":"i"}), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    print(json.dumps({"id": req["id"], "ok": True}), flush=True)
`)
    );
    const seen: string[] = [];
    const child = new LearnRagChild({
      learnRagRoot: root,
      bridgeScript: script,
      startTimeoutMs: 5_000,
      searchTimeoutMs: 5_000,
      onStatusChange: (status) => seen.push(status)
    });
    try {
      assert.equal(child.getStatus(), "starting");
      const first = child.start();
      const second = child.start();
      assert.equal(first, second);
      await first;
      assert.equal(child.getStatus(), "ready");
      assert.ok(seen.includes("warming"));
      assert.ok(seen.includes("ready"));
      await child.start();
      assert.equal(child.getStatus(), "ready");
    } finally {
      child.dispose();
      await child.waitUntilStopped();
    }
  });
});

test("failed start surfaces failed status without hanging", async () => {
  const child = new LearnRagChild({
    learnRagRoot: join(tmpdir(), "relay-missing-learn-rag-status"),
    startTimeoutMs: 1_000
  });
  await assert.rejects(() => child.start());
  assert.equal(child.getStatus(), "failed");
  child.dispose();
});
