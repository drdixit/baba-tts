import { useEffect, useRef } from 'react';
import ChatMessage from './components/ChatMessage';
import { useStore } from './store';
import { useAppWebSocket } from './hooks/useAppWebSocket';

export default function ChatPage() {
  const { messages } = useStore();
  // Pass playAudio = false so we don't play audio on this dashboard route
  useAppWebSocket(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#1c1c1e] p-6 overflow-hidden relative">
      <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4 shrink-0">
        <h1 className="text-white text-2xl font-bold opacity-50 uppercase tracking-widest">Chat Monitor</h1>
        <div className="text-gray-400 font-mono text-sm">
          Total Messages: {messages.length}
        </div>
      </div>
      
      {/* SCROLLING CHAT BOX */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col pr-4 space-y-2">
        <div className="flex flex-col min-h-full justify-end space-y-2">
          {messages.map((msg) => (
            <ChatMessage 
              key={msg.messageId} 
              message={msg} 
              // We pass 0 because audio is not playing here, so karaoke won't animate, which is correct for monitor
              currentAudioTime={0} 
              hideCard={true}
              hideHistory={false}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
