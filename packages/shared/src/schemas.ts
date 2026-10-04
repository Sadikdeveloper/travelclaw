import type { MessageAttachment } from './types';
import { z } from 'zod';

export const paceSchema = z.enum(['relaxed', 'steady', 'packed']);
export const budgetStyleSchema = z.enum(['lean', 'comfortable', 'splurge']);
export const tripStatusSchema = z.enum([
  'draft',
  'planning',
  'booked',
  'traveling',
  'done',
]);
export const memoryKindSchema = z.enum(['preference', 'fact', 'decision']);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'That password is too long');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

export const googleAuthSchema = z.object({
  credential: z.string().trim().min(1, 'Missing Google credential'),
});

/**
 * Language tags are kept readable (`EN-ng` -> `en-NG`) wherever one is normalized:
 * a message-stated market and any operator env value pass through the same rules.
 */
export function normalizeLanguageTag(value: string): string {
  return value
    .split('-')
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) return part.toUpperCase();
      if (/^[A-Za-z]{4}$/.test(part)) {
        return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
      }
      return part.toLowerCase();
    })
    .join('-');
}

export const createAgentSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/, 'Use a short lowercase id')
    .optional(),
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(16).default('compass'),
  role: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(240),
  model: z.string().trim().min(1).max(80).optional(),
});

export const createSessionSchema = z.object({
  agentId: z.string().trim().min(1).max(40).optional(),
  channel: z.string().trim().min(1).max(32).default('webchat'),
  peerId: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(80).optional(),
});

export const taskDecisionSchema = z.object({
  decision: z.enum(['complete', 'no', 'still_working']),
});

/** Explicit consent for the desk to ask a provider to hold one real offer. */
export const requestOfferHoldSchema = z.object({
  confirm: z.literal(true),
});

/** Kept small on purpose: the wire carries a name and a thumbnail, never the bytes. */
export const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mime: z.string().trim().min(3).max(120),
  size: z.number().int().min(1).max(12_582_912),
  kind: z.enum(['image', 'document']),
  thumb: z.string().max(180_000).nullable().optional(),
});

export const attachmentsSchema = z.array(attachmentSchema).max(4);

/** A message needs words or a file — either one alone is a real turn. */
function hasSubstance(value: { content: string; attachments?: MessageAttachment[] }) {
  return value.content.length > 0 || (value.attachments?.length ?? 0) > 0;
}

export const sendMessageSchema = z
  .object({
    content: z.string().trim().max(8000),
    attachments: attachmentsSchema.optional(),
  })
  .refine(hasSubstance, {
    message: 'Say something or attach a file',
    path: ['content'],
  });

export const chatSchema = z
  .object({
    content: z.string().trim().max(8000),
    attachments: attachmentsSchema.optional(),
    agentId: z.string().trim().min(1).max(40).optional(),
    channel: z.string().trim().min(1).max(32).default('webchat'),
    peerId: z.string().trim().min(1).max(80).optional(),
    sessionId: z.string().trim().min(1).optional(),
  })
  .refine(hasSubstance, {
    message: 'Say something or attach a file',
    path: ['content'],
  });

export const createMemorySchema = z.object({
  agentId: z.string().trim().min(1).max(40).optional(),
  kind: memoryKindSchema.default('preference'),
  body: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(80).optional(),
});

export const workspaceFileSchema = z.enum([
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'AGENTS.md',
  'MEMORY.md',
]);

export const updateWorkspaceSchema = z.object({
  file: workspaceFileSchema,
  content: z.string().max(32_000),
});

export const createTripSchema = z
  .object({
    agentId: z.string().trim().min(1).max(40).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    destination: z.string().trim().min(2).max(80),
    origin: z.string().trim().max(80).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    travelers: z.number().int().min(1).max(12).default(1),
    budgetCents: z.number().int().positive().max(100_000_000).optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .default('USD'),
    pace: paceSchema.default('steady'),
    interests: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const updateTripSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    destination: z.string().trim().min(2).max(80).optional(),
    origin: z.string().trim().max(80).nullable().optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    travelers: z.number().int().min(1).max(12).optional(),
    budgetCents: z.number().int().positive().max(100_000_000).nullable().optional(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    pace: paceSchema.optional(),
    status: tripStatusSchema.optional(),
    interests: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine(
    (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
    { message: 'endDate must be on or after startDate', path: ['endDate'] },
  );

export const planTripSchema = z.object({
  pace: paceSchema.optional(),
  interests: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
});

export type RequestOfferHoldInput = z.infer<typeof requestOfferHoldSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ChatInput = z.infer<typeof chatSchema>;
export type AttachmentInput = z.infer<typeof attachmentSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type PlanTripInput = z.infer<typeof planTripSchema>;
export type WorkspaceFileName = z.infer<typeof workspaceFileSchema>;
