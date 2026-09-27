import { create } from 'zustand';
import type { ChatMessage } from '../../src/shared/types';

interface StoreState {
  messages: ChatMessage[];
  isConnected: boolean;
  addMessages: (newMessages: ChatMessage[]) => void;
  updateMessageStatus: (messageId: string, status: ChatMessage['status']) => void;
  removeMessage: (messageId: string) => void;
  setConnected: (connected: boolean) => void;
}

export const useStore = create<StoreState>((set) => ({
  messages: [],
  isConnected: false,
  addMessages: (newMessages) =>
    set((state) => {
      // To handle potential duplicates in case we get same message ID again, 
      // but task just says "addMessages". Let's stick to simple append.
      const updatedMessages = [...state.messages, ...newMessages];
      return {
        messages: updatedMessages.slice(-500),
      };
    }),
  updateMessageStatus: (messageId, status) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.messageId === messageId ? { ...msg, status } : msg
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
}));
