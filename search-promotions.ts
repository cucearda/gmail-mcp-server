import { google } from 'googleapis';
import { authenticate } from './src/auth.js';

async function searchPromotionsEmails() {
  try {
    // Authenticate and get Gmail client
    const auth = await authenticate();
    const gmail = google.gmail({ version: 'v1', auth });

    // Search for emails with PROMOTIONS label
    const searchQuery = 'label:PROMOTIONS';
    
    console.log('Searching for emails with PROMOTIONS label...');
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults: 50, // Limit to 50 results
    });

    const messages = response.data.messages || [];
    console.log(`Found ${messages.length} emails with PROMOTIONS label\n`);

    if (messages.length === 0) {
      console.log('No emails found with the PROMOTIONS label.');
      return;
    }

    // Fetch full message details for each message
    const mailList = await Promise.all(
      messages.map(async (message) => {
        try {
          const fullMessage = await gmail.users.messages.get({
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

    // Display results
    console.log('Email Results:');
    console.log('='.repeat(80));
    mailList.forEach((mail, index) => {
      console.log(`\n${index + 1}. ${mail.subject || '(No Subject)'}`);
      console.log(`   From: ${mail.from || 'Unknown'}`);
      console.log(`   Date: ${mail.date || 'Unknown'}`);
      if (mail.snippet) {
        console.log(`   Preview: ${mail.snippet}`);
      }
      console.log(`   Labels: ${mail.labels?.join(', ') || 'None'}`);
      console.log(`   Message ID: ${mail.id}`);
    });

    console.log(`\n\nTotal: ${mailList.length} emails`);
  } catch (error) {
    console.error('Error searching emails:', error);
    process.exit(1);
  }
}

searchPromotionsEmails();
