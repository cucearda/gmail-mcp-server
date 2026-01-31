/**
 * Extracts headers from a Gmail message payload
 * Handles both simple and multipart messages
 */
export function extractHeaders(payload) {
    let headers = [];
    if (payload?.headers) {
        headers = payload.headers;
    }
    else if (payload?.parts) {
        // For multipart messages, get headers from the first part
        const firstPart = payload.parts.find((p) => p.headers);
        if (firstPart?.headers) {
            headers = firstPart.headers;
        }
    }
    return headers;
}
/**
 * Gets a header value by name (case-insensitive)
 */
export function getHeader(headers, name) {
    return (headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
        '');
}
