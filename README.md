# Meeting Agent

Windows-first real-time call assistant for Zoom, Teams, Webex, and similar meeting tools.

It captures system-audio loopback, streams transcription with Deepgram, detects question-like utterances, and streams concise answers from OpenAI into a private overlay window.

## Features

- System-audio loopback capture (callee speech from meeting playback).
- Real-time transcript updates and low-latency streamed answers.
- Always-on-top transparent overlay with Windows capture exclusion (`setContentProtection(true)`).
- Settings toggle for **Demo mode** (disables capture exclusion so the overlay appears in screen shares).
- Knowledge-base retrieval from `MicrosoftDocs/msteams-docs` (sparse-cloned, markdown-indexed).
- Settings window for topic, API keys, and overlay placement/opacity.
- Simple overlay controls: Start, Stop, and Clear.

## Tech stack

- Electron + React + TypeScript (`electron-vite`).
- Deepgram streaming STT (`nova-3`).
- OpenAI streaming chat completion (`gpt-4o-mini`).
- `electron-store` + Electron `safeStorage` for encrypted key storage at rest.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start in development mode:

   ```bash
   npm run dev
   ```

3. Create a local `.env` file (from `.env.example`) and set:

   ```bash
   DEEPGRAM_API_KEY=your_deepgram_key
   OPENAI_API_KEY=your_openai_key
   ```

4. Open **Settings** window and add (optional overrides):
   - Deepgram API key
   - OpenAI API key
   - Topic text for call-specific guidance
   - Knowledge base settings (repo URL / branch), then click **Sync knowledge base now**

5. In overlay window, click **Start** to begin live capture + answering.

Environment variable values are used automatically when saved keys are missing.

## Build

Build app bundles:

```bash
npm run build
```

Build Windows installer (NSIS):

```bash
npm run build:win
```

Artifacts are written to `release/`.

## Notes and limitations

- Primary target is **Windows 10/11**.
- Overlay capture exclusion is implemented via `BrowserWindow.setContentProtection(true)`, which maps to `WDA_EXCLUDEFROMCAPTURE` on modern Windows builds.
- Enable **Demo mode** in Settings to turn capture exclusion off when you want participants to see the overlay during a screen share.
- macOS capture-exclusion behavior differs on newer versions and is not guaranteed.
- Knowledge sync uses a sparse checkout of `msteams-platform` from `MicrosoftDocs/msteams-docs`, so first sync requires `git` and network access.
