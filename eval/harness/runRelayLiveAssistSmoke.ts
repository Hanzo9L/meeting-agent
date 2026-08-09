export {};

let smokeStep = "connect";

interface DebugTarget {
  url: string;
  webSocketDebuggerUrl: string;
}

interface CdpResponse {
  id?: number;
  result?: {
    result?: {
      value?: unknown;
      description?: string;
    };
  };
  error?: { message?: string };
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      const payload = JSON.parse(
        String(event.data)
      ) as CdpResponse;
      if (typeof payload.id !== "number") return;
      const request = this.pending.get(payload.id);
      if (!request) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        request.reject(
          new Error(
            payload.error.message ?? "CDP request failed"
          )
        );
      } else {
        request.resolve(payload.result);
      }
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const client = new CdpClient(url);
    await new Promise<void>((resolve, reject) => {
      client.socket.addEventListener("open", () => resolve(), {
        once: true
      });
      client.socket.addEventListener(
        "error",
        () => reject(new Error("Electron CDP connection failed")),
        { once: true }
      );
    });
    return client;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    })) as CdpResponse["result"];
    if (result?.result?.description?.includes("Error:")) {
      throw new Error(result.result.description);
    }
    return result?.result?.value as T;
  }

  close(): void {
    this.socket.close();
  }

  private send(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(
        JSON.stringify({ id, method, params })
      );
    });
  }
}

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 120_000
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Live Assist state");
}

