import { z } from 'zod';

/**
 * Browser wire contracts. Only the isolated worker executes these actions; the
 * gateway binds ownership and never accepts model-supplied session credentials.
 */
const webUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an HTTP(S) URL without embedded credentials');

const opaqueRef = z.string().min(1).max(128);
const visibleText = z.string().trim().min(1).max(2000);

export const browserHandoffReasonSchema = z.enum([
  'sign_in',
  'verification',
  'consent',
  'missing_information',
  'ambiguous_form',
  'site_restriction',
  'network_restriction',
  'action_limit',
  'time_limit',
  'page_limit',
  'stale_snapshot',
  'invalid_action',
  'worker_unavailable',
  'model_unavailable',
  'cancelled',
]);

/**
 * No evaluate, shell, arbitrary selectors, file upload/download or checkout tool.
 * Element refs are issued by inspection, bound to a snapshot, and must be checked
 * by the executor. The authenticated owner/session is NEVER a model argument.
 */
export const browserActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: webUrl }).strict(),
  z.object({ action: z.literal('inspect') }).strict(),
  z
    .object({
      action: z.literal('fill'),
      snapshotId: opaqueRef,
      elementId: opaqueRef,
      value: z.string().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('select'),
      snapshotId: opaqueRef,
      elementId: opaqueRef,
      value: z.string().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal('click'),
      snapshotId: opaqueRef,
      elementId: opaqueRef,
    })
    .strict(),
  z
    .object({
      action: z.literal('handoff'),
      reason: browserHandoffReasonSchema,
      message: visibleText,
    })
    .strict(),
  z
    .object({
      action: z.literal('observe'),
      snapshotId: opaqueRef,
      title: visibleText,
      displayedPrice: z.string().trim().min(1).max(160),
      displayedCurrency: z.string().trim().min(1).max(32),
      visibleConditions: z.array(visibleText).max(20),
      evidence: z.string().trim().min(10).max(2000),
    })
    .strict(),
  z.object({ action: z.literal('stop') }).strict(),
]);

/**
 * A distinct research result, never an OfferRecord or a provider hold input.
 * Preserve the displayed price/currency literally ("$" must not become "USD"
 * by guessing). Empty conditions means none were visible, not "no restrictions".
 * The executor must attach URL, timestamp and snapshot evidence; schema validation
 * alone cannot prove that the page displayed a model-proposed price.
 */
export const browserObservationSchema = z
  .object({
    kind: z.literal('browser_observation'),
    travelKind: z.enum(['flight', 'stay']),
    sourceName: z.string().trim().min(1).max(160),
    sourceUrl: webUrl,
    observedAt: z.string().datetime({ offset: true }),
    snapshotId: opaqueRef,
    title: visibleText,
    displayedPrice: z.string().trim().min(1).max(160),
    displayedCurrency: z.string().trim().min(1).max(32),
    visibleConditions: z.array(visibleText).max(20),
    verification: z.literal('page_observed'),
    bookingEligibility: z.literal('not_bookable'),
  })
  .strict();

export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserObservation = z.infer<typeof browserObservationSchema>;
export type BrowserHandoffReason = z.infer<typeof browserHandoffReasonSchema>;

export const browserSiteSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,50}$/),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(['flight', 'stay']),
    startUrl: webUrl,
    /** Exact authorized origins; no wildcard or inferred sibling hosts. */
    origins: z.array(webUrl).min(1).max(20),
    /** Only explicitly authorized search POST paths; all other writes are blocked. */
    searchPostPaths: z
      .array(
        z
          .string()
          .regex(/^\/[^?#]*$/)
          .max(500),
      )
      .max(20)
      .default([]),
  })
  .strict();
export type BrowserSite = z.infer<typeof browserSiteSchema>;

export const browserSnapshotSchema = z
  .object({
    trust: z.literal('untrusted_page_content'),
    id: opaqueRef,
    url: webUrl,
    observedAt: z.string().datetime(),
    text: z.string().max(16000),
    elements: z
      .array(
        z
          .object({
            id: opaqueRef,
            role: z.string().max(40),
            label: z.string().max(200),
            value: z.string().max(500).optional(),
            options: z
              .array(z.object({ value: z.string().max(500), label: z.string().max(200) }))
              .max(100)
              .optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

/** Finite, non-personal vocabulary: learned procedures cannot carry values or code. */
export const browserWorkflowStepSchema = z.enum([
  'navigate_start',
  'inspect',
  'fill_origin',
  'fill_destination',
  'fill_departure_date',
  'fill_return_date',
  'fill_check_in',
  'fill_check_out',
  'fill_travelers',
  'fill_currency',
  'fill_language',
  'click_search',
  'observe',
]);
export const browserProcedureSchema = z
  .object({
    version: z.literal(1),
    siteId: z.string().regex(/^[a-z0-9-]{1,50}$/),
    origin: webUrl.refine((url) => {
      try {
        return new URL(url).origin === url;
      } catch {
        return false;
      }
    }),
    steps: z.array(browserWorkflowStepSchema).min(2).max(20),
  })
  .strict();
export type BrowserProcedure = z.infer<typeof browserProcedureSchema>;

export const browserStepResultSchema = z
  .object({
    status: z.enum(['ready', 'observed', 'handoff', 'stopped']),
    reason: browserHandoffReasonSchema.optional(),
    message: z.string().max(2000),
    snapshot: browserSnapshotSchema.optional(),
    procedureCandidate: browserProcedureSchema.optional(),
    observation: browserObservationSchema
      .extend({ evidence: z.string().min(10).max(2000) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.status === 'observed') !== Boolean(value.observation) ||
      (value.procedureCandidate && value.status !== 'observed') ||
      (value.status === 'ready' && !value.snapshot)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Browser result status does not match its evidence.',
      });
    }
  });
export type BrowserStepResult = z.infer<typeof browserStepResultSchema>;

export interface BrowserRunRecord {
  status: 'running' | 'observed' | 'handoff' | 'stopped';
  reason?: BrowserHandoffReason;
  message: string;
  sourceUrl?: string;
  steps: Array<{ action: string; at: string; status: string }>;
  observations: Array<BrowserObservation & { evidence: string }>;
}
