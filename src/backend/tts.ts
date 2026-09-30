import type { ChatMessage } from '../shared/types.js';
import { broadcastPlayAudio, broadcastTTSState, broadcastKillAudio } from './ws.js';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

let queue: ChatMessage[] = [];
let isProcessing = false;
let currentProcessingMessage: ChatMessage | null = null;

const RECENT_MESSAGES_CACHE = new Map<string, number>();

export function enqueueMessageForTTS(message: ChatMessage) {
  const now = Date.now();
  
  // Cleanup old cache entries (older than 30 seconds)
  for (const [text, timestamp] of RECENT_MESSAGES_CACHE.entries()) {
    if (now - timestamp > 30000) {
      RECENT_MESSAGES_CACHE.delete(text);
    }
  }

  const textLower = message.text.toLowerCase().trim();
  
  if (RECENT_MESSAGES_CACHE.has(textLower)) {
    console.log(`[TTS] Skipping duplicate message: ${message.text}`);
    // Broadcast skipped state immediately
    broadcastTTSState(message.messageId, 'skipped');
    return;
  }
  
  // New message, add to cache
  RECENT_MESSAGES_CACHE.set(textLower, now);

  queue.push(message);
  processQueue();
}

export function getCurrentProcessingMessage() {
  return currentProcessingMessage;
}

export function clearTTSQueue() {
  for (const msg of queue) {
    broadcastTTSState(msg.messageId, 'skipped');
  }
  queue = [];
  if (currentProcessingMessage) {
    broadcastTTSState(currentProcessingMessage.messageId, 'skipped');
    broadcastKillAudio();
    currentProcessingMessage = null;
  }
  isProcessing = false;
}

export function skipCurrentMessage() {
  if (currentProcessingMessage) {
    broadcastTTSState(currentProcessingMessage.messageId, 'skipped');
    broadcastKillAudio();
    currentProcessingMessage = null;
    isProcessing = false;
    processQueue(); // immediately process next in queue if any
  }
}

export function enqueuePriorityMessage(text: string): ChatMessage {
  const msg: ChatMessage = {
    messageId: 'baba-' + Date.now(),
    authorName: 'BABA',
    authorId: 'baba-streamer',
    text,
    status: 'queued',
    theme: 'pro-clean',
  };
  queue.unshift(msg); // insert at front — plays next after current
  processQueue();
  return msg;
}

export function removeUserFromQueue(authorId: string) {
  queue = queue.filter(msg => {
    if (msg.authorId === authorId) {
      broadcastTTSState(msg.messageId, 'skipped');
      return false;
    }
    return true;
  });
  if (currentProcessingMessage && currentProcessingMessage.authorId === authorId) {
    broadcastTTSState(currentProcessingMessage.messageId, 'skipped');
    broadcastKillAudio();
    currentProcessingMessage = null;
    isProcessing = false;
    processQueue(); // immediately process next in queue if any
  }
}

export function markAudioFinished(messageId?: string) {
  if (messageId && currentProcessingMessage?.messageId !== messageId) {
    return; // Duplicate AUDIO_FINISHED from another client (OBS vs Chrome)
  }
  currentProcessingMessage = null;
  isProcessing = false;
  processQueue();
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  
  const msg = queue.shift();
  if (msg) {
    currentProcessingMessage = msg;
    console.log(`[TTS] Processing message ${msg.messageId}: ${msg.text}`);
    broadcastTTSState(msg.messageId, 'processing');
    
    // Use strictly hi-IN voices to properly support Devanagari text segment boundaries
    const voices = [
      "hi-IN-ArjunNeural",
      "hi-IN-MadhurNeural",
      "hi-IN-SwaraNeural",
      "hi-IN-AnanyaNeural",
      "hi-IN-AaravNeural",
      "hi-IN-AartiNeural",
      "hi-IN-KunalNeural"
    ];
    const voiceName = voices[Math.floor(Math.random() * voices.length)];
    const textToSpeak = `${msg.authorName} says ${msg.text}`;
    
    const azureStart = Date.now();
    const result = await generateSpeech(textToSpeak, voiceName);
    const azureLatency = Date.now() - azureStart;
    console.log(`[TTS] Azure latency: ${azureLatency}ms for message ${msg.messageId}`);
    
    // SAFEGUARD: Check if this message was cancelled (banned/cleared) while Azure was generating it
    if (currentProcessingMessage?.messageId !== msg.messageId) {
      console.log(`[TTS] Audio generation finished, but message ${msg.messageId} was cancelled during generation. Discarding.`);
      return;
    }
    
    if (result) {
      // Send to frontend to play. We stay isProcessing=true until AUDIO_FINISHED
      broadcastPlayAudio(msg.messageId, result.audioData, result.wordBoundaries);
    } else {
      // Azure failed, skip this message
      broadcastTTSState(msg.messageId, 'error');
      markAudioFinished(); // Instantly proceed
    }
  }
}

export async function generateSpeech(text: string, voiceName: string): Promise<{ audioData: string, wordBoundaries: { text: string, audioOffset: number, duration: number }[] } | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.warn('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    return null;
  }

  try {
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechSynthesisVoiceName = voiceName;
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm;

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    const wordBoundaries: { text: string, audioOffset: number, duration: number }[] = [];
    synthesizer.wordBoundary = (s, e) => {
      wordBoundaries.push({
        text: e.text,
        audioOffset: e.audioOffset / 10000000,
        duration: e.duration / 10000000
      });
    };

    return await new Promise((resolve) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const buffer = Buffer.from(result.audioData);
            const base64 = buffer.toString('base64');
            const audioData = 'data:audio/wav;base64,' + base64;
            resolve({ audioData, wordBoundaries });
          } else {
            console.error(`Speech synthesis canceled or failed: ${result.errorDetails}`);
            resolve(null);
          }
          synthesizer.close();
        },
        (error) => {
          console.error(`Failed to generate speech:`, error);
          synthesizer.close();
          resolve(null);
        }
      );
    });
  } catch (error) {
    console.error('Failed to generate speech:', error);
    return null;
  }
}
