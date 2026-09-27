import { useEffect, useRef } from 'react';
import ChatMessage from './components/ChatMessage';
import { useStore } from './store';

function App() {
  const { messages, isConnected, addMessages, setConnected, updateMessageStatus } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Determine the WebSocket URL based on the current origin
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'auth_error') {
          alert('YouTube authentication error. Redirecting to login...');
          window.location.href = '/auth/google';
        } else if (data.type === 'auth_status') {
          setConnected(data.connected);
        } else if (data.type === 'play_audio' && data.audioData) {
          new Audio(data.audioData).play().catch(e => console.error("Audio play failed:", e));
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
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [addMessages, setConnected]);

  const handleConnectClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isConnected) {
      const confirm = window.confirm("You are already connected to YouTube. Do you want to re-authenticate?");
      if (!confirm) {
        e.preventDefault();
      }
    }
  };

  const simulateGoodMessage = (theme: 'default' | 'waveform' | 'neon' | 'typewriter' | 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'default') => {
    const id = `test-${Date.now()}`;
    
    // Generate 30 character random username
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomUser = '';
    for (let i = 0; i < 15; i++) randomUser += chars.charAt(Math.floor(Math.random() * chars.length));

    // Generate random ~200 character message
    const words = ['testing', 'animation', 'spotlight', 'zone', 'layout', 'obs', 'stream', 'chat', 'message', 'limits', 'wow', 'cool', 'awesome'];
    let randomText = '';
    while (randomText.length < 100) {
      randomText += words[Math.floor(Math.random() * words.length)] + ' ';
    }
    randomText = randomText.substring(0, 100).trim();

    // Generate a random vibrant hex color for testing
    const hue = Math.floor(Math.random() * 360);
    const authorColor = `hsl(${hue}, 80%, 60%)`;

    addMessages([{
      messageId: id,
      authorName: randomUser,
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomUser}`,
      authorColor: authorColor,
      text: `[${theme.toUpperCase()}] ` + randomText,
      status: 'default',
      theme
    }]);

    const now = Date.now();
    // Ensure at least a 2-second gap from now so it stays in "queued" for a moment
    const startTime = Math.max(now + 2000, (window as any).__mockQueueEnd || (now + 2000));
    (window as any).__mockQueueEnd = startTime + 8000; // 8 seconds to process and speak

    const delay = startTime - now;

    setTimeout(() => updateMessageStatus(id, 'queued'), 500);
    setTimeout(() => updateMessageStatus(id, 'processing'), delay); // Starts processing at startTime
    setTimeout(() => updateMessageStatus(id, 'speaking'), delay + 3000); // Speaks 3s later
    setTimeout(() => updateMessageStatus(id, 'done'), delay + 8000); // Done 5s after speaking
  };

  const simulateSpamMessage = () => {
    const id = `spam-${Date.now()}`;
    
    // Generate random 200 char spam
    let spamText = '';
    while (spamText.length < 200) {
      spamText += 'BUY FOLLOWERS SCAM.COM 😡🤬 ';
    }
    spamText = spamText.substring(0, 200).trim();

    addMessages([{
      messageId: id,
      authorName: 'SpamBot9000_ExtraLongName12345',
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=spambot`,
      text: spamText,
      status: 'default'
    }]);

    setTimeout(() => updateMessageStatus(id, 'skipped'), 800);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-transparent relative">
      {/* Floating UI controls (absolute top right) */}
      <div className="absolute top-2 right-2 z-50 flex flex-wrap items-center justify-end gap-2">
        {/* Temporary State Testing Buttons */}
        <div className="flex flex-col gap-2 bg-gray-800/90 backdrop-blur p-2 rounded-lg border border-gray-700 shadow-xl">
          <div className="flex gap-2">
            <button onClick={() => simulateGoodMessage('default')} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-white font-bold transition-colors">Classic</button>
            <button onClick={() => simulateGoodMessage('waveform')} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold transition-colors">Waveform</button>
            <button onClick={() => simulateGoodMessage('neon')} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-white font-bold transition-colors">Neon</button>
            <button onClick={() => simulateGoodMessage('typewriter')} className="px-3 py-1 bg-pink-600 hover:bg-pink-500 rounded text-white font-bold transition-colors">Typewriter</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => simulateGoodMessage('subtitle-sweep')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-bold transition-colors">Subtitle Sweep</button>
            <button onClick={() => simulateGoodMessage('subtitle-karaoke')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-bold transition-colors">Subtitle Karaoke</button>
            <button onClick={() => simulateGoodMessage('subtitle-words')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-bold transition-colors">Subtitle Words</button>
            <button onClick={() => simulateGoodMessage('pro-clean')} className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-white font-bold transition-colors border border-cyan-400">Pro Clean</button>
          </div>
          <div className="flex gap-2">
            <button onClick={simulateSpamMessage} className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded text-white font-bold transition-colors w-full">Simulate Spam</button>
            <button
              onClick={() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition-colors shadow-lg"
            >
              Test Azure Voice
            </button>
          </div>
        </div>

        <a 
          href="/auth/google"
          onClick={handleConnectClick}
          className={`px-8 py-3 rounded-lg text-lg font-bold tracking-wide transition-colors backdrop-blur border-2 shadow-xl ${
            isConnected 
              ? 'bg-green-600/90 border-green-500 hover:bg-green-500 text-white' 
              : 'bg-blue-600/90 border-blue-500 hover:bg-blue-500 text-white'
          }`}
        >
          {isConnected ? 'YouTube Connected' : 'Connect YouTube'}
        </a>
      </div>
      
      {/* ZONE E: SCROLLING CHAT BOX (Strictly bottom 810px, between 49px and 1389px) */}
      <main className="absolute bottom-0 left-[49px] right-[51px] h-[810px] overflow-hidden flex flex-col justify-end py-4 bg-transparent">
        <div className="flex flex-col justify-end min-h-full">
          {messages.map((msg) => (
            <ChatMessage key={msg.messageId} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>
    </div>
  );
}

export default App;
