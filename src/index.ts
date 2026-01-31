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
import { searchMailsToolSchema, handleSearchMails } from './tools/search-mails.js';

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
    tools: [searchMailsToolSchema],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'search_mails_tool') {
    const gmail = await getGmailClient();
    return handleSearchMails(
      args as { query?: string; label?: string },
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Gmail MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
