import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createServer } from 'http';
import { URL, fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
];
// Get the directory of the current file (works for both source and compiled)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve paths relative to project root (go up from src/ or dist/)
const projectRoot = join(__dirname, '..');
const TOKEN_PATH = join(projectRoot, 'gmail-token.json');
const CREDENTIALS_PATH = join(projectRoot, 'gcp-oauth-keys.json');
// Load OAuth credentials
const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
// Support both 'web' and 'installed' OAuth credential formats
const oauthConfig = credentials.web || credentials.installed;
if (!oauthConfig) {
    throw new Error('Invalid credentials format: expected "web" or "installed" key');
}
// Create OAuth2 client
const oauth2Client = new google.auth.OAuth2(oauthConfig.client_id, oauthConfig.client_secret, oauthConfig.redirect_uris?.[0] || 'http://localhost');
/**
 * Reads previously authorized token from a file, or null if not found.
 */
function loadSavedCredentialsIfExist() {
    try {
        if (existsSync(TOKEN_PATH)) {
            const content = readFileSync(TOKEN_PATH, 'utf8');
            const tokens = JSON.parse(content);
            oauth2Client.setCredentials(tokens);
            return oauth2Client;
        }
    }
    catch (err) {
        return null;
    }
    return null;
}
/**
 * Saves OAuth2 client credentials to a file.
 */
function saveCredentials(client) {
    const tokens = client.credentials;
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}
/**
 * Waits for the OAuth callback and returns the authorization code.
 */
async function waitForCallback(server) {
    return new Promise((resolve, reject) => {
        server.on('request', async (req, res) => {
            try {
                if (req.url?.startsWith('/oauth2callback')) {
                    const qs = new URL(req.url, 'http://localhost:3000').searchParams;
                    const code = qs.get('code');
                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
              <html>
                <head><title>Authentication Successful</title></head>
                <body>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to the application.</p>
                </body>
              </html>
            `);
                        server.close();
                        resolve(code);
                    }
                    else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`
              <html>
                <head><title>Authentication Failed</title></head>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>No authorization code received.</p>
                </body>
              </html>
            `);
                        server.close();
                        reject(new Error('No authorization code received'));
                    }
                }
            }
            catch (error) {
                server.close();
                reject(error);
            }
        });
    });
}
/**
 * Starts a local server and waits for it to be ready.
 */
async function startCallbackServer() {
    return new Promise((resolve) => {
        const server = createServer();
        server.listen(3000, () => {
            console.log('Waiting for authorization...');
            resolve(server);
        });
    });
}
/**
 * Opens an authorization server and waits for the authorization code.
 */
export async function authenticate() {
    // Check if we have previously stored a token
    const client = loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    // Generate the auth URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    // Start the callback server
    const server = await startCallbackServer();
    // Open the browser automatically
    try {
        await open(authUrl);
    }
    catch (err) {
        console.error('Could not open browser:', err);
        console.log('Please visit this URL manually:', authUrl);
    }
    // Wait for the callback
    const code = await waitForCallback(server);
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveCredentials(oauth2Client);
    console.log('Token stored successfully!');
    return oauth2Client;
}
export { oauth2Client };
