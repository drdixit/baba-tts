import React from 'react';
import type { ChatMessage as ChatMessageType } from '../../../src/shared/types';

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
  return (
    <div className="flex flex-col gap-1 p-3 mb-2 rounded bg-gray-800 text-white shadow-sm border border-gray-700">
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm text-gray-300">{message.authorName}</span>
        {message.status !== 'default' && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ${
              statusColors[message.status] || 'bg-gray-600 text-white'
            }`}
          >
            {message.status}
          </span>
        )}
      </div>
      <p className="text-base break-words">{message.text}</p>
    </div>
  );
});

ChatMessage.displayName = 'ChatMessage';

export default ChatMessage;
