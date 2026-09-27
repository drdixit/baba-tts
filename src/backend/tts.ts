import type { ChatMessage } from '../shared/types.js';

const queue: ChatMessage[] = [];
let isProcessing = false;

export function enqueueMessageForTTS(message: ChatMessage) {
  queue.push(message);
  processQueue();
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  
  const msg = queue.shift();
  if (msg) {
    console.log(`[TTS Stub] Processing message ${msg.messageId}: ${msg.text}`);
    // Future TTS implementation will go here
  }
  
  isProcessing = false;
  
  if (queue.length > 0) {
    setTimeout(processQueue, 1000);
  }
}

export async function generateSpeech(text: string, voiceName: string): Promise<string | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.warn('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    return null;
  }

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
    <voice name="${voiceName}">${text}</voice>
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
