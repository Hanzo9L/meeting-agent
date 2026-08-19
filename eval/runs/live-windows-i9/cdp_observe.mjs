/**
 * I9 hardware-validation observer. CDP inspect / UI click only.
 * Does not inject transcript text or call overlayApi.askQuestion.
 */
import { writeFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";
const cmd = process.argv[2] ?? "inspect";

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (typeof payload.id !== "number") return;
      const request = this.pending.get(payload.id);
      if (!request) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        request.reject(new Error(payload.error.message ?? "CDP request failed"));
        return;
      }
      request.resolve(payload.result);
    });
  }

  static async connect(url) {
    const client = new CdpClient(url);
    await new Promise((resolve, reject) => {
      client.socket.addEventListener("open", () => resolve(), { once: true });
      client.socket.addEventListener(
        "error",
        () => reject(new Error(`CDP connect failed: ${url}`)),
        { once: true }
      );
    });
    return client;
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result?.result?.description?.includes("Error:")) {
      throw new Error(result.result.description);
    }
    return result?.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function listTargets() {
  const response = await fetch(`${CDP}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP list failed: ${response.status}`);
  }
  return response.json();
}

function findTarget(targets, name) {
  return targets.find((entry) =>
    String(entry.url ?? "").includes(`/${name}/index.html`)
  );
}

async function withWindows(fn, { requireOverlay = false } = {}) {
  const targets = await listTargets();
  const helpdeskTarget = findTarget(targets, "helpdesk");
  if (!helpdeskTarget) {
    throw new Error(
      `helpdesk target not found. urls=${targets.map((t) => t.url).join(" | ")}`
    );
  }
  const overlayTarget = findTarget(targets, "overlay");
  if (requireOverlay && !overlayTarget) {
    throw new Error(
      `overlay target not found. urls=${targets.map((t) => t.url).join(" | ")}`
    );
  }
  const helpdesk = await CdpClient.connect(helpdeskTarget.webSocketDebuggerUrl);
  const overlay = overlayTarget
    ? await CdpClient.connect(overlayTarget.webSocketDebuggerUrl)
    : null;
  try {
    return await fn({ helpdesk, overlay, targets, overlayPresent: Boolean(overlayTarget) });
  } finally {
    helpdesk.close();
    overlay?.close();
  }
}

async function snapshot() {
  return withWindows(async ({ helpdesk, overlay }) => {
    const helpdeskSnap = await helpdesk.evaluate(`(async () => ({
      engineState: document.querySelector(".engine-state")?.textContent ?? "",
      liveHeader: [...document.querySelectorAll("div,span,p,button")]
        .map((el) => el.textContent?.trim() ?? "")
        .filter((text) => /QA Assist|Far Side|Microphone|Live Assist|Start QA|Stop QA/.test(text))
        .slice(0, 20),
      qaButton: [...document.querySelectorAll("button")]
        .map((button) => button.textContent?.trim() ?? "")
        .filter((text) => /QA Assist|Live Assist/.test(text)),
      liveTurns: document.querySelectorAll('[data-message-origin="live_transcript"]').length,
      liveUserTexts: [...document.querySelectorAll('[data-message-origin="live_transcript"]')]
        .map((row) => row.textContent?.trim() ?? ""),
      assistantCount: document.querySelectorAll(".message-row.assistant").length,
      assistantCards: [...document.querySelectorAll(".message-row.assistant .message-content")]
        .map((el) => (el.textContent ?? "").slice(0, 400)),
      publishers: [...document.querySelectorAll("[data-publisher]")]
        .map((el) => el.getAttribute("data-publisher")),
      session: await window.helpdeskApi.getLiveAssistSession(),
      bodyLen: (document.body.textContent ?? "").length
    }))()`);
    const overlaySnap = overlay
      ? await overlay.evaluate(`({
      present: true,
      readiness: [...document.querySelectorAll("div,span,p")]
        .map((el) => el.textContent?.trim() ?? "")
        .find((text) => /Evidence ready|Preparing evidence|Evidence unavailable/.test(text)) ?? "",
      liveTranscript: document.querySelector(".liveLabel")?.parentElement?.textContent ?? "",
      cardHeadings: [...document.querySelectorAll(".overlayEvidenceTitle")]
        .map((el) => el.textContent?.trim() ?? ""),
      publishers: [...document.querySelectorAll("[data-publisher]")]
        .map((el) => el.getAttribute("data-publisher")),
      sourceRoles: [...document.querySelectorAll("[data-source-role]")]
        .map((el) => el.getAttribute("data-source-role")),
      failureText: [...document.querySelectorAll("div,span,p")]
        .map((el) => el.textContent?.trim() ?? "")
        .filter((text) => /failed|unavailable|Evidence retrieval/i.test(text))
        .slice(0, 10),
      bodyText: (document.body.textContent ?? "").slice(0, 2500)
    })`)
      : { present: false, readiness: "", bodyText: "" };
    return { helpdesk: helpdeskSnap, overlay: overlaySnap, at: new Date().toISOString() };
  });
}

