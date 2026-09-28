import 'dotenv/config';
import fs from 'fs';
import { generateSpeech } from './src/backend/tts.js';

async function run() {
  const data = await generateSpeech("TestUser says This is a test message", "hi-IN-AnanyaNeural");
  if (data) {
    const base64 = data.replace('data:audio/wav;base64,', '');
    fs.writeFileSync('test.wav', Buffer.from(base64, 'base64'));
    console.log("Wrote test.wav");
  } else {
    console.log("Failed to generate");
  }
}
run();
