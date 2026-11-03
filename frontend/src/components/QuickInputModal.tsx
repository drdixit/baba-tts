import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, X, Send, User } from 'lucide-react';

export interface QuickInputModalProps {
  isOpen: boolean;
  initialMode?: 'user' | 'banned';
  onClose: () => void;
  onSent?: (text: string, mode: 'user' | 'banned') => void;
  isStandalone?: boolean;
}

interface LastBannedUser {
  authorId: string;
  displayName: string;
  profileImageUrl?: string;
  bannedAt: string;
}

const CANNED_APOLOGIES = [
  "Bhai mujhe maaf kardo, ab main kabhi spam nahi karunga!",
  "Galti ho gayi streamer bhai, please mujhe unban kardo!",
  "Main to bas troll kar raha tha bhai, sach mein ban kar diya?!",
  "Alvida dosto, main ban ho gaya!",
  "Streamer bhai ek aakhri chance dedo please, ab sudhar gaya hu!"
];

export const QuickInputModal: React.FC<QuickInputModalProps> = ({
  isOpen,
  initialMode = 'banned',
  onClose,
  onSent,
  isStandalone = false
}) => {
  const [mode, setMode] = useState<'user' | 'banned'>(initialMode);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastBanned, setLastBanned] = useState<LastBannedUser | null>(null);
  const [fetchingBanned, setFetchingBanned] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, isOpen]);

  // Fetch last banned user when modal opens or mode changes to banned
  useEffect(() => {
    if (isOpen) {
      setFetchingBanned(true);
      fetch('/api/last-banned')
        .then((res) => (res.ok ? res.json() : { user: null }))
        .then((data) => {
          if (data && data.user) {
            setLastBanned(data.user);
          } else {
            setLastBanned(null);
          }
        })
        .catch(() => setLastBanned(null))
        .finally(() => setFetchingBanned(false));
    }
  }, [isOpen, mode]);

  // Focus input automatically whenever open or mode switches
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, mode]);

  // Handle global Esc key when open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        if (isStandalone) {
          window.close();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isStandalone]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'user') {
        const messageToSend = text.trim();
        if (!messageToSend) {
          setLoading(false);
          return;
        }
        const res = await fetch('/api/baba-say', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: messageToSend })
        });
        if (res.ok) {
          setText('');
          onSent?.(messageToSend, 'user');
          onClose();
          if (isStandalone) {
            window.close();
          }
        }
      } else {
        // Banned mode - if text is empty, send without text so backend picks random apology
        const payload = text.trim() ? { text: text.trim() } : {};
        const res = await fetch('/api/speak-as-banned', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const sentText = text.trim() || 'Default Apology';
          setText('');
          onSent?.(sentText, 'banned');
          onClose();
          if (isStandalone) {
            window.close();
          }
        }
      }
    } catch (err) {
      console.error('Failed to speak:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={
        isStandalone
          ? "w-full h-full min-h-screen bg-gray-950 flex flex-col justify-center items-center p-4 text-white font-sans"
          : "fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
      }
    >
      <div
        className="w-full max-w-lg bg-gray-900 border border-gray-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Mode Toggle & Close */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950/60">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('user')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                mode === 'user'
                  ? 'bg-cyan-500 text-gray-950 shadow-lg shadow-cyan-500/20'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Streamer Voice</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('banned')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                mode === 'banned'
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Banned User</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              if (isStandalone) window.close();
            }}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
            title="Close [Esc]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Target Identity Banner */}
          <div className="flex items-center gap-3 p-3 bg-gray-950/80 border border-gray-800 rounded-2xl">
            {mode === 'user' ? (
              <>
                <div className="w-10 h-10 rounded-xl bg-cyan-900/60 border border-cyan-500/50 flex items-center justify-center text-cyan-300 font-black text-sm shrink-0">
                  BABA
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold text-cyan-300 flex items-center gap-1.5">
                    Speak as Streamer
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-md bg-cyan-950 text-cyan-400 border border-cyan-800">
                      You
                    </span>
                  </span>
                  <span className="text-xs text-gray-400 truncate">
                    Priority broadcast message directly to TTS audio queue
                  </span>
                </div>
              </>
            ) : (
              <>
                {lastBanned?.profileImageUrl ? (
                  <img
                    src={lastBanned.profileImageUrl}
                    alt={lastBanned.displayName}
                    className="w-10 h-10 rounded-xl object-cover border border-rose-500/50 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-500/50 flex items-center justify-center text-rose-300 font-black text-sm shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold text-rose-300 flex items-center gap-1.5">
                    {fetchingBanned ? (
                      <span className="animate-pulse">Loading banned user...</span>
                    ) : lastBanned ? (
                      <>
                        <span className="truncate">{lastBanned.displayName}</span>
                        <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-md bg-rose-950 text-rose-400 border border-rose-800">
                          Banned
                        </span>
                      </>
                    ) : (
                      <span>Last Banned User</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-400 truncate">
                    {lastBanned ? "Impersonate banned viewer with custom text or apology" : "No banned users found yet in database"}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Canned Apology Pills (Banned mode only) */}
          {mode === 'banned' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Quick Apologies:
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {CANNED_APOLOGIES.map((apology, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setText(apology)}
                    className="px-2.5 py-1 text-xs bg-gray-800/90 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 text-left transition-colors truncate max-w-full"
                    title={apology}
                  >
                    "{apology}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Text Input */}
          <div className="flex flex-col gap-1.5">
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  mode === 'user'
                    ? "Type words to speak as Streamer..."
                    : "Type custom words, or leave empty for random apology..."
                }
                className="w-full bg-gray-950 border border-gray-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 rounded-2xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition-all pr-10"
              />
              {text && (
                <button
                  type="button"
                  onClick={() => setText('')}
                  className="absolute right-3 text-gray-400 hover:text-white p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex justify-between items-center px-1 text-[11px] text-gray-500">
              <span>Press <strong className="text-gray-300 font-mono">Enter</strong> to send</span>
              <span>Press <strong className="text-gray-300 font-mono">Esc</strong> to cancel</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={() => {
                onClose();
                if (isStandalone) window.close();
              }}
              className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={loading || (mode === 'user' && !text.trim())}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg ${
                mode === 'user'
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-gray-950 disabled:opacity-50'
                  : 'bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50'
              }`}
            >
              <Send className="w-4 h-4" />
              <span>
                {loading
                  ? 'Queueing...'
                  : mode === 'user'
                  ? 'Speak as Streamer'
                  : text.trim()
                  ? 'Speak Custom Message'
                  : 'Speak Random Apology'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default QuickInputModal;
