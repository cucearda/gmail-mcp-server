import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { authenticate } from './auth.js';
import { searchMailsbyQueryToolSchema, handleSearchMailsbyQuery } from './tools/search-mails-query.js';
import { listUnsubscribeLinksToolSchema, handleListUnsubscribeLinks } from './tools/list-unsubscribe-links.js';
import { unsubscribeFromLinkToolSchema, handleUnsubscribeFromLink } from './tools/unsubscribe-from-unsubscribe-header.js';
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
        tools: [searchMailsbyQueryToolSchema, listUnsubscribeLinksToolSchema, unsubscribeFromLinkToolSchema],
    };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'search_mails_by_query_tool') {
        const gmail = await getGmailClient();
        return handleSearchMailsbyQuery(args, gmail);
    }
    if (name === 'list_unsubscribe_links_tool') {
        const gmail = await getGmailClient();
        return handleListUnsubscribeLinks(args, gmail);
    }
    if (name === 'unsubscribe_from_list_unsubscribe_header') {
        const gmail = await getGmailClient();
        return handleUnsubscribeFromLink(args, gmail);
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});
// Start the server
async function main() {
    // Initialize Gmail client on startup
    console.log('Initializing Gmail client...');
    await getGmailClient();
    console.log('Gmail client initialized successfully');
    const transportType = process.env.MCP_TRANSPORT || 'stdio';
    const port = parseInt(process.env.MCP_PORT || '3000', 10);
    if (transportType === 'http') {
        // HTTP transport for debugging
        const transport = new StreamableHTTPServerTransport();
        const app = createMcpExpressApp();
        // Connect server to transport (this sets up bidirectional message handling)
        await server.connect(transport);
        // Handle all requests to /mcp endpoint
        app.post('/mcp', async (req, res) => {
            await transport.handleRequest(req, res, req.body);
        });
        app.get('/mcp', async (req, res) => {
            await transport.handleRequest(req, res);
        });
        app.listen(port, () => {
            console.log(`Gmail MCP server running on HTTP at http://localhost:${port}/mcp`);
            console.log(`Connect MCP Inspector to: http://localhost:${port}/mcp`);
        });
    }
    else {
        // Stdio transport (default for production)
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.log('Gmail MCP server running on stdio');
    }
}
main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
});
