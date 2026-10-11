/**
 * Force-redaction of browser-originated text.
 *
 * A snapshot is the only data in this worker that comes from somewhere the
 * operator does not control, and it crosses a model boundary on its way out: into
 * a tool result, a task row, and a prompt. So redaction here is a property of the
 * boundary rather than of any logging configuration — there is deliberately no
 * switch that turns it off. Hermes reaches the same conclusion for the same
 * reason (`_redact_browser_output`: "Tool output is a model boundary, so this
 * applies even when global log redaction is disabled").
 *
 * Two things this is for:
 *
 * 1. **A page that renders a secret.** A confirmation page, a debug footer, or an
 *    injected block can carry a key, a token, or a certificate. Exact-quote
 *    evidence means the model would otherwise repeat it verbatim.
 * 2. **A booking page that renders the traveler.** Once the worker stands on a
 *    passenger-details form, control values are the traveler's own contact
 *    details. Those are not the operator's to store in a task row.
 *
 * The bias is deliberately toward over-redaction. A page has no legitimate reason
 * to show a 13-to-19-digit run or an email address to a fare search, and losing a
 * number that was never meaningful costs nothing, while leaking one is not
 * recoverable. What this must not do is damage ordinary fare text, so the digit
 * rule needs a long unbroken run and the others need unambiguous shape.
 */

/**
 * Card-length digit runs: 13 to 19 digits, optionally spaced or dashed one digit
 * per separator the way a card is written.
 *
 * The separator is deliberately restrictive. A looser `[ -]?` per digit lets the
 * pattern run straight through an ISO date and into whatever digits follow it —
 * `Departs 2026-11-02 at 08:00` is 12 digits once the dashes and the `at 0` are
 * absorbed, and redacting a departure date would break the very evidence the desk
 * exists to quote. Anchored separators, plus a lookahead that refuses to end on a
 * separator, keep this to things shaped like a card.
 */
const DIGIT_RUN = /\b\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b(?![-\d])/g;
const EMAIL = /\b[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+\b/g;
/** Three base64url segments — an access token, whatever issued it. */
const JWT = /\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}\b/g;
const BEARER = /\b(bearer|basic|token|api[-_ ]?key)\s+[A-Za-z0-9._~+/=-]{16,}/gi;
const CLOUD_KEY =
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bsk-(?:live|test)-[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g;
const PRIVATE_KEY =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
/**
 * A phone number long enough to be one, with or without a leading +.
 *
 * A hyphen is deliberately not a separator here. With one, `2026-11-02` reads as
 * a ten-character phone number and every ISO date on the page gets redacted. The
 * cost is that a hyphenated number such as `+1-800-555-0199` is missed, which is
 * the right trade: a missed phone number on a page the traveler can see is a
 * smaller loss than a departure date the desk can no longer quote.
 */
const PHONE = /\+?\d[\d ().]{7,17}\d/g;

export const REDACTION_MARK = '[redacted]';

/**
 * Redact secrets and personal contact details out of page-derived text.
 *
 * Applied to snapshot text, control labels and values, and observation evidence
 * before any of them is parsed into a wire shape. Idempotent: redacting an
 * already-redacted string changes nothing.
 */
export function redactBrowserText(value: string): string {
  if (!value) return value;
  return value
    .replace(PRIVATE_KEY, REDACTION_MARK)
    .replace(JWT, REDACTION_MARK)
    .replace(CLOUD_KEY, REDACTION_MARK)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTION_MARK}`)
    .replace(EMAIL, REDACTION_MARK)
    .replace(DIGIT_RUN, REDACTION_MARK)
    .replace(PHONE, REDACTION_MARK);
}

/**
 * True when redaction changed the string.
 *
 * Used to keep a refusal honest: when the model proposes evidence that differs
 * from the page only because something in it was redacted, the answer is "that
 * could not be verified", not a silent substitution.
 */
export function containsRedactable(value: string): boolean {
  return Boolean(value) && redactBrowserText(value) !== value;
}
