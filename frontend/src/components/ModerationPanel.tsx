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
    <div className="w-full flex flex-col md:flex-row gap-4 flex-1 min-h-0">
      {/* Active Users Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg border border-black/[0.08] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] min-h-0">
        <div className="px-3.5 py-2.5 bg-[#FAFBFD] border-b border-black/[0.08] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold text-slate-800">
              Active Chatters
            </span>
          </div>
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded-[3px] font-mono text-[11px] font-medium">
            {visibleActiveUsers.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {visibleActiveUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs italic gap-1">
              <span>No active chatters recorded yet</span>
              <span className="text-[11px] text-slate-400">
                Viewers who speak or chat will appear here.
              </span>
            </div>
          ) : (
            visibleActiveUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between p-2 rounded-[4px] bg-[#FAFAFA] hover:bg-[#F2F2F2] border border-black/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
                    {(Array.from(user.displayName)[0] || '?').toUpperCase()}
                  </div>
                  <span
                    className="text-xs font-semibold truncate text-slate-800"
                    style={{ color: getDeterministicColor(user.displayName) }}
                  >
                    {user.displayName}
                  </span>
                </div>
                <button
                  onClick={() => onBanUser(user.authorId, user.displayName, user.profileImageUrl)}
                  className="shrink-0 h-6.5 px-2.5 rounded-[4px] border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                  title="Ban from TTS"
                >
                  Ban
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Banned Users Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg border border-black/[0.08] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] min-h-0">
        <div className="px-3.5 py-2.5 bg-rose-50/50 border-b border-rose-200/60 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserX className="w-4 h-4 text-rose-600" />
            <span className="text-xs font-semibold text-rose-900">
              Banned from TTS
            </span>
          </div>
          <span className="bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.2 rounded-[3px] font-mono text-[11px] font-medium">
            {bannedUsers.length}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {bannedUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-rose-400 text-xs italic gap-1">
              <span>No banned users</span>
              <span className="text-[11px] text-rose-300">
                Banned users will be blocked from TTS playback.
              </span>
            </div>
          ) : (
            bannedUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between p-2 rounded-[4px] bg-rose-50/30 hover:bg-rose-100/40 border border-rose-100/80 transition-colors"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center font-bold text-xs text-rose-600 shrink-0">
                    <Shield className="w-3.5 h-3.5 text-rose-500" />
                  </div>
                  <span className="text-xs font-medium truncate text-slate-500 line-through decoration-rose-500">
                    {user.displayName}
                  </span>
                </div>
                <button
                  onClick={() => onUnbanUser(user.authorId)}
                  className="shrink-0 h-6.5 px-2.5 rounded-[4px] border border-black/[0.08] bg-white hover:bg-[#F5F5F5] text-slate-700 text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                  title="Unban User"
                >
                  Unban
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
