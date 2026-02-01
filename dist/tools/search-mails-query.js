import { ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { extractHeaders, getHeader } from '../utility.js';
// Tool schema definition
export const searchMailsbyQueryToolSchema = {
    name: 'search_mails_by_query_tool',
    description: 'Search for emails in Gmail by query.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Gmail search query (e.g., "from:example.com", "subject:newsletter", or any Gmail search syntax).',
            },
        },
        required: ['query'],
    },
};
// Tool handler implementation
export async function handleSearchMailsbyQuery(args, gmailClient) {
    try {
        // Search for messages
        const response = await gmailClient.users.messages.list({
            userId: 'me',
            q: args.query,
            maxResults: 50, // Limit to 50 results
        });
        const messages = response.data.messages || [];
        // Fetch full message details for each message
        const mailList = await Promise.all(messages.map(async (message) => {
            try {
                const fullMessage = await gmailClient.users.messages.get({
                    userId: 'me',
                    id: message.id,
                    format: 'full',
                });
                // Extract headers - handle both simple and multipart messages
                const payload = fullMessage.data.payload;
                const headers = extractHeaders(payload);
                // Extract raw body - handle both simple and multipart messages
                let rawBody = '';
                if (payload?.body?.data) {
                    // Simple message
                    rawBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
                }
                else if (payload?.parts) {
                    // Multipart message - extract body from text/plain or text/html parts
                    const extractBodyFromPart = (part) => {
                        if (part.body?.data) {
                            return Buffer.from(part.body.data, 'base64').toString('utf-8');
                        }
                        if (part.parts) {
                            // Recursively check nested parts
                            for (const subPart of part.parts) {
                                const body = extractBodyFromPart(subPart);
                                if (body)
                                    return body;
                            }
                        }
                        return '';
                    };
                    // Try to find text/plain first, then text/html
                    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain' || p.mimeType === 'text/html') || payload.parts[0];
                    rawBody = extractBodyFromPart(textPart);
                }
                const snippet = fullMessage.data.snippet || '';
                const labels = fullMessage.data.labelIds || [];
                return {
                    id: message.id,
                    threadId: fullMessage.data.threadId,
                    subject: getHeader(headers, 'Subject'),
                    from: getHeader(headers, 'From'),
                    to: getHeader(headers, 'To'),
                    date: getHeader(headers, 'Date'),
                    body: getHeader(headers, 'Body'),
                    snippet: snippet.substring(0, 200), // Limit snippet length
                    labels: labels,
                    headersRaw: headers,
                    bodyRaw: rawBody,
                };
            }
            catch (error) {
                console.error(`Error fetching message ${message.id}:`, error);
                return {
                    id: message.id,
                    error: 'Failed to fetch message details',
                };
            }
        }));
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        count: mailList.length,
                        mails: mailList,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, `Failed to search mails: ${errorMessage}`);
    }
}
