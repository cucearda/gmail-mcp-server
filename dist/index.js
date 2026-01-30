"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oauth2Client = void 0;
exports.authenticate = authenticate;
const googleapis_1 = require("googleapis");
const fs_1 = require("fs");
const http_1 = require("http");
const url_1 = require("url");
const open_1 = __importDefault(require("open"));
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'gmail-token.json';
const CREDENTIALS_PATH = 'gcp-oauth-keys.json';
// Load OAuth credentials
const credentials = JSON.parse((0, fs_1.readFileSync)(CREDENTIALS_PATH, 'utf8'));
// Create OAuth2 client
const oauth2Client = new googleapis_1.google.auth.OAuth2(credentials.web.client_id, credentials.web.client_secret, credentials.web.redirect_uris[0]);
exports.oauth2Client = oauth2Client;
/**
 * Reads previously authorized token from a file, or null if not found.
 */
function loadSavedCredentialsIfExist() {
    try {
        if ((0, fs_1.existsSync)(TOKEN_PATH)) {
            const content = (0, fs_1.readFileSync)(TOKEN_PATH, 'utf8');
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
    (0, fs_1.writeFileSync)(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}
/**
 * Waits for the OAuth callback and returns the authorization code.
 */
async function waitForCallback(server) {
    return new Promise((resolve, reject) => {
        server.on('request', async (req, res) => {
            try {
                if (req.url?.startsWith('/oauth2callback')) {
                    const qs = new url_1.URL(req.url, 'http://localhost:3000').searchParams;
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
        const server = (0, http_1.createServer)();
        server.listen(3000, () => {
            console.log('Waiting for authorization...');
            resolve(server);
        });
    });
}
/**
 * Opens an authorization server and waits for the authorization code.
 */
async function authenticate() {
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
        await (0, open_1.default)(authUrl);
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
// Usage example
async function main() {
    try {
        const auth = await authenticate();
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        // Now you can use the Gmail API
        const profile = await gmail.users.getProfile({ userId: 'me' });
        console.log('Authenticated as:', profile.data.emailAddress);
    }
    catch (error) {
        console.error('Authentication error:', error);
    }
}
// Run if this file is executed directly
if (require.main === module) {
    main();
}
