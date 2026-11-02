import 'dotenv/config';
import { generateSpeech } from './src/backend/tts.js';

async function test() {
  console.log('Testing generateSpeech...');
  // Ensure dummy variables so it doesn't fail immediately if not set in env, though we need actual keys for a real test
  // We'll let it use process.env
  const result = await generateSpeech('Hello, how are you today?', 'en-US-JennyNeural');
  if (result) {
    console.log('Success!');
    console.log(`Audio data length: ${result.audioData.length}`);
    console.log('Word boundaries:', result.wordBoundaries);
  } else {
    console.log('Failed to generate speech.');
  }
}

test();
