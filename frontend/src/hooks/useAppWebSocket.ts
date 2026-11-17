import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function useAppWebSocket(playAudio: boolean = false) {
  const { addMessages } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingUnlockRef = useRef<(() => void) | null>(null);
  
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  // Proactively unlock audio context on initial user gesture anywhere in window
  useEffect(() => {
    if (!playAudio) return;
    const unlock = () => {
      const silentAudio = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      );
      silentAudio.play().catch(() => {});
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
  }, [playAudio]);

  useEffect(() => {
    let isIntentionalClose = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
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
          if (pendingUnlockRef.current) {
            pendingUnlockRef.current();
            pendingUnlockRef.current = null;
          }
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
          if (pendingUnlockRef.current) {
            pendingUnlockRef.current();
            pendingUnlockRef.current = null;
          }

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
          
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise.catch((e: unknown) => {
              const err = e as { name?: string; message?: string };
              if (err && err.name === 'NotAllowedError') {
                console.warn(
                  '[Audio] Autoplay blocked by browser policy. Queuing playback on next user gesture for message:',
                  data.messageId
                );

                const unlockAndPlay = () => {
                  window.removeEventListener('click', unlockAndPlay);
                  window.removeEventListener('keydown', unlockAndPlay);
                  window.removeEventListener('pointerdown', unlockAndPlay);
                  pendingUnlockRef.current = null;

                  audio.play().catch((retryErr) => {
                    console.error('[Audio] Playback retry failed after user gesture:', retryErr);
                    useStore.getState().updateMessageStatus(data.messageId, 'skipped');
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                      wsRef.current.send(
                        JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId })
                      );
                    }
                  });
                };

                pendingUnlockRef.current = () => {
                  window.removeEventListener('click', unlockAndPlay);
                  window.removeEventListener('keydown', unlockAndPlay);
                  window.removeEventListener('pointerdown', unlockAndPlay);
                };

                window.addEventListener('click', unlockAndPlay, { once: true });
                window.addEventListener('keydown', unlockAndPlay, { once: true });
                window.addEventListener('pointerdown', unlockAndPlay, { once: true });
                return;
              }

              console.error('Audio play failed (Promise rejected):', e);
              useStore.getState().updateMessageStatus(data.messageId, 'skipped');
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
              }
            });
          }
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
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
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
      setIsConnected(false);
      ws.close();
    };
  }, [addMessages, playAudio]);

  return { wsRef, currentAudioTime, isConnected, audioRef, rafRef, setCurrentAudioTime };
}
