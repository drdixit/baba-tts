import { useStore } from './store';
import { useAppWebSocket } from './hooks/useAppWebSocket';
import ChatMessage from './components/ChatMessage';

export default function App() {
  const { messages } = useStore();
  const { currentAudioTime } = useAppWebSocket(true);

  // Find the currently speaking or processing message (if any)
  const activeMessage = messages.find(
    (m) => m.status === 'speaking' || m.status === 'processing'
  );

  return (
    <div className="h-screen w-screen bg-transparent overflow-hidden relative pointer-events-none select-none">
      {activeMessage && (
        <ChatMessage
          message={activeMessage}
          currentAudioTime={currentAudioTime}
          hideHistory={true}
          hideCard={false}
        />
      )}
    </div>
  );
}
