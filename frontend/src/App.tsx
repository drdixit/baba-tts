import { useEffect, useRef } from 'react';
import ChatMessage from './components/ChatMessage';
import { useStore } from './store';

function App() {
  const { messages, addMessages } = useStore();
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
        if (data.type === 'delete' && data.messageId) {
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
    };

    return () => {
      ws.close();
    };
  }, [addMessages]);

  return (
    <div className="h-screen bg-gray-900 text-gray-100 flex flex-col p-4 overflow-hidden">
      <header className="mb-4 shrink-0">
        <h1 className="text-xl font-bold text-gray-200">Baba TTS Chat</h1>
      </header>
      
      <main className="flex-1 overflow-y-auto flex flex-col bg-gray-950 rounded border border-gray-800 shadow-inner p-4">
        {messages.map((msg) => (
          <ChatMessage key={msg.messageId} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </main>
    </div>
  );
}

export default App;
