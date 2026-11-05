import { useEffect, useRef } from 'react';
import ChatMessage from './components/ChatMessage';
import { useStore } from './store';
import { useAppWebSocket } from './hooks/useAppWebSocket';

export default function OverlayPage() {
  const { messages } = useStore();
  const { currentAudioTime } = useAppWebSocket(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeMessage = messages.find(
    (m) => m.status === 'speaking' || m.status === 'processing'
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="w-[1080px] h-[1920px] bg-transparent overflow-hidden relative pointer-events-none select-none">
      {/* ZONE D SPOTLIGHT POPUP */}
      {activeMessage && (
        <ChatMessage
          message={activeMessage}
          currentAudioTime={currentAudioTime}
          hideHistory={true}
          hideCard={false}
          variant="overlay"
        />
      )}

      {/* ZONE E CHAT HISTORY */}
      <div className="absolute bottom-[20px] left-[49px] right-[51px] h-[580px] overflow-hidden flex flex-col justify-end">
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
                variant="overlay"
              />
            ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
