import React, { useState } from 'react';
import { useStore } from '../store';
import { getDeterministicColor } from '../../../src/shared/colors';
import { UserCheck, UserX, Shield, Search } from 'lucide-react';

interface ModerationPanelProps {
  onBanUser: (authorId: string, displayName: string, profileImageUrl?: string) => void;
  onUnbanUser: (authorId: string) => void;
}

const ModerationPanel: React.FC<ModerationPanelProps> = ({ onBanUser, onUnbanUser }) => {
  const activeUsers = useStore((state) => state.activeUsers);
  const bannedUsers = useStore((state) => state.bannedUsers);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter out banned users from active users list so they don't appear in both
  const bannedIds = new Set(bannedUsers.map((u) => u.authorId));
  const visibleActiveUsers = activeUsers.filter((u) => !bannedIds.has(u.authorId));
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredActiveUsers = visibleActiveUsers.filter((user) =>
    user.displayName.toLocaleLowerCase().includes(normalizedQuery)
  );
  const filteredBannedUsers = bannedUsers.filter((user) =>
    user.displayName.toLocaleLowerCase().includes(normalizedQuery)
  );

  return (
    <div className="w-full flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Moderation</h2>
          <p className="mt-0.5 text-xs text-slate-500">Choose who can use TTS.</p>
        </div>
        <label className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find a chatter"
            aria-label="Find an active or banned chatter"
            className="w-full min-h-10 pl-9 pr-3 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0067C0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0067C0]"
          />
        </label>
      </div>

      <div className="w-full flex flex-col md:flex-row gap-4 flex-1 min-h-0">
      {/* Active Users Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg border border-black/[0.08] overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-black/[0.08] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-semibold text-slate-800">Active chatters</span>
          </div>
          <span className="text-xs text-slate-500">
            {filteredActiveUsers.length}{normalizedQuery ? ` of ${visibleActiveUsers.length}` : ''}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {filteredActiveUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
              <span>{normalizedQuery ? 'No active chatters match your search.' : 'No active chatters yet.'}</span>
              {!normalizedQuery && <span className="text-[11px]">Viewers appear here after they chat.</span>}
            </div>
          ) : (
            filteredActiveUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between gap-3 p-2 rounded-md hover:bg-slate-50 transition-colors"
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
                  className="shrink-0 min-h-9 px-3 rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                  aria-label={`Ban ${user.displayName} from TTS`}
                >
                  Ban
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Banned Users Panel */}
      <div className="flex-1 flex flex-col bg-white rounded-lg border border-black/[0.08] overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-black/[0.08] flex justify-between items-center">
          <div className="flex items-center gap-2">
            <UserX className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">Banned from TTS</span>
          </div>
          <span className="text-xs text-slate-500">
            {filteredBannedUsers.length}{normalizedQuery ? ` of ${bannedUsers.length}` : ''}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {filteredBannedUsers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs gap-1">
              <span>{normalizedQuery ? 'No banned users match your search.' : 'No banned users.'}</span>
              {!normalizedQuery && <span className="text-[11px]">Banned users cannot use TTS.</span>}
            </div>
          ) : (
            filteredBannedUsers.map((user) => (
              <div
                key={user.authorId}
                className="group flex items-center justify-between gap-3 p-2 rounded-md hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-600 shrink-0">
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                  <span className="text-xs font-medium truncate text-slate-600">
                    {user.displayName}
                  </span>
                </div>
                <button
                  onClick={() => onUnbanUser(user.authorId)}
                  className="shrink-0 min-h-9 px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                  aria-label={`Unban ${user.displayName}`}
                >
                  Unban
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default ModerationPanel;
