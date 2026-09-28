import React from 'react';
import { useStore } from '../store';
import { getDeterministicColor } from '../../../src/shared/colors';

interface ModerationPanelProps {
  onBanUser: (authorId: string, displayName: string, profileImageUrl?: string) => void;
  onUnbanUser: (authorId: string) => void;
}

const ModerationPanel: React.FC<ModerationPanelProps> = ({ onBanUser, onUnbanUser }) => {
  const activeUsers = useStore((state) => state.activeUsers);
  const bannedUsers = useStore((state) => state.bannedUsers);

  // Filter out banned users from active users list so they don't appear in both
  const bannedIds = new Set(bannedUsers.map(u => u.authorId));
  const visibleActiveUsers = activeUsers.filter(u => !bannedIds.has(u.authorId));

  return (
    <div className="w-full flex flex-col md:flex-row gap-4 h-full bg-gray-900/40 backdrop-blur-md border-y border-gray-700/50 p-4">
      
      {/* Active Users Panel */}
      <div className="flex-1 flex flex-col h-full bg-gray-800/50 rounded-xl border border-gray-600/50 overflow-hidden shadow-inner">
        <div className="px-4 py-2 bg-gray-800/80 border-b border-gray-600/50 text-lg font-bold text-gray-300 uppercase tracking-wider flex justify-between items-center">
          <span>Active Users</span>
          <span className="bg-gray-700 px-2 py-0.5 rounded-full text-sm">{visibleActiveUsers.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {visibleActiveUsers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm italic">
              No active users yet
            </div>
          ) : (
            visibleActiveUsers.map((user) => (
              <div key={user.authorId} className="group flex items-center justify-between p-2 rounded-lg hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center gap-3 overflow-hidden">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="w-12 h-12 rounded-full shadow-sm bg-gray-800" />
                  ) : (
                    <div className="w-12 h-12 rounded-full shadow-sm bg-gray-700" />
                  )}
                  <span className="text-xl font-bold truncate text-gray-100 tracking-wide" style={{ color: getDeterministicColor(user.displayName) }}>
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={() => onBanUser(user.authorId, user.displayName, user.profileImageUrl)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 px-4 py-2 bg-red-500/20 hover:bg-red-500 text-red-200 hover:text-white rounded-md text-sm font-bold transition-all focus:opacity-100"
                  title="Ban from TTS"
                >
                  BAN &rarr;
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Banned Users Panel */}
      <div className="flex-1 flex flex-col h-full bg-red-900/10 rounded-xl border border-red-900/30 overflow-hidden shadow-inner">
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-900/30 text-lg font-bold text-red-300 uppercase tracking-wider flex justify-between items-center">
          <span>Banned from TTS</span>
          <span className="bg-red-900/50 text-red-200 px-2 py-0.5 rounded-full text-sm">{bannedUsers.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {bannedUsers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-red-900/40 text-sm italic">
              No banned users
            </div>
          ) : (
            bannedUsers.map((user) => (
              <div key={user.authorId} className="group flex items-center justify-between p-2 rounded-lg hover:bg-red-900/30 transition-colors">
                <div className="flex items-center gap-3 overflow-hidden">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="w-12 h-12 rounded-full shadow-sm bg-gray-800 grayscale" />
                  ) : (
                    <div className="w-12 h-12 rounded-full shadow-sm bg-gray-700 grayscale" />
                  )}
                  <span className="text-xl font-bold truncate text-gray-400 tracking-wide line-through decoration-red-500/50">
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={() => onUnbanUser(user.authorId)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 px-4 py-2 bg-gray-700/50 hover:bg-gray-600 text-gray-300 hover:text-white rounded-md text-sm font-bold transition-all focus:opacity-100"
                  title="Unban User"
                >
                  &larr; UNBAN
                </button>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
};

export default ModerationPanel;
