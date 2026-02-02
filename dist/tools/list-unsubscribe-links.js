import { ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { extractHeaders, getHeader } from '../utility.js';
// Tool schema definition
export const listUnsubscribeLinksToolSchema = {
    name: 'list_unsubscribe_links_tool',
    description: 'Search for emails in Gmail and return their List-Unsubscribe headers. Use this tool to find the List-Unsubscribe header of an email and then use the unsubscribe_from_list_unsubscribe_header tool to unsubscribe from the email.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: `Gmail search query (e.g., "from:example.com", "subject:newsletter", "label:promotions", or any Gmail search syntax).
        If you want to search for emails with a specific label, you can use the label:label_name syntax.
        If you want to search for emails with a specific sender, you can use the from:sender_email syntax.
        If you want to search for emails with a specific subject, you can use the subject:subject_text syntax.
        If you want to search for emails with a specific date, you can use the date:date_range syntax.
        If you want to search for emails with a specific body, you can use the body:body_text syntax.
        If you want to search for emails with a specific attachment, you can use the has:attachment syntax.
        If you want to search for emails with a specific sender, you can use the from:sender_email syntax.
        If you want to search for emails with a specific subject, you can use the subject:subject_text syntax.
        If you want to search for emails with a specific date, you can use the date:date_range syntax.

        Commonly Used Examples:
        - "from:example.com"
        - "subject:newsletter"
        - "label:promotions"
        - "from:example.com"
        - "subject:newsletter"
        - "label:promotions"
        - "from:example.com"
        - "subject:newsletter"
        }`,
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return (default: 50).',
            },
            pageToken: {
                type: 'string',
                description: 'Page token to retrieve the next page of results. Use the nextPageToken from the previous response to get older emails.',
            },
        },
        required: ['query'],
    },
};
// Tool handler implementation
export async function handleListUnsubscribeLinks(args, gmailClient) {
    try {
        // Search for messages
        const response = await gmailClient.users.messages.list({
            userId: 'me',
            q: args.query,
            maxResults: args.maxResults || 50,
            pageToken: args.pageToken,
        });
        const messages = response.data.messages || [];
        // Fetch full message details for each message
        const unsubscribeList = await Promise.all(messages.map(async (message) => {
            try {
                const fullMessage = await gmailClient.users.messages.get({
                    userId: 'me',
                    id: message.id,
                    format: 'full',
                });
                // Extract headers
                const payload = fullMessage.data.payload;
                const headers = extractHeaders(payload);
                const listUnsubscribe = getHeader(headers, 'List-Unsubscribe');
                return {
                    id: message.id,
                    threadId: fullMessage.data.threadId,
                    subject: getHeader(headers, 'Subject'),
                    from: getHeader(headers, 'From'),
                    listUnsubscribe: listUnsubscribe,
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
                        count: unsubscribeList.length,
                        unsubscribeLinks: unsubscribeList,
                        nextPageToken: response.data.nextPageToken || null,
                        hasMore: !!response.data.nextPageToken,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(ErrorCode.InternalError, `Failed to list unsubscribe links: ${errorMessage}`);
    }
}
