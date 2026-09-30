import 'dotenv/config';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

console.log('Loading Azure SDK...');
const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION;
if (!key || !region) {
  console.log('Missing env variables');
  process.exit(1);
}

try {
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = "hi-IN-AnanyaNeural";
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
  console.log('Synthesizer created successfully!');
  
  synthesizer.speakTextAsync(
    "Test message",
    (result) => {
      console.log('Result reason:', result.reason);
      synthesizer.close();
    },
    (error) => {
      console.error('Error:', error);
      synthesizer.close();
    }
  );
} catch (err) {
  console.error('Crash during creation:', err);
}
