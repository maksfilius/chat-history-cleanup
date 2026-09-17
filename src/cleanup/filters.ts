import type { Conversation } from '../types/conversation.ts';
import { daysSince } from './age.ts';
import { protectionMap } from './protections.ts';

/**
 * A rule returns the reason it matched, or null. Matching and explaining are one function on
 * purpose: a separate `explain()` drifts away from the condition it is supposed to describe,
 * and the UI has to justify every suggestion.
 */
export interface CleanupRule {
  key: string;
  label: string;
  describe(c: Conversation, now: number): string | null;
}

export const AGE_PRESETS = [30, 90, 180, 365] as const;

const ageLabel = (days: number) =>
  days === 365 ? 'Older than 1 year' : `Older than ${days} days`;

export const olderThan = (days: number): CleanupRule => ({
  key: `age-${days}`,
  label: ageLabel(days),
  describe(c, now) {
    const d = daysSince(c.updatedAt, now);
    // Unknown age never matches. Fail safe: we do not guess that a chat is old.
    if (d === undefined || d < days) return null;
    return `last active ${d} days ago`;
  },
});

/**
 * Empty title. ChatGPT titles a conversation as soon as it has content, so a blank title is
 * an abandoned/empty chat. Deterministic when it occurs — though no such chat existed on the
 * account used for verification, so this rule is unproven in the wild.
 */
export const untitled: CleanupRule = {
  key: 'untitled',
  label: 'Untitled',
  describe: (c) => (c.title.trim() === '' ? 'never given a title' : null),
};

export const ageRules = AGE_PRESETS.map(olderThan);
export const allRules = [...ageRules, untitled];

/**
 * Candidates for the active rules, deduplicated: a conversation matched by several rules
 * appears once, carrying every reason it was suggested.
 */
export function candidates(
  conversations: readonly Conversation[],
  rules: readonly CleanupRule[],
  now = Date.now(),
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of conversations) {
    // Age presets nest ("older than 30" also matches "older than 90"), so identical reasons
    // are deduped too — the user should not read the same sentence twice.
    const reasons = [
      ...new Set(rules.map((r) => r.describe(c, now)).filter((r): r is string => r !== null)),
    ];
    if (reasons.length) out.set(c.id, reasons);
  }
  return out;
}

/** How many conversations one rule would suggest on its own, for the rule's count badge. */
export const ruleCount = (
  conversations: readonly Conversation[],
  rule: CleanupRule,
  now = Date.now(),
) => conversations.filter((c) => rule.describe(c, now) !== null).length;

export interface ReviewSet {
  /** id -> reasons it was suggested. Protected conversations are already excluded. */
  suggested: Map<string, string[]>;
  /** id -> reason it is protected. */
  protected: Map<string, string>;
}

/**
 * The single choke point where cleanup rules meet protections. Rules propose, protections
 * dispose — a protected conversation can never end up in `suggested`, whatever the rules say.
 *
 */
export function reviewSet(
  conversations: readonly Conversation[],
  rules: readonly CleanupRule[],
  manual: ReadonlySet<string>,
  now = Date.now(),
): ReviewSet {
  const prot = protectionMap(conversations, manual);
  const suggested = candidates(conversations, rules, now);
  for (const id of prot.keys()) suggested.delete(id);
  return { suggested, protected: prot };
}
