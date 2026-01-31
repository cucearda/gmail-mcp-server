import {
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';

// Tool schema definition
export const searchMailsToolSchema = {
  name: 'search_mails_tool',
  description:
    'Search for emails in Gmail by label.',
  inputSchema: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description:
          'Label name to filter emails (e.g., "INBOX", "SENT", "UNREAD", "PROMOTIONS", or custom label name).',
      },
    },
    required: ['label'],
  },
};

// Tool handler implementation
export async function handleSearchMails(
  args: { label: string },
  gmailClient: ReturnType<typeof google.gmail>
) {
  try {
    // Search for messages
    const response = await gmailClient.users.messages.list({
      userId: 'me',
      q: `label:${args.label}`,
      maxResults: 50, // Limit to 50 results
    });

    const messages = response.data.messages || [];

    // Fetch full message details for each message
    const mailList = await Promise.all(
      messages.map(async (message) => {
        try {
          const fullMessage = await gmailClient.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: 'full',
          });

          // Extract headers - handle both simple and multipart messages
          const payload = fullMessage.data.payload;
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
          
          const getHeader = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
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
        } catch (error) {
          console.error(`Error fetching message ${message.id}:`, error);
          return {
            id: message.id,
            error: 'Failed to fetch message details',
          };
        }
      })
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: mailList.length,
              mails: mailList,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search mails: ${errorMessage}`
    );
  }
}
