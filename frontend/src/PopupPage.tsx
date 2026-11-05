import { useStore } from './store';
import { useAppWebSocket } from './hooks/useAppWebSocket';
import ChatMessage from './components/ChatMessage';

export default function PopupPage() {
  const { messages } = useStore();
  // Audio playback is false on OBS Browser Source to avoid echo/duplicates
  const { currentAudioTime } = useAppWebSocket(false);

  // Find currently speaking or processing message
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
          variant="overlay"
        />
      )}
    </div>
  );
}
