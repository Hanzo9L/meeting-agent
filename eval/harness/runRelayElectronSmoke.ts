interface DebugTarget {
  title: string;
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
  error?: {
    message?: string;
  };
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
      const payload = JSON.parse(String(event.data)) as CdpResponse;
      if (typeof payload.id !== "number") return;
      const request = this.pending.get(payload.id);
      if (!request) return;
      this.pending.delete(payload.id);
      if (payload.error) {
        request.reject(
          new Error(payload.error.message ?? "CDP request failed")
        );
        return;
      }
      request.resolve(payload.result);
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
        () => reject(new Error("Could not connect to Electron CDP")),
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
    })) as {
      result?: {
        value?: unknown;
        description?: string;
      };
    };
    if (result.result?.description?.includes("Error:")) {
      throw new Error(result.result.description);
    }
    return result.result?.value as T;
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
      this.socket.send(JSON.stringify({ id, method, params }));
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
  throw new Error("Timed out waiting for Relay UI state");
}

async function helpdeskTarget(): Promise<DebugTarget> {
  const response = await fetch("http://127.0.0.1:9222/json/list");
  const targets = (await response.json()) as DebugTarget[];
  const target = targets.find((entry) =>
    entry.url.endsWith("/helpdesk/index.html")
  );
  if (!target) throw new Error("Relay Helpdesk target not found");
  return target;
}

async function setField(
  client: CdpClient,
  selector: string,
  value: string,
  elementType: "HTMLTextAreaElement" | "HTMLInputElement"
): Promise<void> {
  await client.evaluate(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing field: ${selector}`)});
      const setter = Object.getOwnPropertyDescriptor(
        ${elementType}.prototype,
        "value"
      ).set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
}

async function submitQuestion(
  client: CdpClient,
  question: string,
  previousAssistantCount: number
): Promise<number> {
  await setField(
    client,
    'textarea[aria-label="Ask or paste anything"]',
    question,
    "HTMLTextAreaElement"
  );
  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".composer-footer button")]
        .find((entry) => entry.textContent.trim() === "Send");
      if (!button) throw new Error("Send button not found");
      button.click();
    })()
  `);
  return waitFor(
    () =>
      client.evaluate<number>(
        'document.querySelectorAll(".message-row.assistant").length'
      ),
    (count) => count > previousAssistantCount
  );
}

