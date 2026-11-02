# Feature Spec: Word-Level TTS Sync and Guardrails

## 1. Goal
Provide flawless, exact word-level synchronization for TTS animations (like Subtitle Sweep and Karaoke) by leveraging Azure's Word Boundary events, while introducing robust error guardrails to cleanly handle API failures.

## 2. Architecture & Backend (Azure SDK)
To receive precise millisecond-level word boundaries, we must upgrade the backend from a simple REST HTTP `fetch` to the official Microsoft Azure Speech SDK (`microsoft-cognitiveservices-speech-sdk`).

- **Implementation Details:**
  - Initialize `SpeechConfig` using `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`.
  - Create a `SpeechSynthesizer`.
  - Bind to the `synthesizer.wordBoundary` event to collect an array of objects containing `text`, `audioOffset` (in ticks/ms), and `duration`.
  - Once synthesis finishes, send the audio buffer and the complete `wordBoundaries` array to the frontend in a single WebSocket `play_audio` packet.

- **Guardrails (Error Handling):**
  - All SDK calls will be wrapped in `try/catch` and timeout blocks.
  - If Azure fails (e.g., rate limits, invalid key, network timeout), the backend will catch the error, log it, and emit a `{ type: 'tts_error', messageId }` packet to the frontend instead of crashing the queue.

## 3. Frontend Store & Guardrails
The frontend will be updated to gracefully handle Azure errors.

- **Error Recovery:**
  - When the frontend receives `tts_error` for a message, the Zustand store will update the message's status to `error`.
  - The UI will be updated so that messages with an `error` status are immediately hidden or removed from the display, ensuring a broken TTS generation doesn't stay stuck on screen permanently.

## 4. Frontend Themes & Animation Sync
The themes that rely on audio synchronization (Subtitle Karaoke, Subtitle Sweep, Subtitle Words) will be completely rewritten to be deterministic rather than time-guesstimated.

- **Implementation Details:**
  - The `play_audio` WebSocket packet will now include `wordBoundaries`.
  - The `<audio>` element's `ontimeupdate` event (or a fast `requestAnimationFrame` loop) will constantly read `audio.currentTime`.
  - The React components will split the message string into individual `<span>` word elements.
  - As `audio.currentTime` advances past a word's timestamp in the `wordBoundaries` array, the corresponding `<span>` will become highlighted. This guarantees 100% precise synchronization, regardless of the speaking speed or random voice chosen.