async function ensureConversation() {
  return withWindows(async ({ helpdesk }) => {
    const hasConversation = await helpdesk.evaluate(
      `!document.querySelector('textarea[aria-label="Ask or paste anything"]')?.disabled`
    );
    if (!hasConversation) {
      await helpdesk.evaluate(`
        [...document.querySelectorAll("button")]
          .find((button) => (button.textContent ?? "").includes("New Chat"))?.click()
      `);
      const started = Date.now();
      while (Date.now() - started < 10_000) {
        const ready = await helpdesk.evaluate(
          `!document.querySelector('textarea[aria-label="Ask or paste anything"]')?.disabled`
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return helpdesk.evaluate(`(async () => ({
      disabled: !!document.querySelector('textarea[aria-label="Ask or paste anything"]')?.disabled,
      session: await window.helpdeskApi.getLiveAssistSession()
    }))()`);
  });
}

async function clickButton(label) {
  return withWindows(async ({ helpdesk }) => {
    return helpdesk.evaluate(`
      (() => {
        const button = [...document.querySelectorAll("button")]
          .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(label)}));
        if (!button) {
          return {
            ok: false,
            buttons: [...document.querySelectorAll("button")].map((b) => b.textContent)
          };
        }
        button.click();
        return { ok: true, text: button.textContent };
      })()
    `);
  });
}

async function clickQa(label) {
  return withWindows(async ({ helpdesk }) => {
    const clicked = await helpdesk.evaluate(`
      (() => {
        const button = [...document.querySelectorAll("button")]
          .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(label)}));
        if (!button) return { ok: false, buttons: [...document.querySelectorAll("button")].map((b) => b.textContent) };
        button.click();
        return { ok: true, text: button.textContent };
      })()
    `);
    return clicked;
  });
}

async function waitReady(timeoutMs = 120_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot();
    if ((last.overlay.readiness ?? "").includes("Evidence ready")) {
      return { ok: true, waitedMs: Date.now() - started, snapshot: last };
    }
    if ((last.overlay.readiness ?? "").includes("Evidence unavailable")) {
      return { ok: false, waitedMs: Date.now() - started, snapshot: last };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, waitedMs: Date.now() - started, snapshot: last };
}

async function waitLiveTurns(minCount, timeoutMs = 45_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot();
    if ((last.helpdesk.liveTurns ?? 0) >= minCount) {
      return { ok: true, waitedMs: Date.now() - started, snapshot: last };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, waitedMs: Date.now() - started, snapshot: last };
}

async function waitOverlayCards(minCount, timeoutMs = 45_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await snapshot();
    const cards = last.overlay.cardHeadings?.length ?? 0;
    const assistants = last.helpdesk.assistantCount ?? 0;
    if (cards >= minCount && assistants >= minCount) {
      return { ok: true, waitedMs: Date.now() - started, snapshot: last };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, waitedMs: Date.now() - started, snapshot: last };
}

const result =
  cmd === "targets"
    ? await listTargets()
    : cmd === "snapshot"
      ? await snapshot()
      : cmd === "ensure-conversation"
        ? await ensureConversation()
        : cmd === "new-chat"
        ? await clickButton("New Chat")
      : cmd === "show-overlay"
        ? await clickButton("Show Overlay")
      : cmd === "start-qa"
          ? await clickQa("Start QA Assist")
          : cmd === "stop-qa"
            ? await clickQa("Stop QA Assist")
            : cmd === "wait-ready"
              ? await waitReady(Number(process.argv[3] ?? 120000))
              : cmd === "wait-turns"
                ? await waitLiveTurns(
                    Number(process.argv[3] ?? 1),
                    Number(process.argv[4] ?? 45000)
                  )
              : cmd === "wait-cards"
                ? await waitOverlayCards(
                    Number(process.argv[3] ?? 1),
                    Number(process.argv[4] ?? 45000)
                  )
                : await withWindows(async ({ helpdesk, overlay, targets }) => ({
                    targets: targets.map((t) => ({ title: t.title, url: t.url })),
                    helpdeskText: await helpdesk.evaluate(`document.body.textContent`),
                    overlayText: overlay
                      ? await overlay.evaluate(`document.body.textContent`)
                      : null
                  }));

const out = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : null;
const text = JSON.stringify(result, null, 2);
if (out) writeFileSync(out, text);
process.stdout.write(`${text}\n`);
