import React, { useState } from 'react';
import type { ChatMessage as ChatMessageType, ModerationAction } from '../../../src/shared/types';
import { MoreVertical } from 'lucide-react';

interface ChatMessageProps {
  message: ChatMessageType;
}

const statusColors: Record<ChatMessageType['status'], string> = {
  default: '', // will not be used if we hide it, but just in case
  processing: 'bg-gray-500 text-white',
  speaking: 'bg-green-600 text-white',
  skipped: 'bg-red-600 text-white',
  done: 'bg-blue-600 text-white',
};

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
  const [showMenu, setShowMenu] = useState(false);

  const handleAction = async (action: ModerationAction['action'], durationSeconds?: number) => {
    setShowMenu(false);
    try {
      const res = await fetch('/api/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.messageId, action, durationSeconds })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }
    } catch (err: any) {
      console.error('Moderation action failed:', err);
      alert(`Moderation failed: ${err.message}`);
    }
  };

  return (
    <div 
      className="group relative flex flex-col gap-1 p-3 mb-2 rounded bg-gray-800 text-white shadow-sm border border-gray-700 hover:bg-gray-700 transition-colors"
      onMouseLeave={() => setShowMenu(false)}
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm text-gray-300">{message.authorName}</span>
        <div className="flex items-center gap-2">
          {message.status !== 'default' && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
                statusColors[message.status] || 'bg-gray-600 text-white'
              }`}
            >
              {message.status}
            </span>
          )}
          
          <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-white"
            >
              <MoreVertical size={16} />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-gray-900 border border-gray-700 rounded shadow-lg z-10 overflow-hidden">
                <button 
                  onClick={() => handleAction('delete')}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Delete
                </button>
                <button 
                  onClick={() => handleAction('timeout', 30)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Timeout (30s)
                </button>
                <button 
                  onClick={() => handleAction('timeout', 60)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Timeout (1m)
                </button>
                <button 
                  onClick={() => handleAction('timeout', 300)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Timeout (5m)
                </button>
                <button 
                  onClick={() => handleAction('timeout', 1800)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Timeout (30m)
                </button>
                <button 
                  onClick={() => handleAction('timeout', 3600)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Timeout (1h)
                </button>
                <button 
                  onClick={() => handleAction('ban')}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-gray-800"
                >
                  Ban
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-base break-words pr-8">{message.text}</p>
    </div>
  );
});

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;
