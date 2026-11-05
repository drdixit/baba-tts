import { useEffect, useRef } from 'react';
import ChatMessage from './components/ChatMessage';
import { useStore } from './store';
import { useAppWebSocket } from './hooks/useAppWebSocket';

export default function ChatPage() {
  const { messages } = useStore();
  // Audio playback is handled on the root route, so pass false here
  useAppWebSocket(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="h-screen w-screen bg-transparent overflow-hidden flex flex-col justify-end p-4 pointer-events-none select-none">
      {/* SCROLLING CHAT HISTORY (Auto-resizes cleanly to any container/screen size) */}
      <div className="w-full flex-1 overflow-y-auto overflow-x-hidden flex flex-col space-y-2 justify-end pr-2">
        <div className="flex flex-col min-h-full justify-end space-y-2">
          {messages
            .filter((msg) => msg.status !== 'error')
            .map((msg) => (
              <ChatMessage
                key={msg.messageId}
                message={msg}
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
