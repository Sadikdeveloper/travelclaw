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
  // A booking-tier control was reached without the traveler's recorded approval.
  // Distinct from the others because nothing is wrong with the page: the desk is
  // waiting on a human, and the same action becomes valid once they approve.
  'confirmation_required',
  /**
   * The traveler's authorization changed while this run was in flight — they
   * withdrew the approval, it expired, or a newer approval superseded it. The run
   * is voided rather than merely stopped, because a result produced under a
   * withdrawn authorization must not be trusted or reported: the page may already
   * be showing their details, so reads are refused too, not just writes.
   */
  'human_has_control',
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
      action: z.literal('fillMany'),
      snapshotId: opaqueRef,
      /**
       * Several fields in one action, as two parallel arrays: the control refs
       * from the current snapshot, and the value for each, in the same order.
       *
       * Parallel arrays rather than one array of objects because the model-facing
       * JSON Schema for a tool argument is generated from this shape, and that
       * generator deliberately supports only flat types — an object array would
       * fail at import rather than describe itself.
       *
       * Bounded because a whole passenger form in one call is the point and an
       * unbounded list is not. Validated all-or-nothing: one field that fails
       * grounding fills nothing, so a batch can never leave a form part-filled
       * and looking complete.
       */
      elementIds: z.array(opaqueRef).min(1).max(12),
      /**
       * One value per control, in the same order. The lengths must match; that
       * cannot be a schema refinement here, because a refined object stops being
       * a discriminated-union option and the whole action union would fail to
       * build. The executor refuses a mismatched pair instead.
       */
      values: z.array(z.string().max(500)).min(1).max(12),
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
 * What the source page exposes, stated as a fact about the page and nothing else.
 *
 * It used to be the literal `'not_bookable'`, which was correct only because the
 * worker could not reach a booking step. That is no longer true, and a literal
 * would have made the new fact unrepresentable rather than false — the opposite
 * of the reason it was a literal.
 *
 * So the invariant moved from the value to the vocabulary: every value here
 * describes what the page showed, and none of them can say that anything was
 * reserved, held, priced, or paid for. There is deliberately no `booked` value.
 */
export const bookingEligibilitySchema = z.enum([
  /** No passenger-details step was visible in this session's snapshot. */
  'no_booking_step_seen',
  /**
   * A passenger-details step was visible but this session may not reach it: the
   * operator gave the site no booking scope, or the traveler's confirmation was
   * not recorded. Nothing was wrong with the page.
   */
  'booking_step_blocked',
  /**
   * A passenger-details step was visible and this session was authorized to act
   * on it. That is a statement about the page and the session's scope — not that
   * anything was filled, submitted, or reserved.
   */
  'booking_step_reachable',
]);
export type BookingEligibility = z.infer<typeof bookingEligibilitySchema>;

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
    bookingEligibility: bookingEligibilitySchema,
  })
  .strict();

/**
 * What a site reliably does to a browser run, as a fact about the site.
 *
 * Procedures record the shape of a run that *worked*. These record what stopped
 * one, so the desk stops rediscovering the same wall on every attempt.
 *
 * A finite vocabulary for the same reason the procedure steps are finite: the
 * blocker is named by the worker, never quoted from the page, so no page text can
 * become a durable claim about a site.
 */
export const browserSiteNoteKindSchema = z.enum([
  'consent_wall',
  'sign_in_wall',
  'human_verification',
  'refused_access',
  'content_too_large',
]);
export type BrowserSiteNoteKind = z.infer<typeof browserSiteNoteKindSchema>;

/**
 * How the blocker was detected, which decides how much a note may be trusted.
 *
 * `worker_observed` is structural: a real browser dialog, a visible password
 * field, an HTTP 401/403/429. `page_claimed` means it matched a pattern in the
 * page's own text — which a page can plant on purpose to leave a false, durable
 * claim about itself behind. Those are quarantined until an operator approves
 * them, and the card says which of the two an operator is looking at.
 */
export const browserNoteOriginSchema = z.enum(['worker_observed', 'page_claimed']);
export type BrowserNoteOrigin = z.infer<typeof browserNoteOriginSchema>;

/**
 * The handoff reasons that are facts about a site rather than about our own
 * budget, the operator's authorization, or the traveler's request. Only these
 * become notes; `time_limit`, `action_limit` and `network_restriction` describe
 * TravelClaw, and `missing_information` describes the traveler.
 */
