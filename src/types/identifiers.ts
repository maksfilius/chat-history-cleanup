/** Stable server conversation identifiers; optimistic WEB: IDs and URL fragments are rejected. */
export const isConversationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export function requireConversationId(value: unknown): string {
  if (!isConversationId(value)) throw new Error('Invalid conversation identifier');
  return value;
}

export const isProjectId = (value: unknown): value is string =>
  typeof value === 'string' && /^g-p-[A-Za-z0-9_-]+$/.test(value);
