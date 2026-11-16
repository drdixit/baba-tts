export type MessageStatus = 'default' | 'queued' | 'processing' | 'skipped' | 'speaking' | 'done' | 'error';

export type ChatTheme = 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean';

export interface WordBoundary {
  text: string;
  audioOffset: number;
  duration: number;
  textOffset?: number;
}

export interface ChatMessage {
  messageId: string;
  authorName: string;
  authorId?: string;
  authorProfileImageUrl?: string;
  authorColor?: string;
  text: string;
  status: MessageStatus;
  theme?: ChatTheme;
  wordBoundaries?: WordBoundary[];
}
