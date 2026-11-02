import fs from 'fs';

let content = fs.readFileSync('frontend/src/App.tsx', 'utf-8');

// 1. We need a global or ref to hold the current audio so we can stop it.
// Since it's inside useEffect, we can use a module-level variable for simplicity, or ref.
// Let's add a ref for audio
content = content.replace(
  "const wsRef = useRef<WebSocket | null>(null);",
  "const wsRef = useRef<WebSocket | null>(null);\n  const audioRef = useRef<HTMLAudioElement | null>(null);"
);

// 2. Modify ws.onmessage
const onmessageReplacement = `    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_error') {
          alert('YouTube authentication error. Redirecting to login...');
          window.location.href = '/auth/google';
        } else if (data.type === 'auth_status') {
          setConnected(data.connected);
        } else if (data.type === 'tts_state') {
          useStore.getState().updateMessageStatus(data.messageId, data.state);
        } else if (data.type === 'play_audio' && data.audioData) {
          useStore.getState().updateMessageStatus(data.messageId, 'speaking');
          
          if (audioRef.current) {
            audioRef.current.pause();
          }
          
          const audio = new Audio(data.audioData);
          audioRef.current = audio;
          
          audio.onended = () => {
            useStore.getState().updateMessageStatus(data.messageId, 'skipped'); // Or 'read' if you had it
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED' }));
            }
          };
          
          audio.onerror = (e) => {
            console.error("Audio play failed:", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED' }));
            }
          };
          
          audio.play().catch(e => {
            console.error("Audio play failed (Promise rejected):", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED' }));
            }
          });
        } else if (data.type === 'delete' && data.messageId) {
          useStore.getState().removeMessage(data.messageId);
        } else if (Array.isArray(data)) {
          addMessages(data);
        } else {
          addMessages([data]);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };`;

content = content.replace(/ws\.onmessage = \(event\) => \{[\s\S]*?\} catch \(err\) \{\n\s*console\.error\('Failed to parse WebSocket message:', err\);\n\s*\}\n\s*\};/, onmessageReplacement);

// 3. Update simulateGoodMessage to send SIMULATE_MESSAGE instead of adding locally
// And remove `[THEME]` prefixes.
const simulateGoodMessageReplacement = `const simulateGoodMessage = (theme: 'default' | 'waveform' | 'neon' | 'typewriter' | 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'default') => {
    const id = \`test-\${Date.now()}\`;
    
    // Generate 30 character random username
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomUser = '';
    for (let i = 0; i < 15; i++) randomUser += chars.charAt(Math.floor(Math.random() * chars.length));

    // Generate random ~100 character message
    const words = ['testing', 'animation', 'spotlight', 'zone', 'layout', 'obs', 'stream', 'chat', 'message', 'limits', 'wow', 'cool', 'awesome'];
    let randomText = '';
    while (randomText.length < 100) {
      randomText += words[Math.floor(Math.random() * words.length)] + ' ';
    }
    randomText = randomText.substring(0, 100).trim();

    // Generate a random vibrant hex color for testing
    const hue = Math.floor(Math.random() * 360);
    const authorColor = \`hsl(\${hue}, 80%, 60%)\`;

    const msg = {
      messageId: id,
      authorName: randomUser,
      authorProfileImageUrl: \`https://api.dicebear.com/7.x/avataaars/svg?seed=\${randomUser}\`,
      authorColor: authorColor,
      text: randomText, // Removed the [SUBTITLE-SWEEP] prefix!
      timestamp: new Date().toISOString(),
      status: 'idle'
    };
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
    }
  };`;

content = content.replace(/const simulateGoodMessage = \([\s\S]*?addMessages\(\[\{[\s\S]*?\}\]\);\n\s*\};/, simulateGoodMessageReplacement);

// 4. Update the "Test Azure Voice" button to become "Clear TTS Queue"
content = content.replace(
  `<button onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));
              }
            }} className="px-3 py-1 bg-amber-600 hover:bg-amber-500 rounded text-white font-bold transition-colors">Test Azure Voice</button>`,
  `<button onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'CLEAR_TTS_QUEUE' }));
              }
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
              }
            }} className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-white font-bold transition-colors">Clear TTS Queue</button>`
);

fs.writeFileSync('frontend/src/App.tsx', content);
