/**
 * Local memory search (issue #6): ranking helpers for the FTS5 index over
 * `memory_notes`. Everything here is pure and synchronous — no embeddings, no
 * provider, no network. Search stays inside the same SQLite file as the notes.
 *
 * The two agents this desk is modelled on have already paid for these edge cases,
 * and the shapes below follow what they settled on:
 *
 * - OpenClaw (`extensions/memory-core/src/memory/keyword-query.ts`) never hands
 *   traveler text to the FTS5 parser. It extracts `[\p{L}\p{N}_]+` terms, sends
 *   each one as a quoted literal, and joins them itself, so `"`, `*`, `^`, `NEAR`,
 *   `(` or a lone `AND` can never become query syntax — all of which make FTS5
 *   throw. It maps BM25's negative rank into 0..1 and sorts with a comparator
 *   that ends in a stable key, so one query never returns two different orders.
 * - Hermes Agent needed several fixes to `session_search` (#15509, #16276,
 *   #16651, #88030) for two facts this repo's Node floor reproduces: FTS5's
 *   unicode61 tokenizer folds a run of ideographs into one token, so `迁移计划`
 *   never matches a note holding `我们讨论了数据库迁移计划`; and FTS5 ANDs its terms,
 *   so a paraphrased question misses a note that lacks a single word. The first
 *   is answered by an escaped `LIKE` scan, the second by an OR-joined retry.
 */

/** A title is the traveler's own words, so a title hit outweighs a body hit. */
export const TITLE_WEIGHT = 3;
export const BODY_WEIGHT = 1;

/** A whole sentence is a fine query, but it should not become a 200-term MATCH. */
export const MAX_QUERY_TERMS = 24;

/** Notes the desk learned twice as long ago are still worth surfacing. */
export const RECENCY_HALF_LIFE_DAYS = 90;
/** Recency may drop a score this far, never to zero: a preference does not expire. */
export const RECENCY_FLOOR = 0.6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Letters, digits, and `_`: everything FTS5 can be asked for, nothing it parses. */
const TERM = /[\p{L}\p{N}_]+/gu;

/**
 * Scripts unicode61 has no delimiter for. It keeps a run of these as one token, so
 * a query for part of the run can never match — those queries take the `LIKE` scan.
 */
const UNSEGMENTED =
  /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af]/;

export interface RankedNote {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface ScoredNote<T extends RankedNote> {
  note: T;
  /** BM25 mapped into 0..1 (or term coverage on the `LIKE` path). */
  relevance: number;
}

/**
 * The words to look for, in the order the traveler wrote them, de-duplicated so a
 * repeated word cannot outweigh a note that mentions two different things.
 * Returns `[]` for punctuation-only or empty input — the caller then has nothing
 * to search for and must not build a MATCH string.
 */
export function searchTerms(query: string, limit = MAX_QUERY_TERMS): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const found of query.match(TERM) ?? []) {
    const term = found.toLowerCase();
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= limit) break;
  }
  return terms;
}

/**
 * A MATCH string from terms this module produced. Each term is a quoted literal
 * with any stray quote removed, so the traveler's text stays data. `null` means
 * "no query", never "match nothing": FTS5 throws on an empty MATCH.
 */
export function buildMatchQuery(
  terms: readonly string[],
  join: 'AND' | 'OR',
): string | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replaceAll('"', '')}"`).join(` ${join} `);
}

/** True when part of the query is a script the FTS5 tokenizer cannot segment. */
export function hasUnsegmentedRun(text: string): boolean {
  return UNSEGMENTED.test(text);
}

/** Escape `%`, `_`, and the escape character itself for a `LIKE ... ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * FTS5 reports a better match as a more negative `bm25()`. Map that into 0..1 so
 * it can be multiplied by a recency factor; a non-negative rank scores nothing.
 */
export function bm25RankToScore(rank: number): number {
  if (!Number.isFinite(rank) || rank >= 0) return 0;
  const relevance = -rank;
  return relevance / (1 + relevance);
}

/**
 * Exponential decay with a floor (OpenClaw's temporal decay, bounded): a note from
 * today scores 1, one half-life old scores halfway to the floor, and nothing ever
 * reaches zero — an old preference is still a preference. A note dated in the
 * future (clock skew) counts as today; an unparseable stamp gets the floor.
 */
export function recencyFactor(createdAt: string, now: Date = new Date()): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return RECENCY_FLOOR;
  const ageDays = Math.max(0, (now.getTime() - created) / DAY_MS);
  const decay = Math.exp(-(Math.LN2 / RECENCY_HALF_LIFE_DAYS) * ageDays);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

/** Term coverage for the `LIKE` path, on the same title/body weighting as BM25. */
export function coverageRelevance(note: RankedNote, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const title = note.title.toLowerCase();
  const body = note.body.toLowerCase();
  let weight = 0;
  for (const term of terms) {
    if (title.includes(term)) weight += TITLE_WEIGHT;
    if (body.includes(term)) weight += BODY_WEIGHT;
  }
  return weight / (terms.length * (TITLE_WEIGHT + BODY_WEIGHT));
}

/**
 * Relevance first, recency second, and a fixed key after that so two notes with
 * the same score keep the same order on every call.
 */
export function compareScoredNotes<T extends RankedNote>(
  a: ScoredNote<T> & { score: number },
  b: ScoredNote<T> & { score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  return compareText(a.note.title, b.note.title) || compareText(a.note.id, b.note.id);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