export const SITE_NOTE_REASONS: Partial<
  Record<BrowserHandoffReason, { kind: BrowserSiteNoteKind; origin: BrowserNoteOrigin }>
> = {
  // Structural: a real dialog event, or a visible password input.
  sign_in: { kind: 'sign_in_wall', origin: 'worker_observed' },
  // Structural: HTTP 401/403/429, a popup window, or a forced download.
  site_restriction: { kind: 'refused_access', origin: 'worker_observed' },
  page_limit: { kind: 'content_too_large', origin: 'worker_observed' },
  // Both of these can also come from a regex over page text, and the gateway
  // cannot tell which it was from the reason alone. So they are recorded as
  // page-claimed: when in doubt, the untrusted origin is the one that sticks.
  consent: { kind: 'consent_wall', origin: 'page_claimed' },
  verification: { kind: 'human_verification', origin: 'page_claimed' },
};

export const browserSiteNoteSchema = z
  .object({
    id: z.string().max(64),
    siteId: z.string().regex(/^[a-z0-9-]{1,50}$/),
    origin: webUrl.refine((url) => {
      try {
        return new URL(url).origin === url;
      } catch {
        return false;
      }
    }),
    kind: browserSiteNoteKindSchema,
    noteOrigin: browserNoteOriginSchema,
    /** How many runs hit this. Bounded by the enum, so the table cannot grow. */
    runs: z.number().int().min(1).max(100000),
    reviewStatus: z.enum(['pending', 'approved', 'rejected']),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    reviewedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BrowserSiteNote = z.infer<typeof browserSiteNoteSchema>;

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
    /**
     * Paths where a booking-tier control may be reached, granted per site by the
     * operator. Empty means the site is search-only and the booking tier stays
     * closed, which is the default and the previous behaviour.
     *
     * Two things this cannot grant, by construction: a payment path (the network
     * policy refuses `checkout`, `payment`, `creditcard`, `login`, `password`,
     * and `authorization` regardless of what is listed here) and a session that
     * is not carrying the traveler's own recorded confirmation.
     */
    bookingPaths: z
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
  // Booking-tier slots. They exist so a booking flow is describable in the same
  // finite vocabulary, but the engine never proposes a procedure for a booking
  // run: a booking depends on one traveler's details, and a procedure is shared.
  'fill_passenger_name',
  'fill_contact_email',
  'fill_contact_phone',
  'click_submit_booking',
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
  /**
   * Which authorized site this run opened, once a lease exists. The traveler's
   * booking approval is bound to it, so approving one site's form cannot be
   * replayed against another — and the UI can name the site it is asking about.
   */
  siteId?: string;
  /** Its display name, so an approval card can name the site in words. */
  siteName?: string;
  /**
   * This run was opened with the traveler's approval, so it may fill their
   * details. The UI uses it to offer a withdrawal while the run is live.
   */
  booking?: boolean;
  steps: Array<{ action: string; at: string; status: string }>;
  observations: Array<BrowserObservation & { evidence: string }>;
}

/**
 * The traveler's recorded go-ahead for one browser run to fill their details on
 * one site. This is the only thing that can set `bookingConfirmed`; no caller
 * argument can assert it.
 *
 * It is deliberately narrow: one run, one site, one epoch, ten minutes, spent by
 * the first run that uses it. A second run needs a fresh approval.
 */
export const bookingConfirmationSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().max(64),
    taskId: z.string().max(64),
    siteId: z.string().regex(/^[a-z0-9-]{1,50}$/),
    /**
     * Random per approval. The gateway and the worker both carry it, so a
     * confirmation recorded *after* a run started can never be mistaken for the
     * one that run was authorized by.
     */
    epoch: z.string().uuid(),
    /** What was approved, in plain words the traveler can read back later. */
    summary: z.string().trim().min(1).max(400),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    /** The run that spent this approval, once one has. */
    consumedBy: z.string().max(64).nullable(),
  })
  .strict();
export type BookingConfirmation = z.infer<typeof bookingConfirmationSchema>;

/**
 * The approval request. `confirm: z.literal(true)` is required, following the
 * provider-hold endpoint: a generic POST or a stale link must not be able to
 * become an authorization to fill someone's personal details.
 */
export const requestBookingConfirmationSchema = z
  .object({ confirm: z.literal(true) })
  .strict();
