# Word-Level TTS Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement precise word-level synchronization for TTS animations by migrating the backend to the Azure Speech SDK and sending word boundaries to the frontend.

**Architecture:** The backend will use `microsoft-cognitiveservices-speech-sdk` to generate audio and collect `wordBoundary` events. Both the audio buffer (as base64) and the array of word boundaries will be sent to the frontend via WebSocket. The frontend themes will use `requestAnimationFrame` or `<audio>` time updates to dynamically highlight words exactly as they are spoken.

**Tech Stack:** Node.js, `microsoft-cognitiveservices-speech-sdk`, React, Zustand

**Spec:** `docs/superpowers/specs/2026-09-28-word-level-tts-sync.md`

## Global Constraints

- Do not use Bun-specific APIs. Use normal Node.js + npm tooling.
- Keep Google and Azure client secrets on the backend only.
- Development HTTP port must be 7060.
- Treat untrusted user chat input securely.

## Review Focus

- **Azure Rate Limiting/Errors:** If Azure SDK throws an error or fails, the backend must catch it and send `tts_error` instead of crashing the queue.
- **Empty Messages:** A message with no text (only emojis) might not generate word boundaries. Ensure the frontend doesn't crash if `wordBoundaries` is empty.
- **Multiple Concurrent Audio:** Ensure the frontend correctly pauses the old audio element before starting a new one when skipping.
- **HTML Special Characters:** If a username or message contains `<`, `>`, or `&`, the subtitle themes must escape them before splitting them into spans so they don't break React rendering.
- **Word Boundary Offset Mismatch:** Azure word boundary ticks are in 100-nanosecond units (or sometimes milliseconds depending on SDK config). Ensure the frontend receives them converted to seconds for easy comparison with `audio.currentTime`.

---

### Task 1: Backend SDK Integration

**Files:**
- Modify: `package.json`
- Modify: `src/backend/tts.ts`

**Interfaces:**
- Produces: `generateSpeech(text: string, voiceName: string)` now returns `{ audioData: string, wordBoundaries: { text: string, audioOffset: number, duration: number }[] } | null`

- [ ] **Step 1: Install the SDK**
Run: `npm install microsoft-cognitiveservices-speech-sdk`

- [ ] **Step 2: Rewrite `generateSpeech` in `tts.ts`**
Import `microsoft-cognitiveservices-speech-sdk`.
Initialize `SpeechConfig` with `process.env.AZURE_SPEECH_KEY` and region.
Create a `SpeechSynthesizer`.
Listen to `synthesizer.wordBoundary` and push events to a local array. Convert `audioOffset` from ticks to seconds (`offset / 10000000`).
Use `synthesizer.speakTextAsync`.
On success, convert `result.audioData` to a base64 Data URI and return `{ audioData, wordBoundaries }`.
Wrap the SDK call in a `try/catch` and return `null` on failure.

- [ ] **Step 3: Update `processQueue` in `tts.ts`**
Change `processQueue` to expect the object return from `generateSpeech`.
If `null`, call `broadcastTTSState(msg.messageId, 'error')` instead of 'skipped'.
If success, pass both `audioData` and `wordBoundaries` to `broadcastPlayAudio`.

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json src/backend/tts.ts
git commit -m "feat: migrate TTS to Azure Speech SDK for word boundaries"
```

### Task 2: WebSocket Protocol Update

**Files:**
- Modify: `src/backend/ws.ts`
- Modify: `frontend/src/App.tsx` (WebSocket listener)

**Interfaces:**
- Consumes: `wordBoundaries` array from `tts.ts`

- [ ] **Step 1: Update `ws.ts` payload**
Modify `broadcastPlayAudio` signature to accept `wordBoundaries`.
Include it in the JSON stringified payload sent to clients: `{ type: 'play_audio', messageId, audioData, wordBoundaries }`.

- [ ] **Step 2: Update `App.tsx` listener and Store**
Update the `ws.onmessage` handler for `play_audio` to also receive `data.wordBoundaries`.
We need a way to pass these boundaries to the UI.
Modify the Zustand store (in `store.ts` or directly in `App.tsx` if it's there) so `messages` can store an optional `wordBoundaries` array.
Wait, `addMessages` just pushes messages. We can just add `wordBoundaries` as an optional property on the `Message` type.
Update the store so when `play_audio` arrives, we update the message to include `wordBoundaries: data.wordBoundaries`.

- [ ] **Step 3: Handle `tts_error` in `App.tsx`**
Add an `else if (data.type === 'tts_error')` block in the WebSocket listener that calls `updateMessageStatus(data.messageId, 'error')`.

- [ ] **Step 4: Commit**
```bash
git add src/backend/ws.ts frontend/src/App.tsx frontend/src/store.ts
git commit -m "feat: pipe word boundaries and errors over WebSocket"
```

### Task 3: Frontend Theme Sync

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: The `wordBoundaries` array on the active message object.

- [ ] **Step 1: Update Theme Rendering Logic**
For messages with themes `subtitle-karaoke`, `subtitle-sweep`, and `subtitle-words`:
Instead of raw CSS animation on the whole text string, split the `message.text` string into words.
Use a `requestAnimationFrame` loop or `<audio onTimeUpdate>` attached to a `ref` to track the global `audio.currentTime`.
Alternatively, in React, just listen to the `<audio>` element that plays the sound. Wait, the `<audio>` element is currently created programmatically in `ws.onmessage`.
Change `App.tsx` to maintain the playing `audio.currentTime` in a React state or Ref. `audio.ontimeupdate = () => setCurrentAudioTime(audio.currentTime)`.

- [ ] **Step 2: Sync Word Highlighting**
In the component rendering the message:
Iterate over the split words (or iterate over the `wordBoundaries` array).
If `currentAudioTime >= word.audioOffset`, apply a "highlighted" CSS class to that specific `<span>`.
Remove the old hardcoded CSS animation durations from those themes.

- [ ] **Step 3: Guardrail for Hidden Errors**
In the main message mapping `messages.map(...)`:
Filter out or apply a `hidden` class to any message where `status === 'error'`, ensuring failed TTS blocks vanish instead of clogging the screen.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/App.tsx frontend/index.css
git commit -m "feat: animate subtitle themes using precise word boundaries"
```
