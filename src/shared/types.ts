import { z } from 'zod';

export const ChatMessageSchema = z.object({
  messageId: z.string(),
  authorName: z.string(),
  authorProfileImageUrl: z.string().optional(),
  authorColor: z.string().optional(),
  text: z.string(),
  status: z.enum(['default', 'queued', 'processing', 'skipped', 'speaking', 'done', 'error']),
  theme: z.enum(['subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean']).optional(),
  wordBoundaries: z.array(z.object({
    text: z.string(),
    audioOffset: z.number(),
    duration: z.number()
  })).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ModerationActionSchema = z.object({
  messageId: z.string(),
  action: z.enum(['delete', 'timeout', 'ban']),
  durationSeconds: z.number().optional(),
});

export type ModerationAction = z.infer<typeof ModerationActionSchema>;
