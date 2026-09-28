import React from 'react';
import type { ChatMessage as ChatMessageType } from '../../../src/shared/types';

interface ChatMessageProps {
  message: ChatMessageType;
  currentAudioTime?: number;
}

const statusBadgeStyles: Record<ChatMessageType['status'], string> = {
  default: '', // hidden
  queued: 'bg-purple-600/90 text-white',
  processing: 'bg-yellow-500/90 text-black animate-pulse',
  speaking: 'bg-green-500/90 text-black animate-bounce shadow-[0_0_8px_rgba(34,197,94,0.8)]',
  skipped: 'bg-red-600/90 text-white',
  error: 'bg-red-800/90 text-white',
  done: '', // hidden
};

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message, currentAudioTime }) => {
  const isSkipped = message.status === 'skipped';
  const isSpeaking = message.status === 'speaking';
  const isProcessing = message.status === 'processing';
  const showBadge = message.status !== 'default' && message.status !== 'done';
  const isActive = isSpeaking || isProcessing;

  return (
    <>
      {/* ZONE D SPOTLIGHT (Active Messages Only) */}
      {/* This sits exactly 810px from the bottom, which is right inside your Display zone (above 1750px) */}
      {isActive && (
        (message.theme?.startsWith('subtitle-') || message.theme === 'pro-clean') ? (
          <div 
            className={`fixed bottom-[810px] left-[49px] right-[51px] z-50 p-6 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] animate-spotlight flex flex-row items-center gap-8 text-left transition-all duration-500 overflow-hidden ${message.theme === 'pro-clean' ? 'border-l-[6px]' : ''}`}
            style={{ 
              background: `color-mix(in srgb, ${message.authorColor || '#4ade80'} 15%, #0f172a)`,
              borderLeftColor: message.theme === 'pro-clean' ? (message.authorColor || '#4ade80') : undefined
            }}
          >
            {/* Background Sweep effect */}
            {message.theme === 'subtitle-sweep' && message.status === 'speaking' && (
              <div 
                className="absolute top-0 left-0 bottom-0 bg-white/15 rounded-3xl pointer-events-none -z-10"
                style={{
                  width: (() => {
                    if (!message.wordBoundaries || message.wordBoundaries.length === 0 || currentAudioTime === undefined) return '0%';
                    const lastWord = message.wordBoundaries[message.wordBoundaries.length - 1];
                    const totalDuration = lastWord.audioOffset + lastWord.duration;
                    if (totalDuration === 0) return '0%';
                    const progress = Math.min(100, Math.max(0, (currentAudioTime / totalDuration) * 100));
                    return `${progress}%`;
                  })()
                }}
              ></div>
            )}
            
            <div className="flex flex-col items-center justify-center gap-3 shrink-0 w-36">
              {message.authorProfileImageUrl && (
                <img 
                  src={message.authorProfileImageUrl} 
                  alt={`${message.authorName}'s avatar`} 
                  className={`w-24 h-24 rounded-full shadow-lg bg-gray-800 object-cover z-10 transition-all duration-300
                    ${message.status === 'speaking' ? (message.theme === 'pro-clean' ? 'scale-110 border-4' : 'animate-avatar-speak border-2') : ''}
                    ${message.status === 'processing' ? 'animate-avatar-process border-2' : ''}
                    ${message.status !== 'speaking' && message.status !== 'processing' ? 'border-2 border-gray-700 animate-avatar-float' : ''}
                  `}
                  style={message.status === 'speaking' ? { borderColor: message.authorColor || '#4ade80', '--author-color': message.authorColor || '#4ade80' } as React.CSSProperties : undefined}
                />
              )}
            </div>

            <div className="flex flex-col flex-1 min-w-0 z-10">
              <span className="block text-3xl opacity-90 uppercase tracking-widest drop-shadow-md mb-2" style={{ color: message.authorColor || '#ffcc00' }}>
                {message.authorName}
              </span>
              
              <p className="text-4xl font-bold leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)] transition-all duration-700 flex flex-wrap gap-x-3 gap-y-2">
                {(() => {
                    const fallbackWords = message.text.split(' ');
                    const boundaries = (message.wordBoundaries && message.wordBoundaries.length > 0)
                      ? message.wordBoundaries
                      : fallbackWords.map((text, i) => ({ text, audioOffset: i * 0.3, duration: 0.3 }));

                    // We need a total duration to calculate progress for sweep-bg if we wanted, 
                    // but we can just use word highlight logic for all of them.

                    return boundaries.map((word, i) => {
                      const isHighlighted = message.status === 'speaking' && currentAudioTime !== undefined && currentAudioTime >= word.audioOffset && currentAudioTime < (word.audioOffset + word.duration + 0.1);
                      const isPast = message.status === 'speaking' && currentAudioTime !== undefined && currentAudioTime >= (word.audioOffset + word.duration + 0.1);
                      const isRead = isHighlighted || isPast;

                      if (message.theme === 'subtitle-karaoke') {
                        return (
                          <span 
                            key={i}
                            className={isRead ? '' : 'text-gray-600'}
                            style={{
                              color: isRead ? (message.authorColor || '#ffcc00') : undefined,
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
                            className={`px-1 ${isHighlighted ? 'text-black rounded' : (isPast || message.status === 'done' || message.status === 'skipped' ? 'text-[#f0fdf4]' : 'text-gray-600')}`}
                            style={{
                              backgroundColor: isHighlighted ? (message.authorColor || '#4ade80') : 'transparent',
                              color: isHighlighted ? '#000' : undefined,
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
                              color: isHighlighted ? (message.authorColor || '#4ade80') : '#f9fafb',
                              transform: isHighlighted ? 'scale(1.1)' : 'scale(1)',
                              textShadow: isHighlighted ? `0 0 12px ${message.authorColor || '#4ade80'}` : 'none'
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
                            className={isRead ? 'text-white' : 'text-gray-500'}
                          >
                            {word.text}
                          </span>
                        );
                      }

                      return <span key={i} className="text-white">{word.text}</span>;
                    });
                })()}
              </p>
            </div>
          </div>
        ) : (
          <div className={`fixed bottom-[810px] left-[49px] right-[51px] z-50 p-6 border-2 border-transparent rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] animate-spotlight flex flex-row items-center gap-6 text-left transition-all duration-500
            ${message.theme === 'neon' && message.status === 'processing' ? 'animate-neon-yellow' : ''}
            ${message.theme === 'neon' && message.status === 'speaking' ? 'animate-neon-green' : ''}
          `}
          style={{ background: `color-mix(in srgb, ${message.authorColor || '#4ade80'} 15%, #0f172a)` }}
          >
            {message.authorProfileImageUrl && (
              <img 
                src={message.authorProfileImageUrl} 
                alt={`${message.authorName}'s avatar`} 
                className={`w-24 h-24 rounded-full shadow-lg border-2 bg-gray-800 object-cover shrink-0 transition-all duration-300
                  ${message.status === 'speaking' ? 'animate-avatar-speak' : ''}
                  ${message.status === 'processing' ? 'animate-avatar-process' : ''}
                  ${message.status !== 'speaking' && message.status !== 'processing' ? 'border-gray-700 animate-avatar-float' : ''}
                `}
                style={message.status === 'speaking' ? { borderColor: message.authorColor || '#4ade80', '--author-color': message.authorColor || '#4ade80' } as React.CSSProperties : undefined}
              />
            )}

            <div className="flex flex-col flex-1 min-w-0 z-10">
              <div className="flex items-center gap-3 mb-2">
                <span className="block text-3xl opacity-90 uppercase tracking-widest drop-shadow-md" style={{ color: message.authorColor || '#ffcc00' }}>
                  {message.authorName}
                </span>
                {message.theme === 'waveform' && message.status === 'speaking' && (
                  <div className="flex items-center gap-1 h-6">
                    <div className="w-1.5 h-full rounded-full animate-waveform" style={{ backgroundColor: message.authorColor || '#4ade80' }}></div>
                    <div className="w-1.5 h-full rounded-full animate-waveform" style={{ backgroundColor: message.authorColor || '#4ade80' }}></div>
                    <div className="w-1.5 h-full rounded-full animate-waveform" style={{ backgroundColor: message.authorColor || '#4ade80' }}></div>
                    <div className="w-1.5 h-full rounded-full animate-waveform" style={{ backgroundColor: message.authorColor || '#4ade80' }}></div>
                  </div>
                )}
              </div>

              <p className={`text-4xl font-bold leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,1)] text-white transition-all duration-700
                ${message.theme === 'typewriter' && message.status === 'processing' ? 'blur-sm opacity-50 scale-95' : 'blur-none opacity-100 scale-100'}
              `}>
                {message.text}
              </p>
            </div>
          </div>
        )
      )}

      {/* ZONE E CHAT HISTORY (Always visible) */}
      <div className={`relative px-2 py-1 flex items-start justify-between transition-all duration-300 rounded ${
        isSkipped ? 'opacity-50' : 'opacity-100'
      } bg-transparent`}>
        <div className="flex items-start gap-3">
          {message.authorProfileImageUrl && (
            <img 
              src={message.authorProfileImageUrl} 
              alt="" 
              className="w-8 h-8 rounded-full shrink-0 mt-1 border border-gray-600 bg-gray-800 shadow-md"
            />
          )}
          <p className={`text-[28px] break-words leading-relaxed font-semibold transition-all duration-300 origin-left drop-shadow-[1px_1px_2px_rgba(0,0,0,1)] ${
            isSkipped ? 'line-through text-gray-400' : 'text-gray-50'
          } ${isActive ? 'text-green-300' : ''}`}>
            <span className="font-extrabold text-[#ffcc00] mr-2 drop-shadow-[1px_1px_2px_rgba(0,0,0,1)]">
              {message.authorName}:
            </span>
            <span>{message.text}</span>
          </p>
        </div>
        
        {showBadge && (
          <span
            className={`shrink-0 text-[10px] px-2 py-0.5 mt-1 ml-2 rounded uppercase tracking-wider font-bold shadow-md ${
              statusBadgeStyles[message.status]
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