async function initialSmoke(client: CdpClient): Promise<object> {
  const identity = await client.evaluate<{
    title: string;
    relay: boolean;
    text: string;
  }>(`({
    title: document.title,
    relay: document.body.textContent.includes("Relay") &&
      document.body.textContent.includes("Real-Time Operations"),
    text: document.body.innerText.slice(0, 500)
  })`);
  if (
    identity.title !== "Relay: Real-Time Operations" ||
    !identity.relay
  ) {
    throw new Error(
      `Relay product identity is not visible: ${JSON.stringify(identity)}`
    );
  }

  await client.evaluate(`
    (() => {
      const button = document.querySelector(".new-chat-button");
      if (!button) throw new Error("New Chat button missing");
      button.click();
    })()
  `);
  await waitFor(
    () =>
      client.evaluate<boolean>(
        '!document.querySelector(\'textarea[aria-label="Ask or paste anything"]\').disabled'
      ),
    Boolean
  );

  let assistantCount = 0;
  assistantCount = await submitQuestion(
    client,
    "How do Microsoft Teams Calling Plans work?",
    assistantCount
  );
  const callingPlansAnswer =
    await client.evaluate<string>(
      'document.querySelectorAll(".message-row.assistant .message-content")[0].textContent'
    );
  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".assistant-actions button")]
        .find((entry) => entry.textContent.startsWith("Sources"));
      if (!button) throw new Error("Sources button missing");
      button.click();
    })()
  `);
  const sourceState = await waitFor(
    () =>
      client.evaluate<{ title: string; url: string } | null>(`
        (() => {
          const card = document.querySelector(".source-card");
          return card ? {
            title: card.querySelector(".source-link").textContent,
            url: card.querySelector(".source-url").textContent
          } : null;
        })()
      `),
    (value) => value !== null
  );
  if (!sourceState) {
    throw new Error("Source presentation did not render");
  }
  if (!sourceState.url.startsWith("https://learn.microsoft.com/")) {
    throw new Error("Source URL is not canonical Microsoft Learn");
  }
  await client.evaluate(
    'document.querySelector(".source-link").click()'
  );
  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".assistant-actions button")]
        .find((entry) => entry.textContent === "Copy answer");
      button.click();
    })()
  `);
  await waitFor(
    () =>
      client.evaluate<boolean>(
        'document.body.innerText.includes("Answer copied.")'
      ),
    Boolean
  );

  assistantCount = await submitQuestion(
    client,
    "What does Set-CsOnlineVoiceRoutingPolicy do?",
    assistantCount
  );
  assistantCount = await submitQuestion(
    client,
    "What does Set-CsDefinitelyNotARealCmdlet do?",
    assistantCount
  );
  const insufficient = await client.evaluate<boolean>(`
    [...document.querySelectorAll(".answerability-label")]
      .some((entry) => entry.textContent === "Insufficient evidence")
  `);
  if (!insufficient) {
    throw new Error("Insufficient-evidence presentation missing");
  }

  await client.evaluate(`
    (() => {
      const button = document.querySelector(".conversation-item.active button[aria-label^='Rename']");
      if (!button) throw new Error("Rename button missing");
      button.click();
    })()
  `);
  await setField(
    client,
    ".conversation-item.active .rename-form input",
    "Relay Smoke Persisted",
    "HTMLInputElement"
  );
  await client.evaluate(
    'document.querySelector(".conversation-item.active .rename-form").requestSubmit()'
  );
  await waitFor(
    () =>
      client.evaluate<boolean>(
        'document.body?.innerText.includes("Relay Smoke Persisted") ?? false'
      ),
    Boolean
  );
  return {
    phase: "initial",
    assistantCount,
    callingPlansAnswer,
    sourceState,
    insufficient,
    overlayTargetExpected: true
  };
}

async function restartSmoke(client: CdpClient): Promise<object> {
  await waitFor(
    () =>
      client.evaluate<boolean>(
        'document.body.innerText.includes("Relay Smoke Persisted")'
      ),
    Boolean
  );
  const state = await client.evaluate<{
    assistantCount: number;
    sourceCount: number;
    hasCallingPlans: boolean;
    hasInsufficient: boolean;
  }>(`({
    assistantCount: document.querySelectorAll(".message-row.assistant").length,
    sourceCount: [...document.querySelectorAll(".assistant-actions button")]
      .filter((entry) => entry.textContent.startsWith("Sources")).length,
    hasCallingPlans: document.body.innerText.includes("Calling Plans"),
    hasInsufficient: document.body.innerText.includes("Insufficient evidence")
  })`);
  if (
    state.assistantCount < 3 ||
    state.sourceCount < 2 ||
    !state.hasCallingPlans ||
    !state.hasInsufficient
  ) {
    throw new Error("Persisted grounded history did not reload");
  }
  await client.evaluate(`
    (() => {
      window.confirm = () => true;
      const button = document.querySelector(".conversation-item.active button[aria-label^='Delete']");
      if (!button) throw new Error("Delete button missing");
      button.click();
    })()
  `);
  await waitFor(
    () =>
      client.evaluate<boolean>(
        '!document.body.innerText.includes("Relay Smoke Persisted")'
      ),
    Boolean
  );
  return {
    phase: "restart",
    ...state,
    deleteVerified: true
  };
}

