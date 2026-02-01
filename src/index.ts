import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { authenticate } from './auth.js';
import { searchMailsbyLabelToolSchema, handleSearchMailsbyLabel } from './tools/search-mails.js';
import { searchMailsbyQueryToolSchema, handleSearchMailsbyQuery } from './tools/search-mails-query.js';
import { listUnsubscribeLinksToolSchema, handleListUnsubscribeLinks } from './tools/list-unsubscribe-links.js';
import { unsubscribeFromLinkToolSchema, handleUnsubscribeFromLink } from './tools/unsubscribe-from-link.js';

// Initialize Gmail client
let gmailClient: ReturnType<typeof google.gmail> | null = null;

async function getGmailClient() {
  if (!gmailClient) {
    const auth = await authenticate();
    gmailClient = google.gmail({ version: 'v1', auth });
  }
  return gmailClient;
}

// Create the MCP server
const server = new Server(
  {
    name: 'gmail-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [searchMailsbyLabelToolSchema, searchMailsbyQueryToolSchema, listUnsubscribeLinksToolSchema, unsubscribeFromLinkToolSchema],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'search_mails_tool') {
    const gmail = await getGmailClient();
    return handleSearchMailsbyLabel(
      args as { label: string },
      gmail
    );
  }

  if (name === 'search_mails_by_query_tool') {
    const gmail = await getGmailClient();
    return handleSearchMailsbyQuery(
      args as { query: string },
      gmail
    );
  }

  if (name === 'list_unsubscribe_links_tool') {
    const gmail = await getGmailClient();
    return handleListUnsubscribeLinks(
      args as { query: string; maxResults?: number; pageToken?: string },
      gmail
    );
  }

  if (name === 'unsubscribe_from_list_unsubscribe_header') {
    const gmail = await getGmailClient();
    return handleUnsubscribeFromLink(
      args as { listUnsubscribeHeader: string; debug?: boolean; timeout?: number },
      gmail
    );
  }

  throw new McpError(
    ErrorCode.MethodNotFound,
    `Unknown tool: ${name}`
  );
});

// Start the server
async function main() {
  // Initialize Gmail client on startup
  console.log('Initializing Gmail client...');
  await getGmailClient();
  console.log('Gmail client initialized successfully');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('Gmail MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
