import { z } from 'zod';

export const ChatMessageSchema = z.object({
  messageId: z.string(),
  authorName: z.string(),
  authorProfileImageUrl: z.string().optional(),
  authorColor: z.string().optional(),
  text: z.string(),
  status: z.enum(['default', 'queued', 'processing', 'skipped', 'speaking', 'done']),
  theme: z.enum(['default', 'waveform', 'neon', 'typewriter', 'subtitle-sweep', 'subtitle-karaoke', 'subtitle-words', 'pro-clean']).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ModerationActionSchema = z.object({
  messageId: z.string(),
  action: z.enum(['delete', 'timeout', 'ban']),
  durationSeconds: z.number().optional(),
});

export type ModerationAction = z.infer<typeof ModerationActionSchema>;