async function singleWindowSmoke(
  client: CdpClient,
  initialTargets: DebugTarget[]
): Promise<object> {
  const initial = {
    helpdeskTargets: initialTargets.filter((entry) =>
      entry.url.endsWith("/helpdesk/index.html")
    ).length,
    overlayTargets: initialTargets.filter((entry) =>
      entry.url.endsWith("/overlay/index.html")
    ).length,
    settingsTargets: initialTargets.filter((entry) =>
      entry.url.endsWith("/settings/index.html")
    ).length
  };
  if (
    initial.helpdeskTargets !== 1 ||
    initial.overlayTargets !== 0 ||
    initial.settingsTargets !== 0
  ) {
    throw new Error(
      `Unexpected initial window inventory: ${JSON.stringify(initial)}`
    );
  }

  await waitFor(
    () =>
      client.evaluate<boolean>(`
        (() => {
          const button = document.querySelector(".settings-button");
          if (!button) return false;
          button.click();
          return true;
        })()
      `),
    Boolean
  );
  const settingsState = await waitFor(
    () =>
      client.evaluate<{
        hasSettings: boolean;
        hasDeepgram: boolean;
        hasEmbeddings: boolean;
        hasDeprecatedControls: boolean;
      }>(`({
        hasSettings: document.body.innerText.includes("Settings"),
        hasDeepgram: document.body.innerText.includes("Deepgram STT"),
        hasEmbeddings: document.body.innerText.includes("OpenAI Embeddings"),
        hasDeprecatedControls: /Topic|repository URL|repository branch|manual repository sync/i.test(
          document.querySelector(".settings-page")?.innerText || ""
        )
      })`),
    (value) =>
      value.hasSettings &&
      value.hasDeepgram &&
      value.hasEmbeddings
  );
  if (settingsState.hasDeprecatedControls) {
    throw new Error("Deprecated settings controls remain visible");
  }

  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".settings-page button")]
        .find((entry) => entry.textContent.includes("Back to conversation"));
      if (!button) throw new Error("Settings back button missing");
      button.click();
    })()
  `);
  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".live-assist-controls button")]
        .find((entry) => entry.textContent.includes("Show Overlay"));
      if (!button) throw new Error("Show Overlay button missing");
      button.click();
    })()
  `);
  const overlayTarget = await waitFor(
    async () => {
      const response = await fetch(
        "http://127.0.0.1:9222/json/list"
      );
      const targets = (await response.json()) as DebugTarget[];
      return (
        targets.find((entry) =>
          entry.url.endsWith("/overlay/index.html")
        ) ?? null
      );
    },
    (value) => value !== null
  );
  if (!overlayTarget) throw new Error("Lazy overlay did not load");
  const overlayClient = await CdpClient.connect(
    overlayTarget.webSocketDebuggerUrl
  );
  let overlayHydrated = false;
  try {
    overlayHydrated = await waitFor(
      () =>
        overlayClient.evaluate<boolean>(
          'document.body?.innerText.includes("Stopped") ?? false'
        ),
      Boolean
    );
  } finally {
    overlayClient.close();
  }

  await client.evaluate(`
    (() => {
      const button = [...document.querySelectorAll(".live-assist-controls button")]
        .find((entry) => entry.textContent.includes("Hide Overlay"));
      if (!button) throw new Error("Hide Overlay button missing");
      button.click();
    })()
  `);
  const hidden = await waitFor(
    () =>
      client.evaluate<boolean>(`
        window.helpdeskApi.getOverlayVisibility()
          .then((result) => result.ok && result.data.created && !result.data.visible)
      `),
    Boolean
  );

  return {
    phase: "single-window",
    initial,
    settingsState,
    overlayHydrated,
    overlayHiddenWithoutStoppingLiveAssist: hidden
  };
}

async function main(): Promise<void> {
  const phase = process.argv[2] ?? "initial";
  const targetsResponse = await fetch(
    "http://127.0.0.1:9222/json/list"
  );
  const targets = (await targetsResponse.json()) as DebugTarget[];
  const overlayLoaded = targets.some((entry) =>
    entry.url.endsWith("/overlay/index.html")
  );
  const client = await CdpClient.connect(
    (await helpdeskTarget()).webSocketDebuggerUrl
  );
  try {
    const result =
      phase === "inspect"
        ? await client.evaluate<Record<string, unknown>>(`({
            body: document.body.innerText,
            buttons: [...document.querySelectorAll("button")].map((button) => ({
              text: button.textContent,
              className: button.className
            })),
            url: location.href
          })`)
        : phase === "single-window"
        ? await singleWindowSmoke(client, targets)
        : phase === "restart"
        ? await restartSmoke(client)
        : await initialSmoke(client);
    process.stdout.write(
      `${JSON.stringify({ ...result, overlayLoaded }, null, 2)}\n`
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        error:
          error instanceof Error
            ? error.message
            : "relay_electron_smoke_failed"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
