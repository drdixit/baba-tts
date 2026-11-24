import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function useAppWebSocket(playAudio: boolean = false) {
  const { addMessages } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingUnlockRef = useRef<(() => void) | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);
  
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
    let isDisposed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      if (isDisposed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to WebSocket');
        setIsConnected(true);
        retryCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'banned_users') {
            useStore.getState().setBannedUsers(data.users);
          } else if (data.type === 'volume_state') {
            useStore.getState().setVolumeState(
              typeof data.volume === 'number' ? data.volume : 100,
              Boolean(data.isMuted)
            );
          } else if (data.type === 'tts_state') {
            useStore.getState().updateMessageStatus(data.messageId, data.state);
            if (data.state === 'done' || data.state === 'skipped' || data.state === 'error') {
              if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
              }
              // Do not immediately reset time to 0 on 'done' so the final highlighted words
              // don't flicker back to unread state while animating out.
              if (data.state !== 'done') {
                setCurrentAudioTime(0);
              }
            }
          } else if (data.type === 'tts_error') {
            useStore.getState().updateMessageStatus(data.messageId, 'error');
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            setCurrentAudioTime(0);
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

            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }

            if (!playAudio) {
              // Virtual animation timer for OBS overlays and silent viewers
              const boundaries = data.wordBoundaries;
              let totalDuration = 3.0;
              if (boundaries && boundaries.length > 0) {
                const last = boundaries[boundaries.length - 1];
                totalDuration = (last.audioOffset || 0) + (last.duration || 0) + 0.2;
              }
              // Compensate for ~85ms Windows WASAPI buffer pre-roll & decoding latency
              const WASAPI_LATENCY_DELAY_SEC = 0.085;
              const startTime = performance.now();
              const virtualLoop = (now: number) => {
                const elapsed = Math.max(0, (now - startTime) / 1000 - WASAPI_LATENCY_DELAY_SEC);
                if (elapsed < totalDuration) {
                  setCurrentAudioTime(elapsed);
                  rafRef.current = requestAnimationFrame(virtualLoop);
                } else {
                  setCurrentAudioTime(totalDuration);
                  rafRef.current = null;
                }
              };
              rafRef.current = requestAnimationFrame(virtualLoop);
              return;
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
        if (isDisposed) return;
        const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current), 10000);
        retryCountRef.current += 1;
        console.log(`WebSocket disconnected. Reconnecting in ${Math.round(delay)}ms...`);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          if (!isDisposed) {
            connect();
          }
        }, delay);
      };
    };

    connect();

    return () => {
      isDisposed = true;
      setIsConnected(false);
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [addMessages, playAudio]);

  return { wsRef, currentAudioTime, isConnected, audioRef, rafRef, setCurrentAudioTime };
}
