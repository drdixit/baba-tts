import type { ChatMessage } from '../shared/types.js';
import { broadcastPlayAudio, broadcastTTSState } from './ws.js';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

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
    
    const result = await generateSpeech(textToSpeak, voiceName);
    
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
