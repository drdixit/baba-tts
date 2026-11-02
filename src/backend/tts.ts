import type { ChatMessage } from '../shared/types.js';
import { broadcastPlayAudio, broadcastTTSState, broadcastKillAudio, broadcastMessages } from './ws.js';
import { getDeterministicColor } from '../shared/colors.js';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

let queue: ChatMessage[] = [];
let isProcessing = false;
let currentProcessingMessage: ChatMessage | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

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
  clearWatchdog();
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
  clearWatchdog();
  if (currentProcessingMessage) {
    broadcastTTSState(currentProcessingMessage.messageId, 'skipped');
    broadcastKillAudio();
    currentProcessingMessage = null;
    isProcessing = false;
    processQueue(); // immediately process next in queue if any
  }
}

export function enqueuePriorityMessage(text: string): ChatMessage {
  const themes = ['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean'];
  const randomTheme = themes[Math.floor(Math.random() * themes.length)];

  const msg: ChatMessage = {
    messageId: 'baba-' + Date.now(),
    authorName: 'BABA',
    authorId: 'baba-streamer',
    authorProfileImageUrl: '/baba-800x800.jpg',
    authorColor: getDeterministicColor('BABA'),
    text,
    status: 'queued',
    theme: randomTheme as any,
  };
  return enqueuePriorityCustomMessage(msg);
}

export function enqueuePriorityCustomMessage(msg: ChatMessage): ChatMessage {
  queue.unshift(msg); // insert at front — plays next after current
  broadcastMessages([msg]);
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
  
  clearWatchdog();

  if (currentProcessingMessage && messageId) {
    broadcastTTSState(currentProcessingMessage.messageId, 'done');
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
      "hi-IN-AnanyaNeural",
      "hi-IN-MadhurNeural",
      "hi-IN-SwaraNeural",
    ];
    const voiceName = voices[Math.floor(Math.random() * voices.length)];
    const textToSpeak = `${msg.authorName} says ${msg.text}`;
    
    const reqStartTime = Date.now();
    console.log(`[TTS] Step 1: Request sent to Azure for message ${msg.messageId}...`);
    const result = await generateSpeech(textToSpeak, voiceName);
    
    if (result && result.timings) {
      console.log(`[TTS] Metrics for message ${msg.messageId} | Size: ${result.timings.sizeKb} KB | Processing: ${result.timings.processingMs}ms | Download: ${result.timings.downloadMs}ms | Total: ${result.timings.totalMs}ms`);
    } else {
      console.log(`[TTS] Failed to generate message ${msg.messageId}`);
    }
    
    // SAFEGUARD: Check if this message was cancelled (banned/cleared) while Azure was generating it
    if (currentProcessingMessage?.messageId !== msg.messageId) {
      console.log(`[TTS] Audio generation finished, but message ${msg.messageId} was cancelled during generation. Discarding.`);
      return;
    }
    
    if (result) {
      // Send to frontend to play. We stay isProcessing=true until AUDIO_FINISHED
      console.log(`[TTS] Step 4: Sending bundled Audio + Mapping to frontend UI for message ${msg.messageId}... (+${Date.now() - reqStartTime}ms total)`);
      broadcastPlayAudio(msg.messageId, result.audioData, result.wordBoundaries);

      // Watchdog timeout to prevent TTS queue from locking if client drops or fails to send AUDIO_FINISHED
      clearWatchdog();
      const lastBoundary = result.wordBoundaries?.[result.wordBoundaries.length - 1];
      const durationSec = lastBoundary ? (lastBoundary.audioOffset + lastBoundary.duration) : 7;
      const timeoutMs = Math.max(5000, Math.min(25000, Math.round((durationSec + 4) * 1000)));

      watchdogTimer = setTimeout(() => {
        console.warn(`[TTS] Watchdog timeout (${timeoutMs}ms) for message ${msg.messageId}. Auto-finishing.`);
        markAudioFinished(msg.messageId);
      }, timeoutMs);
    } else {
      // Azure failed, skip this message
      broadcastTTSState(msg.messageId, 'error');
      markAudioFinished(); // Instantly proceed
    }
  }
}

export async function generateSpeech(text: string, voiceName: string): Promise<{ audioData: string, wordBoundaries: { text: string, audioOffset: number, duration: number, textOffset: number }[], timings: { sizeKb: string, processingMs: number, downloadMs: number, totalMs: number } } | null> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;

  if (!key || !region) {
    console.warn('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
    return null;
  }

  try {
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechSynthesisVoiceName = voiceName;
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio48Khz96KBitRateMonoMp3;

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    const wordBoundaries: { text: string, audioOffset: number, duration: number, textOffset: number }[] = [];
    synthesizer.wordBoundary = (s, e) => {
      wordBoundaries.push({
        text: e.text,
        audioOffset: e.audioOffset / 10000000,
        duration: e.duration / 10000000,
        textOffset: e.textOffset
      });
    };
    
    const startTime = Date.now();
    let firstByteTime = 0;
    synthesizer.synthesisStarted = () => {
      firstByteTime = Date.now();
      console.log(`[TTS] Step 2: Receiving first byte and word mappings from Azure... (+${firstByteTime - startTime}ms)`);
    };

    return await new Promise((resolve) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          const endTime = Date.now();
          const firstByte = firstByteTime || endTime;
          const processingMs = firstByte - startTime;
          const downloadMs = endTime - firstByte;
          const totalMs = endTime - startTime;

          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            const buffer = Buffer.from(result.audioData);
            const sizeKb = (buffer.length / 1024).toFixed(2);
            console.log(`[TTS] Step 3: Audio download completed! Size: ${sizeKb} KB (+${downloadMs}ms)`);
            const base64 = buffer.toString('base64');
            const audioData = 'data:audio/mpeg;base64,' + base64;
            resolve({ audioData, wordBoundaries, timings: { sizeKb, processingMs, downloadMs, totalMs } });
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
