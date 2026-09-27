import React from 'react';
import type { ChatMessage as ChatMessageType } from '../../../src/shared/types';

interface ChatMessageProps {
  message: ChatMessageType;
}

const statusBadgeStyles: Record<ChatMessageType['status'], string> = {
  default: '', // hidden
  queued: 'bg-purple-600/90 text-white',
  processing: 'bg-yellow-500/90 text-black animate-pulse',
  speaking: 'bg-green-500/90 text-black animate-bounce shadow-[0_0_8px_rgba(34,197,94,0.8)]',
  skipped: 'bg-red-600/90 text-white',
  done: '', // hidden
};

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
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
              <div className="animate-sweep-bg rounded-3xl pointer-events-none"></div>
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
                {message.theme === 'subtitle-sweep' ? (
                  <span className="text-white">{message.text}</span>
                ) : (
                  (() => {
                    const words = message.text.split(' ');
                    const totalChars = words.reduce((sum, w) => sum + w.length, 0);
                    const totalDuration = 5; // Fixed for now
                    const timePerChar = totalDuration / totalChars;
                    let currentDelay = 0;

                    return words.map((word, i) => {
                      const wordDuration = word.length * timePerChar;
                      const delay = currentDelay;
                      currentDelay += wordDuration;

                      if (message.theme === 'subtitle-karaoke') {
                        return (
                          <span 
                            key={i}
                            className={message.status === 'speaking' ? 'animate-sweep-text' : 'text-gray-600'}
                            style={{
                              '--author-color': message.authorColor || '#ffcc00',
                              animationDuration: message.status === 'speaking' ? `${wordDuration}s` : '0s',
                              animationDelay: message.status === 'speaking' ? `${delay}s` : '0s',
                              WebkitTextFillColor: message.status === 'speaking' ? undefined : 'currentColor',
                              background: message.status === 'speaking' ? undefined : 'none'
                            } as React.CSSProperties}
                          >
                            {word}
                          </span>
                        );
                      }

                      if (message.theme === 'subtitle-words') {
                        return (
                          <span 
                            key={i}
                            className="px-1"
                            style={{
                              '--author-color': message.authorColor || '#ffcc00',
                              color: message.status === 'speaking' ? '#4b5563' : (message.status === 'done' ? '#f0fdf4' : '#4b5563'),
                              animation: message.status === 'speaking' ? `wordHighlight ${wordDuration}s ${delay}s forwards` : 'none'
                            } as React.CSSProperties}
                          >
                            {word}
                          </span>
                        );
                      }

                      if (message.theme === 'pro-clean') {
                        return (
                          <span 
                            key={i}
                            className="px-1"
                            style={{
                              '--author-color': message.authorColor || '#4ade80',
                              color: '#f9fafb',
                              animation: message.status === 'speaking' ? `wordProClean ${wordDuration}s ${delay}s forwards` : 'none'
                            } as React.CSSProperties}
                          >
                            {word}
                          </span>
                        );
                      }

                      return <span key={i} className="text-white">{word}</span>;
                    });
                  })()
                )}
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
