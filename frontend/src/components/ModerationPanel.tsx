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
    <div className="w-full flex flex-col md:flex-row gap-4 flex-1 h-full">
      
      {/* Active Users Panel */}
      <div className="flex-1 flex flex-col h-full bg-gray-800 rounded-xl border border-gray-600 overflow-hidden shadow-inner">
        <div className="px-6 py-4 bg-gray-700 border-b border-gray-600 text-3xl font-bold text-gray-100 uppercase tracking-wider flex justify-between items-center">
          <span>Active Users</span>
          <span className="bg-gray-700 px-4 py-1 rounded-full text-2xl">{visibleActiveUsers.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {visibleActiveUsers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500 text-2xl italic">
              No active users yet
            </div>
          ) : (
            visibleActiveUsers.map((user) => (
              <div key={user.authorId} className="group flex items-center justify-between p-6 rounded-2xl hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center gap-8 overflow-hidden">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="w-24 h-24 rounded-full shadow-sm bg-gray-800" />
                  ) : (
                    <div className="w-24 h-24 rounded-full shadow-sm bg-gray-700" />
                  )}
                  <span className="text-5xl font-bold truncate text-gray-100 tracking-wide" style={{ color: getDeterministicColor(user.displayName) }}>
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={() => onBanUser(user.authorId, user.displayName, user.profileImageUrl)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 px-8 py-4 bg-red-500/20 hover:bg-red-500 text-red-200 hover:text-white rounded-xl text-2xl font-bold transition-all focus:opacity-100 shadow-lg"
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
      <div className="flex-1 flex flex-col h-full bg-[#1a0a0a] rounded-xl border border-red-900/50 overflow-hidden shadow-inner">
        <div className="px-6 py-4 bg-red-900 border-b border-red-800 text-3xl font-bold text-red-100 uppercase tracking-wider flex justify-between items-center">
          <span>Banned from TTS</span>
          <span className="bg-red-900/50 text-red-200 px-4 py-1 rounded-full text-2xl">{bannedUsers.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {bannedUsers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-red-900/40 text-2xl italic">
              No banned users
            </div>
          ) : (
            bannedUsers.map((user) => (
              <div key={user.authorId} className="group flex items-center justify-between p-6 rounded-2xl hover:bg-red-900/30 transition-colors">
                <div className="flex items-center gap-8 overflow-hidden">
                  {user.profileImageUrl ? (
                    <img src={user.profileImageUrl} alt="" className="w-24 h-24 rounded-full shadow-sm bg-gray-800 grayscale" />
                  ) : (
                    <div className="w-24 h-24 rounded-full shadow-sm bg-gray-700 grayscale" />
                  )}
                  <span className="text-5xl font-bold truncate text-gray-400 tracking-wide line-through decoration-red-500/50">
                    {user.displayName}
                  </span>
                </div>
                <button 
                  onClick={() => onUnbanUser(user.authorId)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 px-8 py-4 bg-gray-700/50 hover:bg-gray-600 text-gray-300 hover:text-white rounded-xl text-2xl font-bold transition-all focus:opacity-100 shadow-lg"
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
