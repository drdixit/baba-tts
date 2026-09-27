# Azure TTS Integration Design

## Overview
This document specifies the design for integrating Microsoft Azure Text-to-Speech (TTS) into the BABA TTS backend. The goal is to securely convert chat messages into high-fidelity speech using Azure's Neural voices and stream the resulting audio to the frontend.

## Goals & Constraints
- **Security:** Azure API keys must never be exposed to the browser. They must remain strictly on the Node.js backend.
- **Audio Quality:** The stream's audio pipeline is 48 kHz. Therefore, the TTS engine must request the high-fidelity `riff-48khz-16bit-mono-pcm` format to match OBS standards.
- **Voices:** The system will utilize 4 specific Hindi neural voices: `hi-IN-AnanyaNeural`, `hi-IN-SwaraNeural`, `hi-IN-MadhurNeural`, and `hi-IN-ArjunNeural`.
- **First Milestone:** The immediate priority is proving the Azure integration works via a manual "Test Azure Voice" button before hooking it up to the automated YouTube chat queue.

## Architecture

### 1. Configuration & Security
- **File:** `.env` (backend)
- **Variables:** `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION`
- The backend will load these securely via standard Node.js `process.env`.

### 2. Azure TTS Engine
- **File:** `src/backend/tts.ts`
- **Method:** `generateSpeech(text: string, voiceName: string): Promise<string>`
- **Logic:**
  - Constructs an SSML (Speech Synthesis Markup Language) XML payload specifying the text and the `voiceName`.
  - Makes a standard `POST` HTTP request to `https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1`.
  - **Headers:**
    - `Ocp-Apim-Subscription-Key`: [Loaded from .env]
    - `Content-Type`: `application/ssml+xml`
    - `X-Microsoft-OutputFormat`: `riff-48khz-16bit-mono-pcm`
    - `User-Agent`: `BabaTTS`
  - Retrieves the binary `ArrayBuffer` from the response.
  - Converts the buffer into a Base64 Data URI (`data:audio/wav;base64,...`) and returns it, making it instantly playable in the browser without CORS or blob management overhead.

### 3. Frontend Testing Interface
- **File:** `frontend/src/App.tsx` & `src/shared/types.ts`
- **Logic:**
  - Add a "Test Azure Voice" button to the frontend control panel.
  - Clicking this button emits a specific WebSocket message (e.g., `{ type: 'TEST_AZURE_TTS' }`).
  - The backend receives this, triggers `generateSpeech` with a hardcoded test sentence, and emits a `{ type: 'PLAY_AUDIO', audioData: 'base64...' }` message back.
  - The frontend receives the audio data and plays it immediately via `new Audio(payload.audioData).play()`.

## Error Handling
- If the Azure API returns a non-200 status code (e.g. `401 Unauthorized` or `429 Too Many Requests`), the backend will catch the error, log it to the console for debugging, and prevent crashing.
- The frontend will gracefully ignore failed generations (no audio will play).
