import React, { useState } from 'react';
import { useStore } from '../store';
import { Search } from 'lucide-react';

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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#444]">Chatter management</span>
        <label className="relative w-full max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#666]" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find a chatter"
            aria-label="Find an active or banned chatter"
            className="h-7 w-full border border-[#BDBDBD] bg-white pl-7 pr-2 text-xs text-[#222] placeholder:text-[#777] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
          />
        </label>
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 lg:flex-row">
      <fieldset className="desktop-groupbox flex min-h-0 flex-1 flex-col overflow-hidden">
        <legend className="desktop-groupbox-legend">Active chatters · {filteredActiveUsers.length}{normalizedQuery ? ` of ${visibleActiveUsers.length}` : ''}</legend>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredActiveUsers.length === 0 ? (
            <div className="flex min-h-20 items-center justify-center text-xs text-[#666]">
              {normalizedQuery ? 'No active chatters match this search.' : 'No active chatters yet.'}
            </div>
          ) : (
            filteredActiveUsers.map((user) => (
              <div key={user.authorId} className="flex min-h-8 items-center gap-2 border-b border-[#E7E7E7] px-1.5 last:border-b-0 hover:bg-[#F6F6F6]">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#222]">{user.displayName}</span>
                <button onClick={() => onBanUser(user.authorId, user.displayName, user.profileImageUrl)} className="h-6 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#7A1E22] hover:bg-[#FFF5F5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]" aria-label={`Ban ${user.displayName} from TTS`}>Ban</button>
              </div>
            ))
          )}
        </div>
      </fieldset>

      <fieldset className="desktop-groupbox flex min-h-0 flex-1 flex-col overflow-hidden">
        <legend className="desktop-groupbox-legend">Banned from TTS · {filteredBannedUsers.length}{normalizedQuery ? ` of ${bannedUsers.length}` : ''}</legend>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredBannedUsers.length === 0 ? (
            <div className="flex min-h-20 items-center justify-center text-xs text-[#666]">
              {normalizedQuery ? 'No banned users match this search.' : 'No banned users.'}
            </div>
          ) : (
            filteredBannedUsers.map((user) => (
              <div key={user.authorId} className="flex min-h-8 items-center gap-2 border-b border-[#E7E7E7] px-1.5 last:border-b-0 hover:bg-[#F6F6F6]">
                <span className="min-w-0 flex-1 truncate text-xs text-[#333]">{user.displayName}</span>
                <button onClick={() => onUnbanUser(user.authorId)} className="h-6 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#333] hover:bg-[#F1F1F1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]" aria-label={`Unban ${user.displayName}`}>Unban</button>
              </div>
            ))
          )}
        </div>
      </fieldset>
      </div>
    </div>
  );
};

export default ModerationPanel;
