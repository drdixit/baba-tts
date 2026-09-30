import 'dotenv/config';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

const key = process.env.AZURE_SPEECH_KEY!;
const region = process.env.AZURE_SPEECH_REGION!;

const testMessages = [
  "babaonpc says आज का टॉपिक काफी दिलचस्प है",
  "babaonpc says Hello world this is a test message",
  "babaonpc says भाई पूरा प्रोसेस शुरुआत से अंत तक दिखाओ",
];

const voices = [
  "hi-IN-ArjunNeural",
  "hi-IN-MadhurNeural",
  "hi-IN-SwaraNeural",
  "hi-IN-AnanyaNeural",
];

async function testSynthesize(text: string, voice: string): Promise<void> {
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = voice;
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm;

  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

  const start = Date.now();
  console.log(`\n[START] Voice: ${voice}`);
  console.log(`[START] Text: "${text}"`);

  return new Promise((resolve) => {
    synthesizer.speakTextAsync(
      text,
      (result) => {
        const elapsed = Date.now() - start;
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          const sizeKB = Math.round(result.audioData.byteLength / 1024);
          console.log(`[DONE]  ✅ ${elapsed}ms | Audio size: ${sizeKB}KB`);
        } else {
          console.log(`[FAIL]  ❌ ${elapsed}ms | Error: ${result.errorDetails}`);
        }
        synthesizer.close();
        resolve();
      },
      (error) => {
        const elapsed = Date.now() - start;
        console.log(`[ERROR] ❌ ${elapsed}ms | ${error}`);
        synthesizer.close();
        resolve();
      }
    );
  });
}

async function main() {
  console.log('=== Azure TTS Latency Test ===');
  console.log(`Region: ${region}`);
  console.log(`Key: ${key.substring(0, 8)}...`);
  console.log('');

  for (let i = 0; i < testMessages.length; i++) {
    const voice = voices[i % voices.length];
    await testSynthesize(testMessages[i], voice);
  }

  console.log('\n=== Done ===');
}

main();
