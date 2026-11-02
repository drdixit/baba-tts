import fs from 'fs';

let content = fs.readFileSync('src/backend/tts.ts', 'utf-8');

// Replace the top part with new queue logic
const newTop = `import type { ChatMessage } from '../shared/types.js';
import { broadcastPlayAudio, broadcastTTSState } from './ws.js';

let queue: ChatMessage[] = [];
let isProcessing = false;

export function enqueueMessageForTTS(message: ChatMessage) {
  queue.push(message);
  processQueue();
}

export function clearTTSQueue() {
  queue = [];
  isProcessing = false;
}

export function markAudioFinished() {
  isProcessing = false;
  processQueue();
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  
  const msg = queue.shift();
  if (msg) {
    console.log(\`[TTS] Processing message \${msg.messageId}: \${msg.text}\`);
    broadcastTTSState(msg.messageId, 'processing');
    
    // Default to a voice for now
    const voiceName = "hi-IN-AnanyaNeural";
    const textToSpeak = \`\${msg.authorName} says \${msg.text}\`;
    
    const audioData = await generateSpeech(textToSpeak, voiceName);
    
    if (audioData) {
      // Send to frontend to play. We stay isProcessing=true until AUDIO_FINISHED
      broadcastPlayAudio(msg.messageId, audioData);
    } else {
      // Azure failed, skip this message
      broadcastTTSState(msg.messageId, 'skipped');
      markAudioFinished(); // Instantly proceed
    }
  }
}
`;

// Extract the generateSpeech function
const generateSpeechRegex = /export async function generateSpeech([\s\S]*)/;
const match = content.match(generateSpeechRegex);
if (!match) throw new Error("Could not find generateSpeech in tts.ts");

fs.writeFileSync('src/backend/tts.ts', newTop + "\nexport async function generateSpeech" + match[1]);
