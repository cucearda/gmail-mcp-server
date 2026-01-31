import { gmail_v1 } from 'googleapis';

/**
 * Extracts headers from a Gmail message payload
 * Handles both simple and multipart messages
 */
export function extractHeaders(
  payload: gmail_v1.Schema$MessagePart | undefined
): Array<{ name?: string | null; value?: string | null }> {
  let headers: Array<{ name?: string | null; value?: string | null }> = [];

  if (payload?.headers) {
    headers = payload.headers;
  } else if (payload?.parts) {
    // For multipart messages, get headers from the first part
    const firstPart = payload.parts.find((p: any) => p.headers);
    if (firstPart?.headers) {
      headers = firstPart.headers;
    }
  }

  return headers;
}

/**
 * Gets a header value by name (case-insensitive)
 */
export function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  return (
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ''
  );
}
