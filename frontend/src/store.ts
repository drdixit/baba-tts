import { create } from 'zustand';
import type { ChatMessage } from '../../src/shared/types';

export interface BannedUser {
  authorId: string;
  displayName: string;
  profileImageUrl?: string;
  bannedAt: string;
}

export interface ActiveUser {
  authorId: string;
  displayName: string;
  profileImageUrl?: string;
  lastSeenAt: number;
}

interface StoreState {
  bannedUsers: BannedUser[];
  activeUsers: ActiveUser[];
  setBannedUsers: (users: BannedUser[]) => void;
  messages: ChatMessage[];
  isConnected: boolean;
  addMessages: (newMessages: ChatMessage[]) => void;
  updateMessageStatus: (messageId: string, status: ChatMessage['status']) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  removeMessage: (messageId: string) => void;
  setConnected: (connected: boolean) => void;
  skipAllActiveMessages: () => void;
}

export const useStore = create<StoreState>((set) => ({
  bannedUsers: [],
  activeUsers: [],
  setBannedUsers: (users) => set({ bannedUsers: users }),
  messages: [],
  isConnected: false,
  addMessages: (newMessages) =>
    set((state) => {
      const updatedMessages = [...state.messages, ...newMessages];
      
      // Update active users
      const activeMap = new Map<string, ActiveUser>(state.activeUsers.map(u => [u.authorId, u]));
      const now = Date.now();
      newMessages.forEach(msg => {
        if (msg.authorId) {
          activeMap.set(msg.authorId, {
            authorId: msg.authorId,
            displayName: msg.authorName,
            profileImageUrl: msg.authorProfileImageUrl,
            lastSeenAt: now
          });
        }
      });
      // Sort active users by most recently seen
      const updatedActiveUsers = Array.from(activeMap.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 50);

      return {
        messages: updatedMessages.slice(-500),
        activeUsers: updatedActiveUsers
      };
    }),
  updateMessageStatus: (messageId, status) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.messageId === messageId ? { ...msg, status } : msg
      ),
    })),
  updateMessage: (messageId, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.messageId === messageId ? { ...msg, ...updates } : msg
      ),
    })),
  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((msg) => msg.messageId !== messageId),
    })),
  setConnected: (connected) =>
    set(() => ({
      isConnected: connected,
    })),
  skipAllActiveMessages: () =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        ['speaking', 'processing', 'queued', 'default', 'idle'].includes(msg.status)
          ? { ...msg, status: 'skipped' }
          : msg
      ),
    })),
}));
