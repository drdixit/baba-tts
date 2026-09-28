import type { ChatMessage } from '../shared/types.js';
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
    console.log(`[TTS] Processing message ${msg.messageId}: ${msg.text}`);
    broadcastTTSState(msg.messageId, 'processing');
    
    // Default to a voice for now
    const voices = [
      "hi-IN-AnanyaNeural",
      "en-IN-NeerjaNeural",
      "en-IN-PrabhatNeural",
      "hi-IN-MadhurNeural"
    ];
    const voiceName = voices[Math.floor(Math.random() * voices.length)];
    const textToSpeak = `${msg.authorName} says ${msg.text}`;
    
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

export async function generateSpeech(text: string, voiceName: string): Promise<string | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.warn('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    return null;
  }

  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const langMatch = voiceName.match(/^([a-zA-Z]+-[a-zA-Z]+)/);
  const lang = langMatch ? langMatch[1] : 'en-US';

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
    <voice name="${voiceName}">${escapedText}</voice>
  </speak>`;

  try {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
        'User-Agent': 'BabaTTS'
      },
      body: ssml
    });

    if (!res.ok) {
      console.error(`Error from Azure: ${res.status}`);
      return null;
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return 'data:audio/wav;base64,' + base64;
  } catch (error) {
    console.error('Failed to generate speech:', error);
    return null;
  }
}
