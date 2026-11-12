import React from 'react';
import { useStore } from '../store';
import { getDeterministicColor } from '../../../src/shared/colors';
import { UserCheck, UserX, Shield } from 'lucide-react';

interface ModerationPanelProps {
  onBanUser: (authorId: string, displayName: string, profileImageUrl?: string) => void;
  onUnbanUser: (authorId: string) => void;
}

const ModerationPanel: React.FC<ModerationPanelProps> = ({ onBanUser, onUnbanUser }) => {
  const activeUsers = useStore((state) => state.activeUsers);
  const bannedUsers = useStore((state) => state.bannedUsers);

  // Filter out banned users from active users list so they don't appear in both
  const bannedIds = new Set(bannedUsers.map((u) => u.authorId));
  const visibleActiveUsers = activeUsers.filter((u) => !bannedIds.has(u.authorId));

  return (
    <div className="w-full flex flex-col md:flex-row gap-6 flex-1 min-h-0">
      {/* Active Users Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs min-h-0">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Active Chatters
            </span>
          </div>
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-xs font-bold">
            {visibleActiveUsers.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {visibleActiveUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm italic gap-1">
              <span>No active chatters recorded yet</span>
              <span className="text-xs text-slate-400">
                Viewers who speak or chat will appear here.
              </span>
            </div>
          ) : (
            visibleActiveUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between p-3 rounded-xl bg-slate-50/60 hover:bg-slate-100/80 border border-slate-100 transition-colors"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
                    {(Array.from(user.displayName)[0] || '?').toUpperCase()}
                  </div>
                  <span
                    className="text-base font-bold truncate text-slate-800 tracking-wide"
                    style={{ color: getDeterministicColor(user.displayName) }}
                  >
                    {user.displayName}
                  </span>
                </div>
                <button
                  onClick={() => onBanUser(user.authorId, user.displayName, user.profileImageUrl)}
                  className="opacity-90 group-hover:opacity-100 shrink-0 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-all shadow-xs"
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
      <div className="flex-1 flex flex-col bg-white rounded-2xl border border-rose-200 overflow-hidden shadow-xs min-h-0">
        <div className="px-5 py-3.5 bg-rose-50 border-b border-rose-200 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserX className="w-4 h-4 text-rose-600" />
            <span className="text-sm font-bold text-rose-900 uppercase tracking-wider">
              Banned from TTS
            </span>
          </div>
          <span className="bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full text-xs font-bold">
            {bannedUsers.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {bannedUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-rose-400 text-sm italic gap-1">
              <span>No banned users</span>
              <span className="text-xs text-rose-300">
                Banned users will be blocked from TTS playback.
              </span>
            </div>
          ) : (
            bannedUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between p-3 rounded-xl bg-rose-50/40 hover:bg-rose-100/40 border border-rose-100 transition-colors"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center font-bold text-xs text-rose-600 shrink-0">
                    <Shield className="w-4 h-4 text-rose-500" />
                  </div>
                  <span className="text-base font-bold truncate text-slate-500 tracking-wide line-through decoration-rose-500">
                    {user.displayName}
                  </span>
                </div>
                <button
                  onClick={() => onUnbanUser(user.authorId)}
                  className="opacity-90 group-hover:opacity-100 shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all shadow-xs"
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
