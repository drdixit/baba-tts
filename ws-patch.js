import fs from 'fs';

let content = fs.readFileSync('src/backend/ws.ts', 'utf-8');

// Replace the generic TEST_AZURE_TTS handler with real handlers
content = content.replace(
`        if (message.type === 'TEST_AZURE_TTS') {
          const result = await generateSpeech("Hi, this is a test from Azure.", "hi-IN-AnanyaNeural");
          if (typeof result === 'string' && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'play_audio', audioData: result }));
          }
        }`,
`        if (message.type === 'SIMULATE_MESSAGE') {
          // It's a test message from frontend. Treat it like a real one.
          const msg = message.payload;
          broadcastMessages([msg]);
          const { enqueueMessageForTTS } = await import('./tts.js');
          enqueueMessageForTTS(msg);
        }
        if (message.type === 'AUDIO_FINISHED') {
          const { markAudioFinished } = await import('./tts.js');
          markAudioFinished();
        }
        if (message.type === 'CLEAR_TTS_QUEUE') {
          const { clearTTSQueue } = await import('./tts.js');
          clearTTSQueue();
        }`
);

// Add broadcastPlayAudio and broadcastTTSState
content += `
export function broadcastPlayAudio(messageId: string, audioData: string) {
  if (!wss) return;
  const data = JSON.stringify({ type: 'play_audio', messageId, audioData });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

export function broadcastTTSState(messageId: string, state: 'processing' | 'skipped') {
  if (!wss) return;
  const data = JSON.stringify({ type: 'tts_state', messageId, state });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}
`;

fs.writeFileSync('src/backend/ws.ts', content);
