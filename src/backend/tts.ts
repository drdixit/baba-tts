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