async function main(): Promise<void> {
  if (
    process.argv[2] !== "inspect" &&
    process.env["RELAY_ENABLE_ACOUSTIC_SMOKE"] !== "1"
  ) {
    process.stdout.write(
      `${JSON.stringify(
        {
          skipped: true,
          reason:
            "Controlled microphone/STT input is unavailable. Set RELAY_ENABLE_ACOUSTIC_SMOKE=1 only with an isolated audio source."
        },
        null,
        2
      )}\n`
    );
    return;
  }
  const response = await fetch(
    "http://127.0.0.1:9222/json/list"
  );
  const targets = (await response.json()) as DebugTarget[];
  const find = (name: string) => {
    const target = targets.find((entry) =>
      entry.url.endsWith(`/${name}/index.html`)
    );
    if (!target) throw new Error(`${name} target not found`);
    return target;
  };
  const helpdesk = await CdpClient.connect(
    find("helpdesk").webSocketDebuggerUrl
  );
  const overlay = await CdpClient.connect(
    find("overlay").webSocketDebuggerUrl
  );
  try {
    if (process.argv[2] === "inspect") {
      process.stdout.write(
        `${JSON.stringify(
          {
            session: await helpdesk.evaluate(
              `window.helpdeskApi.getLiveAssistSession()`
            ),
            conversationState: await helpdesk.evaluate(
              `(async () => {
                const listed = await window.helpdeskApi.listConversations();
                if (!listed.ok || !listed.data[0]) return listed;
                return window.helpdeskApi.loadConversation(listed.data[0].id);
              })()`
            ),
            helpdeskText: await helpdesk.evaluate(
              `document.body.textContent`
            ),
            overlayText: await overlay.evaluate(
              `document.body.textContent`
            )
          },
          null,
          2
        )}\n`
      );
      return;
    }
    smokeStep = "inspect_initial_state";
    const before = await helpdesk.evaluate<{
      assistants: number;
      liveTurns: number;
      text: string;
    }>(`({
      assistants: document.querySelectorAll(".message-row.assistant").length,
      liveTurns: document.querySelectorAll('[data-message-origin="live_transcript"]').length,
      text: document.body.textContent
    })`);
    const hasConversation =
      await helpdesk.evaluate<boolean>(
        `!document.querySelector('textarea[aria-label="Ask or paste anything"]')?.disabled`
      );
    if (!hasConversation) {
      await helpdesk.evaluate(`
        [...document.querySelectorAll("button")]
          .find((button) => button.textContent.includes("New Chat"))?.click()
      `);
      await waitFor(
        () =>
          helpdesk.evaluate<boolean>(
            `!document.querySelector('textarea[aria-label="Ask or paste anything"]')?.disabled`
          ),
        Boolean
      );
    }

    await helpdesk.evaluate(`
      (() => {
        const button = [...document.querySelectorAll("button")]
          .find((entry) => entry.textContent.includes("Start Live Assist"));
        if (!button) throw new Error("Start Live Assist button not found");
        button.click();
      })()
    `);
    smokeStep = "wait_live_session_active";
    await waitFor(
      () =>
        helpdesk.evaluate<string>(
          `document.querySelector(".engine-state")?.textContent ?? ""`
        ),
      (text) => text.includes("Live Assist"),
      10_000
    );

    await overlay.evaluate(
      `window.overlayApi.askQuestion("What is Set-CsOnlineVoiceUser used for?")`
    );
    smokeStep = "wait_first_live_user";
    const firstLiveCount = await waitFor(
      () =>
        helpdesk.evaluate<number>(
          `document.querySelectorAll('[data-message-origin="live_transcript"]').length`
        ),
      (count) => count > before.liveTurns
    );
    const firstAssistantCount = await waitFor(
      () =>
        helpdesk.evaluate<number>(
          `document.querySelectorAll(".message-row.assistant").length`
        ),
      (count) => count > before.assistants
    );
    smokeStep = "inspect_first_answer";
    const firstAnswer = await helpdesk.evaluate<string>(
      `[...document.querySelectorAll(".message-row.assistant .message-content")].at(-1)?.textContent ?? ""`
    );
    await helpdesk.evaluate(`
      [...document.querySelectorAll(".message-row.assistant")]
        .at(-1)?.querySelector(".assistant-actions button:nth-of-type(2)")?.click()
    `);
    const firstSourceCount = await helpdesk.evaluate<number>(
      `[...document.querySelectorAll(".message-row.assistant")].at(-1)?.querySelectorAll(".source-list .source-card").length ?? 0`
    );
    const overlayAnswerMatches = await waitFor(
      () =>
        overlay.evaluate<boolean>(
          `${JSON.stringify(firstAnswer)} !== "" && document.body.textContent.includes(${JSON.stringify(firstAnswer)})`
        ),
      Boolean
    );

    await overlay.evaluate(
      `window.overlayApi.askQuestion("What does Set-CsDefinitelyNotARealCmdlet do?")`
    );
    smokeStep = "wait_insufficient_live_user";
    await waitFor(
      () =>
        helpdesk.evaluate<number>(
          `document.querySelectorAll('[data-message-origin="live_transcript"]').length`
        ),
      (count) => count > firstLiveCount
    );
    smokeStep = "wait_insufficient_answer";
    await waitFor(
      () =>
        helpdesk.evaluate<number>(
          `document.querySelectorAll(".message-row.assistant").length`
        ),
      (count) => count > firstAssistantCount
    );
    const insufficient = await helpdesk.evaluate<boolean>(
      `[...document.querySelectorAll(".answerability-label")]
        .at(-1)?.textContent.includes("Insufficient evidence") ?? false`
    );

    const liveCountBeforeStop =
      await helpdesk.evaluate<number>(
        `document.querySelectorAll('[data-message-origin="live_transcript"]').length`
      );
    await helpdesk.evaluate(`
      (() => {
        const button = [...document.querySelectorAll("button")]
          .find((entry) => entry.textContent.includes("Stop Live Assist"));
        if (!button) throw new Error("Stop Live Assist button not found");
        button.click();
      })()
    `);
    smokeStep = "wait_stopped";
    await waitFor(
      () =>
        helpdesk.evaluate<string>(
          `document.querySelector(".engine-state")?.textContent ?? ""`
        ),
      (text) => !text.includes("Live Assist"),
      10_000
    );
    await overlay.evaluate(
      `window.overlayApi.askQuestion("This must not persist after stop?")`
    );
    smokeStep = "verify_post_stop";
    await new Promise((resolve) => setTimeout(resolve, 500));
    const liveCountAfterStop =
      await helpdesk.evaluate<number>(
        `document.querySelectorAll('[data-message-origin="live_transcript"]').length`
      );

    process.stdout.write(
      `${JSON.stringify(
        {
          started: true,
          acceptedLiveTranscript: firstLiveCount > before.liveTurns,
          groundedAssistantPersisted:
            firstAssistantCount > before.assistants,
          firstAnswer,
          firstSourceCount,
          overlayAnswerMatches,
          insufficientEvidencePersisted: insufficient,
          stopped: true,
          postStopQuestionRejected:
            liveCountAfterStop === liveCountBeforeStop
        },
        null,
        2
      )}\n`
    );
  } finally {
    helpdesk.close();
    overlay.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          error instanceof Error
            ? error.message
            : "relay_live_assist_smoke_failed",
        step: smokeStep
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
