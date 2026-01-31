import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { authenticate } from './auth.js';
// Initialize Gmail client
let gmailClient = null;
async function getGmailClient() {
    if (!gmailClient) {
        const auth = await authenticate();
        gmailClient = google.gmail({ version: 'v1', auth });
    }
    return gmailClient;
}
// Create the MCP server
const server = new Server({
    name: 'gmail-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'search_mails',
                description: 'Search for emails in Gmail. Supports optional query string and label filtering.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Optional Gmail search query string (e.g., "from:example@gmail.com", "subject:meeting", "has:attachment"). See Gmail search operators for more options.',
                        },
                        label: {
                            type: 'string',
                            description: 'Optional label name to filter emails (e.g., "INBOX", "SENT", "UNREAD", or custom label name).',
                        },
                    },
                },
            },
        ],
    };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'search_mails') {
        try {
            const gmail = await getGmailClient();
            const query = args?.query;
            const label = args?.label;
            // Build the search query
            let searchQuery = '';
            if (query) {
                searchQuery = query;
            }
            if (label) {
                // If both query and label are provided, combine them
                if (searchQuery) {
                    searchQuery = `label:${label} ${searchQuery}`;
                }
                else {
                    searchQuery = `label:${label}`;
                }
            }
            // Search for messages
            const response = await gmail.users.messages.list({
                userId: 'me',
                q: searchQuery || undefined,
                maxResults: 50, // Limit to 50 results
            });
            const messages = response.data.messages || [];
            // Fetch full message details for each message
            const mailList = await Promise.all(messages.map(async (message) => {
                try {
                    const fullMessage = await gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full',
                    });
                    // Extract headers - handle both simple and multipart messages
                    const payload = fullMessage.data.payload;
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
                    const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
                        ?.value || '';
                    const snippet = fullMessage.data.snippet || '';
                    const labels = fullMessage.data.labelIds || [];
                    return {
                        id: message.id,
                        threadId: fullMessage.data.threadId,
                        subject: getHeader('Subject'),
                        from: getHeader('From'),
                        to: getHeader('To'),
                        date: getHeader('Date'),
                        snippet: snippet.substring(0, 200), // Limit snippet length
                        labels: labels,
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
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Gmail MCP server running on stdio');
}
main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
});
