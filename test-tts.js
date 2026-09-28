import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:7060/ws');
ws.on('open', () => {
  console.log("Connected to WS");
  ws.send(JSON.stringify({ 
    type: 'SIMULATE_MESSAGE', 
    payload: {
      messageId: 'test-123',
      authorName: 'TestUser',
      text: 'This is a test message'
    } 
  }));
});
ws.on('message', (data) => {
  const d = JSON.parse(data.toString());
  if (d.type === 'play_audio') {
    console.log('Received audio: ' + d.audioData.substring(0, 50));
    // simulate frontend audio end
    setTimeout(() => {
      console.log("Sending AUDIO_FINISHED");
      ws.send(JSON.stringify({ type: 'AUDIO_FINISHED' }));
    }, 100);
  } else {
    console.log('Received:', data.toString().substring(0, 100));
  }
});
