import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function useAppWebSocket(playAudio: boolean = false) {
  const { addMessages } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  
  const [currentAudioTime, setCurrentAudioTime] = useState(0);

  useEffect(() => {
    let isIntentionalClose = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.port === '7061' ? `${window.location.hostname}:7060` : window.location.host;
    const wsUrl = `${protocol}//${wsHost}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'banned_users') {
          useStore.getState().setBannedUsers(data.users);
        } else if (data.type === 'tts_state') {
          useStore.getState().updateMessageStatus(data.messageId, data.state);
        } else if (data.type === 'tts_error') {
          useStore.getState().updateMessageStatus(data.messageId, 'error');
        } else if (data.type === 'KILL_AUDIO') {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          setCurrentAudioTime(0);
        } else if (data.type === 'play_audio' && data.audioData) {
          useStore.getState().updateMessage(data.messageId, {
            status: 'speaking',
            wordBoundaries: data.wordBoundaries
          });

          if (!playAudio) return;

          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }

          if (audioRef.current) {
            audioRef.current.pause();
          }
          
          const audio = new Audio(data.audioData);
          audioRef.current = audio;

          const syncLoop = () => {
            if (audioRef.current === audio && !audio.paused) {
              setCurrentAudioTime(audio.currentTime);
              rafRef.current = requestAnimationFrame(syncLoop);
            }
          };

          audio.onplay = () => {
            rafRef.current = requestAnimationFrame(syncLoop);
          };

          audio.onpause = () => {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
          };
          
          audio.onended = () => {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            setCurrentAudioTime(0);
            useStore.getState().updateMessageStatus(data.messageId, 'done');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
            }
          };
          
          audio.onerror = (e) => {
            console.error("Audio play failed:", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
            }
          };
          
          audio.play().catch(e => {
            console.error("Audio play failed (Promise rejected):", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
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
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      if (isIntentionalClose) return;
      console.log('WebSocket disconnected. Attempting to reconnect in 3s...');
      setTimeout(() => {
        if (!isIntentionalClose) {
          console.log('Reconnecting...');
          window.location.reload();
        }
      }, 3000);
    };

    return () => {
      isIntentionalClose = true;
      ws.close();
    };
  }, [addMessages, playAudio]);

  return { wsRef, currentAudioTime, audioRef, rafRef, setCurrentAudioTime };
}
