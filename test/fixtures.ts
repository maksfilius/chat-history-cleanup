import { createHash } from 'node:crypto';

/** Deterministic synthetic UUIDs; no real account identifiers in test fixtures. */
export function chatId(label: string | number): string {
  const hex = createHash('sha256').update(String(label)).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
