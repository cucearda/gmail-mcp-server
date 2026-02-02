// Tool schema definition
export const searchMailsbyQueryToolSchema = {
    name: 'search_mails_by_query_tool',
    description: 'Search for emails in Gmail by query. You can use this tool to find any information about the emails that match the query. For example newsletters, promotions etc.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Gmail search query (e.g., "from:example.com", "subject:newsletter", or any Gmail search syntax).',
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return.',
                default: 10,
            },
        },
        required: ['query'],
    },
};
// Tool handler implementation
export async function handleSearchMailsbyQuery(args, gmailClient) {
    const response = await gmailClient.users.messages.list({
        userId: 'me',
        q: args.query,
        maxResults: args.maxResults || 10,
    });
    const messages = response.data.messages || [];
    const results = await Promise.all(messages.map(async (msg) => {
        const detail = await gmailClient.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers = detail.data.payload?.headers || [];
        return {
            id: msg.id,
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            from: headers.find(h => h.name === 'From')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
        };
    }));
    return {
        content: [
            {
                type: "text",
                text: results.map(r => `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}\n`).join('\n'),
            },
        ],
    };
}
