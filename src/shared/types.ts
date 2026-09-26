import { z } from 'zod';

export const ChatMessageSchema = z.object({
  messageId: z.string(),
  authorName: z.string(),
  text: z.string(),
  status: z.enum(['default', 'processing', 'skipped', 'speaking', 'done']),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ModerationActionSchema = z.object({
  messageId: z.string(),
  action: z.enum(['delete', 'timeout', 'ban']),
});

export type ModerationAction = z.infer<typeof ModerationActionSchema>;
