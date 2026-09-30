import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:7060/ws');
ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({
    type: 'SIMULATE_MESSAGE',
    payload: {
      messageId: 'test-' + Date.now(),
      authorName: 'TestUser',
      authorId: 'sim-user-1',
      text: 'Hello world',
      status: 'queued',
      theme: 'pro-clean'
    }
  }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type) {
    console.log('Received:', msg.type, msg.messageId || '', msg.state || '');
  } else if (Array.isArray(msg)) {
    console.log('Received array of messages:', msg.map(m => m.status));
  }
});
ws.on('error', console.error);
