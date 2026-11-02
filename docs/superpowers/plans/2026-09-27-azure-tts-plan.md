# Azure TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the Azure Neural TTS engine securely on the backend, converting text to a high-fidelity 48kHz audio buffer, and stream it to the frontend via WebSockets for playback using a manual test button.

**Architecture:** A new Azure TTS service is added to `tts.ts` that hits the `centralindia` REST endpoint using `riff-48khz-16bit-mono-pcm`. The backend WebSocket server (`ws.ts`) listens for a `TEST_AZURE_TTS` message, generates the audio, and responds with `play_audio` containing the base64 string. The frontend (`App.tsx`) provides a button to trigger this loop and plays the returned audio.

**Tech Stack:** Node.js HTTP Fetch (backend), WebSockets, Azure Cognitive Services REST API.

**Spec:** `docs/superpowers/specs/2026-09-27-azure-tts-design.md`

## Global Constraints

- Azure API keys must remain strictly on the backend.
- Format must be `riff-48khz-16bit-mono-pcm`.
- Voices must be selected from the approved hi-IN neural voices.

## Review Focus

- Invalid API Key: `tts.ts` must gracefully handle 401s without crashing the server.
- Azure Quota/Rate Limit: `tts.ts` must gracefully handle 429s without crashing.
- WebSocket message format: The frontend must not crash if `audioData` is missing or malformed.

---

### Task 1: Environment & Config Setup

**Files:**
- Modify: `.env`
- Modify: `.env.example`

**Interfaces:**
- Produces: `process.env.AZURE_SPEECH_KEY` and `process.env.AZURE_SPEECH_REGION`

- [ ] **Step 1: Write variables to `.env.example`**
Add `AZURE_SPEECH_KEY=` and `AZURE_SPEECH_REGION=` so users know what to provide.

- [ ] **Step 2: Provide variables in local `.env`**
Since this is a local development instance, append the user's provided API key `YOUR_AZURE_SPEECH_KEY` to `.env` along with `AZURE_SPEECH_REGION=centralindia`. (Don't commit `.env`).

- [ ] **Step 3: Commit `.env.example` changes**
```bash
git add .env.example
git commit -m "chore: add azure tts variables to env template"
```

### Task 2: Azure TTS Engine Implementation

**Files:**
- Modify: `src/backend/tts.ts`

**Interfaces:**
- Produces: `export async function generateSpeech(text: string, voiceName: string): Promise<string | null>`

- [ ] **Step 1: Implement `generateSpeech` function in `src/backend/tts.ts`**
Remove the stub implementation. Write `generateSpeech` which:
1. Reads `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` from `process.env`. If missing, log a warning and return `null`.
2. Constructs the SSML string using the provided `text` and `voiceName`.
3. Calls `fetch` against `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`.
4. Uses headers: `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`, `X-Microsoft-OutputFormat: riff-48khz-16bit-mono-pcm`, and `User-Agent: BabaTTS`.
5. On HTTP non-200, log `Error from Azure: ${res.status}` and return `null`.
6. On success, `const buffer = await res.arrayBuffer();`.
7. Converts buffer to base64 Data URI: `const base64 = Buffer.from(buffer).toString('base64'); return 'data:audio/wav;base64,' + base64;`.

- [ ] **Step 2: Commit**
```bash
git add src/backend/tts.ts
git commit -m "feat(backend): implement azure tts REST client"
```

### Task 3: Backend WebSocket Wiring

**Files:**
- Modify: `src/backend/ws.ts`

**Interfaces:**
- Consumes: `generateSpeech` from `tts.ts`

- [ ] **Step 1: Add message listener in `ws.ts`**
Inside `wss.on('connection', (ws) => { ... })`, add a `ws.on('message')` listener.
When a message arrives, parse it. If `type === 'TEST_AZURE_TTS'`, call `generateSpeech("Hi, this is a test from Azure.", "hi-IN-AnanyaNeural")`.

- [ ] **Step 2: Send the response back to the client**
If `generateSpeech` returns a string, send back `JSON.stringify({ type: 'play_audio', audioData: result })` to that specific `ws` client.

- [ ] **Step 3: Commit**
```bash
git add src/backend/ws.ts
git commit -m "feat(backend): add websocket listener for azure tts test"
```

### Task 4: Frontend Test Button & Playback

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: WebSocket server connection.

- [ ] **Step 1: Add Playback logic to `App.tsx` WebSocket listener**
In the `ws.onmessage` handler, add an `else if (data.type === 'play_audio' && data.audioData)` block. Inside, call `new Audio(data.audioData).play().catch(e => console.error("Audio play failed:", e));`.

- [ ] **Step 2: Add "Test Azure Voice" Button to `App.tsx`**
In the floating debug panel at the bottom right (where the Theme selector is), add a new button next to "Clear All". 
```tsx
<button
  onClick={() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));
    }
  }}
  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition-colors shadow-lg"
>
  Test Azure Voice
</button>
```

- [ ] **Step 3: Commit**
```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): add azure test button and playback"
```
