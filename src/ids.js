/**
 * Identifier generation. Uses crypto.randomUUID when available (browsers,
 * secure contexts, Node >= 16), otherwise a reasonably unique fallback.
 */

export function uuid() {
  const c = typeof crypto !== 'undefined' && crypto.randomUUID;
  if (c) return crypto.randomUUID();
  // Fallback (RFC 4122 v4) for older / insecure contexts.
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Short id for internal references (correlation ids, request ids). */
export function shortId(prefix = '') {
  return prefix + uuid().replace(/-/g, '').slice(0, 12);
}
