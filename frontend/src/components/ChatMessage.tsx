import React from 'react';
import type { ChatMessage as ChatMessageType } from '../../../src/shared/types';
import { getDeterministicColor } from '../../../src/shared/colors';

interface ChatMessageProps {
  message: ChatMessageType;
  currentAudioTime?: number;
  hideHistory?: boolean;
  hideCard?: boolean;
  variant?: 'overlay' | 'inline';
}

const statusBadgeStyles: Record<ChatMessageType['status'], string> = {
  default: '', // hidden
  queued: 'bg-[#0067C0]/90 text-white',
  processing: 'bg-yellow-500/90 text-black animate-pulse',
  speaking: 'bg-green-500/90 text-black animate-bounce shadow-[0_0_8px_rgba(34,197,94,0.8)]',
  skipped: 'bg-red-600/90 text-white',
  error: 'bg-red-800/90 text-white',
  done: '', // hidden
};

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message, currentAudioTime, hideHistory = false, hideCard = false, variant = 'overlay' }) => {
  const isFinished = message.status === 'skipped' || message.status === 'done';
  const isSpeaking = message.status === 'speaking';
  const isProcessing = message.status === 'processing';
  const showBadge = message.status !== 'default' && message.status !== 'done';
  const isActive = isSpeaking || isProcessing;

  const authorColor = React.useMemo(() => {
    if (variant === 'inline') {
      return '#404040';
    }
    return message.authorColor || getDeterministicColor(message.authorName, 'dark');
  }, [message.authorName, message.authorColor, variant]);

  const boundaries = React.useMemo(() => {
    return (message.wordBoundaries && message.wordBoundaries.length > 0)
      ? message.wordBoundaries
      : message.text.split(' ').map((text, i) => ({ text, audioOffset: i * 0.3, duration: 0.3, textOffset: undefined }));
  }, [message.wordBoundaries, message.text]);

  const numAuthorWords = React.useMemo(() => message.authorName.trim().split(/\s+/).length + 1, [message.authorName]);
  const prefixLength = React.useMemo(() => `${message.authorName} says `.length, [message.authorName]);

  const authorBoundaries = React.useMemo(() => {
    if (!message.wordBoundaries || message.wordBoundaries.length === 0) return [];
    if (message.wordBoundaries[0].textOffset === undefined) {
      return message.wordBoundaries.length > numAuthorWords ? message.wordBoundaries.slice(0, numAuthorWords) : [];
    }
    return message.wordBoundaries.filter(w => w.textOffset !== undefined && w.textOffset < prefixLength);
  }, [message.wordBoundaries, prefixLength, numAuthorWords]);

  const messageBoundaries = React.useMemo(() => {
    if (!message.wordBoundaries || message.wordBoundaries.length === 0) return boundaries;
    if (message.wordBoundaries[0].textOffset === undefined) {
      return message.wordBoundaries.length > numAuthorWords ? message.wordBoundaries.slice(numAuthorWords) : boundaries;
    }
    return message.wordBoundaries.filter(w => w.textOffset === undefined || w.textOffset >= prefixLength);
  }, [message.wordBoundaries, boundaries, prefixLength, numAuthorWords]);

  const isAuthorSpeaking = React.useMemo(() => {
    return authorBoundaries.some(word =>
      message.status === 'speaking' &&
      currentAudioTime !== undefined &&
      currentAudioTime >= word.audioOffset &&
      currentAudioTime < (word.audioOffset + word.duration + 0.1)
    );
  }, [authorBoundaries, message.status, currentAudioTime]);

  return (
    <>
      {/* ZONE D SPOTLIGHT (Active Messages Only) */}
      {!hideCard && isActive && (
          <div
            className={`${
              variant === 'inline'
                ? 'relative w-full p-2 flex flex-row items-center gap-2 text-left overflow-hidden border border-[#BDBDBD] bg-white'
                : 'fixed bottom-[630px] left-[49px] right-[51px] z-50 p-6 rounded-3xl animate-spotlight flex flex-row items-center gap-8 text-left overflow-hidden shadow-2xl'
            } ${message.theme === 'pro-clean' ? 'border-l-[6px]' : ''}`}
            style={{
              background: variant === 'inline'
                ? '#FFFFFF'
                : `color-mix(in srgb, ${authorColor} 15%, #0f172a)`,
              borderLeftColor: message.theme === 'pro-clean' ? authorColor : undefined
            }}
          >
            {/* Background Sweep effect */}
            {message.theme === 'subtitle-sweep' && message.status === 'speaking' && (
              <div
                className={`absolute top-0 left-0 bottom-0 rounded-3xl pointer-events-none -z-10 ${variant === 'inline' ? 'bg-slate-200/60' : 'bg-white/15'}`}
                style={{
                  width: (() => {
                    if (!messageBoundaries || messageBoundaries.length === 0 || currentAudioTime === undefined) return '0%';
                    const messageStart = messageBoundaries[0].audioOffset;
                    const lastWord = messageBoundaries[messageBoundaries.length - 1];
                    const messageEnd = lastWord.audioOffset + lastWord.duration;
                    const messageDuration = messageEnd - messageStart;
                    if (messageDuration <= 0) return '0%';

                    if (currentAudioTime < messageStart) return '0%';
                    const progress = Math.min(100, Math.max(0, ((currentAudioTime - messageStart) / messageDuration) * 100));
                    return `${progress}%`;
                  })()
                }}
              ></div>
            )}

            <div className={`flex flex-col items-center justify-center gap-2 shrink-0 ${variant === 'inline' ? 'w-12' : 'w-36'}`}>
              {message.authorProfileImageUrl && (
              <img
                  src={message.authorProfileImageUrl}
                  alt={`${message.authorName}'s avatar`} onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(message.authorName)}`; }}
                  className={`${variant === 'inline' ? 'w-8 h-8' : 'w-24 h-24 shadow-lg bg-gray-800'} ${variant === 'inline' ? 'rounded-[2px]' : 'rounded-full'} object-cover z-10 transition-all duration-300
                    ${message.status === 'speaking' ? (message.theme === 'pro-clean' ? 'scale-110 border-3' : (variant === 'inline' ? 'border-2 border-slate-500' : 'animate-avatar-speak border-2')) : ''}
                    ${message.status === 'processing' ? (variant === 'inline' ? 'border-2 border-slate-400' : 'animate-avatar-process border-2') : ''}
                    ${message.status !== 'speaking' && message.status !== 'processing' ? (variant === 'inline' ? 'border border-slate-200' : 'border border-slate-200 animate-avatar-float') : ''}
                  `}
                  style={message.status === 'speaking' ? { borderColor: authorColor, '--author-color': authorColor } as React.CSSProperties : undefined}
                />
              )}
            </div>

            <div className="flex flex-col flex-1 min-w-0 z-10">
              <span
                className={`block ${variant === 'inline' ? 'text-xs font-semibold tracking-normal mb-0.5' : 'text-3xl font-black mb-2 uppercase tracking-widest'} transition-all duration-200 ${isAuthorSpeaking ? 'opacity-100 scale-105 origin-left' : 'opacity-90'}`}
                style={{
                  color: authorColor,
                  textShadow: variant === 'inline' ? 'none' : '0 2px 4px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,1)'
                }}
              >
                {message.authorName}
              </span>

              <p className={`${variant === 'inline' ? 'text-[13px] font-semibold leading-snug text-[#222]' : 'text-5xl font-bold leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]'} transition-all duration-700 flex flex-wrap gap-x-2 gap-y-1`}>
                {(() => {
                    let activeWordIndex = -1;
                    if (message.status === 'speaking' && currentAudioTime !== undefined) {
                      for (let i = messageBoundaries.length - 1; i >= 0; i--) {
                        if (currentAudioTime >= messageBoundaries[i].audioOffset) {
                          activeWordIndex = i;
                          break;
                        }
                      }
                    }

                    return messageBoundaries.map((word, i) => {
                      const isHighlighted = i === activeWordIndex;
                      const isPast = i < activeWordIndex;
                      const isRead = isHighlighted || isPast;

                      if (message.theme === 'subtitle-karaoke' || !message.theme) {
                        return (
                          <span
                            key={i}
                            className={`transition-colors duration-150 ${
                              variant === 'inline'
                                ? (isRead ? 'font-bold' : 'text-slate-500')
                                : (isRead ? '' : 'text-gray-600')
                            }`}
                            style={{
                              color: isRead ? authorColor : undefined,
                            } as React.CSSProperties}
                          >
                            {word.text}
                          </span>
                        );
                      }

                      if (message.theme === 'subtitle-words') {
                        return (
                          <span
                            key={i}
                            className={`inline-block px-1.5 py-0.5 mx-0.5 rounded-md transition-all ${
                              isHighlighted
                                ? 'scale-105 font-bold shadow-xs'
                                : 'scale-100 ' + (isPast || message.status === 'done' || message.status === 'skipped' ? (variant === 'inline' ? 'text-slate-800' : 'text-[#f0fdf4]') : (variant === 'inline' ? 'text-slate-500' : 'text-gray-500'))
                            }`}
                            style={{
                              backgroundColor: isHighlighted ? authorColor : 'transparent',
                              color: isHighlighted ? (variant === 'inline' ? '#ffffff' : '#000') : undefined,
                            } as React.CSSProperties}
                          >
                            {word.text}
                          </span>
                        );
                      }

                      if (message.theme === 'pro-clean') {
                        return (
                          <span
                            key={i}
                            className="px-1 transition-all duration-100"
                            style={{
                              color: isHighlighted ? authorColor : (variant === 'inline' ? '#1e293b' : '#f9fafb'),
                              transform: isHighlighted ? 'scale(1.05)' : 'scale(1)',
                              textShadow: isHighlighted ? (variant === 'inline' ? 'none' : `0 0 12px ${authorColor}`) : 'none'
                            } as React.CSSProperties}
                          >
                            {word.text}
                          </span>
                        );
                      }

                      if (message.theme === 'subtitle-sweep') {
                        return (
                          <span
                            key={i}
                            className={isRead ? (variant === 'inline' ? 'text-slate-900 font-bold' : 'text-white') : (variant === 'inline' ? 'text-slate-400' : 'text-gray-500')}
                          >
                            {word.text}
                          </span>
                        );
                      }

                      return <span key={i} className={variant === 'inline' ? 'text-slate-900' : 'text-white'}>{word.text}</span>;
                    });
                })()}
              </p>
            </div>
          </div>
      )}

      {/* ZONE E CHAT HISTORY */}
      <div className={`${hideHistory ? 'hidden' : ''} relative ${
        variant === 'inline'
          ? `px-1.5 py-1 border-b border-[#E5E5E5] transition-colors ${
              isActive
                ? 'bg-[#ECECEC]'
                : 'bg-white hover:bg-[#F6F6F6]'
            }`
          : 'px-2 py-1 rounded bg-transparent'
      } flex items-center justify-between transition-all duration-300 ${
        isFinished ? (variant === 'inline' ? 'opacity-75' : 'opacity-60') : 'opacity-100'
      }`}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {message.authorProfileImageUrl && (
          <img
              src={message.authorProfileImageUrl}
              alt=""
              className={`${variant === 'inline' ? 'w-5 h-5 rounded-[2px]' : 'w-14 h-14 rounded-full'} object-cover shrink-0 border ${
                variant === 'inline' ? 'border-slate-200 bg-slate-100' : 'border-gray-600 bg-gray-800'
              } shadow-2xs`}
            />
          )}
          <p className={`${
            variant === 'inline'
              ? 'text-xs font-normal leading-snug text-slate-800'
              : 'text-[42px] leading-relaxed drop-shadow-[1px_1px_2px_rgba(0,0,0,1)] text-gray-50'
          } break-words transition-all duration-300 origin-left ${
            message.status === 'skipped'
              ? (variant === 'inline' ? 'line-through text-slate-500' : 'line-through text-rose-400')
              : message.status === 'done'
                ? (variant === 'inline' ? 'text-slate-600' : 'text-gray-300')
                : ''
          } ${isActive ? (variant === 'inline' ? 'text-slate-900 font-medium' : 'text-green-300') : ''}`}>
            <span
              className={`font-semibold mr-1.5 ${variant === 'inline' ? '' : 'drop-shadow-[1px_1px_2px_rgba(0,0,0,1)]'}`}
              style={{ color: variant === 'inline' ? '#404040' : (message.authorColor || '#0067C0') }}
            >
              {message.authorName}:
            </span>
            <span>{message.text}</span>
          </p>
        </div>

        {showBadge && (
          <span
            className={`shrink-0 ${variant === 'inline' ? 'text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-[3px] border' : 'text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold shadow-md'} ml-2 ${
              variant === 'inline'
                ? (message.status === 'speaking'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : message.status === 'processing'
                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                    : message.status === 'queued'
                    ? 'bg-slate-50 text-slate-600 border-slate-200'
                    : message.status === 'skipped'
                    ? 'bg-slate-100 text-slate-500 border-slate-200'
                    : statusBadgeStyles[message.status])
                : statusBadgeStyles[message.status]
            }`}
          >
            {message.status}
          </span>
        )}
      </div>
    </>
  );
});

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;
