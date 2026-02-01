import { ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer';
// Import MailComposer from nodemailer for proper MIME message construction
// @ts-expect-error - MailComposer is a CommonJS module without TypeScript definitions
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
// ============================================================================
// Constants
// ============================================================================
// Timeouts (in milliseconds)
const DEFAULT_TIMEOUT_MS = 30000;
const WAIT_AFTER_FORM_SUBMISSION_MS = 1000;
const WAIT_AFTER_BUTTON_CLICK_MS = 2000;
const WAIT_AFTER_NAVIGATION_MS = 1000;
const WAIT_BETWEEN_ATTEMPTS_MS = 2000;
// Retry configuration
const MAX_UNSUBSCRIBE_ATTEMPTS = 3;
// Gmail API constants
const GMAIL_USER_ID = 'me';
const UNSUBSCRIBE_EMAIL_SUBJECT = 'Unsubscribe Request';
const UNSUBSCRIBE_EMAIL_TEXT = 'Please unsubscribe me from your mailing list';
// URL protocol strings
const PROTOCOL_MAILTO = 'mailto:';
const PROTOCOL_HTTP = 'http:';
const PROTOCOL_HTTPS = 'https:';
// Puppeteer configuration
const PUPPETEER_WAIT_UNTIL = 'networkidle2';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
];
// Chrome executable paths (macOS)
const CHROME_EXECUTABLE_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
// Chrome error messages
const CHROME_NOT_FOUND_ERRORS = ['Could not find Chrome', 'executablePath'];
const CHROME_INSTALL_HINT = 'npx puppeteer browsers install chrome';
// URL success indicators
const URL_SUCCESS_INDICATORS = ['success', 'confirmed', 'unsubscribed'];
// Form text keywords
const FORM_KEYWORDS = ['unsubscribe', 'opt-out'];
// Button selectors
const BUTTON_SELECTORS = 'button, a, input[type="submit"], input[type="button"]';
const FORM_SUBMIT_SELECTORS = 'button[type="submit"], input[type="submit"]';
// Step action names
const ACTION_LAUNCH_BROWSER = 'launch_browser';
const ACTION_NAVIGATE = 'navigate';
const ACTION_FIND_BUTTON = 'find_button';
const ACTION_CLICK_BUTTON = 'click_button';
const ACTION_SUBMIT_FORM = 'submit_form';
const ACTION_CHECK_SUCCESS = 'check_success';
const ACTION_MULTI_STEP = 'multi_step';
const ACTION_HTTP_UNSUBSCRIBE = 'http_unsubscribe';
const ACTION_MAILTO_UNSUBSCRIBE = 'mailto_unsubscribe';
const ACTION_ERROR = 'error';
const ACTION_CLOSE_BROWSER = 'close_browser';
// Step status values
const STATUS_SUCCESS = 'success';
const STATUS_FAILED = 'failed';
const STATUS_SKIPPED = 'skipped';
// Step messages
const MSG_BROWSER_LAUNCH_ATTEMPT = (headless) => `Attempting to launch browser (headless: ${headless})`;
const MSG_BROWSER_LAUNCH_SUCCESS = 'Browser launched successfully';
const MSG_BROWSER_LAUNCH_FAILED = (error) => `Failed to launch browser: ${error}`;
const MSG_NAVIGATED_TO = (url) => `Navigated to ${url}`;
const MSG_NAVIGATION_FAILED = (error) => `Failed to navigate: ${error}`;
const MSG_BUTTON_FOUND_BY_SELECTOR = (selector) => `Found button using selector: ${selector}`;
const MSG_BUTTON_FOUND_BY_TEXT = (text) => `Found button by text: "${text}"`;
const MSG_BUTTON_CLICK_FAILED = (error) => `Failed to click: ${error}`;
const MSG_TEXT_BUTTON_CLICK_FAILED = (error) => `Failed to click text-based button: ${error}`;
const MSG_FORM_SUBMITTED = 'Submitted unsubscribe form';
const MSG_UNSUBSCRIBE_APPEARS_SUCCESSFUL = 'Unsubscribe appears successful';
const MSG_UNSUBSCRIBE_SUCCESSFUL_AFTER_CLICK = 'Unsubscribe successful after click';
const MSG_UNSUBSCRIBE_SUCCESSFUL_FINAL = 'Unsubscribe successful (final check)';
const MSG_WAITING_FOR_NEXT_STEP = (attempt) => `Attempt ${attempt}: Waiting for next step`;
const MSG_BUTTON_NOT_FOUND = 'Could not find unsubscribe button using any heuristic';
const MSG_ERROR_IN_HANDLE_HTTP = (error) => `Error in handleHttpUnsubscribe: ${error}`;
const MSG_BROWSER_CLOSE_FAILED = (error) => `Failed to close browser: ${error}`;
const MSG_HTTP_UNSUBSCRIBE_FAILED = (url, error) => `Failed to unsubscribe from ${url}: ${error}`;
const MSG_GMAIL_CLIENT_NOT_PROVIDED = 'Gmail client not provided, cannot send unsubscribe email';
const MSG_EMAIL_SENT = (email) => `Sent unsubscribe email to ${email}`;
const MSG_EMAIL_SEND_FAILED = (email, error) => `Failed to send unsubscribe email to ${email}: ${error}`;
const MSG_SUCCESS_PROCESSED = 'Successfully processed unsubscribe request';
const MSG_COULD_NOT_COMPLETE = 'Could not complete unsubscribe request. Check steps for details.';
const MSG_ERROR_PREFIX = (error) => `Error: ${error}`;
// Error messages
const ERROR_NO_VALID_LINKS = 'No valid unsubscribe links found in List-Unsubscribe header';
// Debug messages
const DEBUG_LAUNCH_BROWSER = (headless) => `[DEBUG] About to launch Puppeteer browser (headless: ${headless})`;
const DEBUG_CHROME_EXECUTABLE = (path) => `[DEBUG] Found Chrome executable at: ${path}`;
const DEBUG_CHROME_PATH_ERROR = (error) => `[DEBUG] Could not determine Puppeteer Chrome path: ${error}`;
const DEBUG_SYSTEM_CHROME = (path) => `[DEBUG] Found system Chrome at: ${path}`;
const DEBUG_NO_CHROME = `[DEBUG] No Chrome found, will let Puppeteer attempt to find/download it`;
const DEBUG_BROWSER_LAUNCHED = `[DEBUG] Browser launched successfully, browser instance:`;
const DEBUG_BROWSER_LAUNCH_FAILED = `[DEBUG] Failed to launch browser:`;
// JSON formatting
const JSON_INDENT = 2;
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Helper function to wait for a specified number of milliseconds
 */
function waitForTimeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Tool schema definition
export const unsubscribeFromLinkToolSchema = {
    name: 'unsubscribe_from_list_unsubscribe_header',
    description: 'Navigate to an unsubscribe URL and automatically click unsubscribe buttons using heuristic detection. If the List-Unsubscribe header only has mailto, send an email to the address in the header indicating that the user has unsubscribed.',
    inputSchema: {
        type: 'object',
        properties: {
            listUnsubscribeHeader: {
                type: 'string',
                description: 'The List-Unsubscribe header value (e.g., "<https://example.com/unsubscribe>, <mailto:unsubscribe@example.com>" or just "<mailto:unsubscribe@example.com>").',
            },
            debug: {
                type: 'boolean',
                description: 'If true, run browser in visible mode for debugging. Otherwise run headless.',
                default: false,
            },
            timeout: {
                type: 'number',
                description: `Maximum wait time in milliseconds (default: ${DEFAULT_TIMEOUT_MS}).`,
                default: DEFAULT_TIMEOUT_MS,
            },
        },
        required: ['listUnsubscribeHeader'],
    },
};
// Common unsubscribe button selectors (ordered by likelihood)
const UNSUBSCRIBE_SELECTORS = [
    // ID-based selectors
    '#unsubscribe',
    '#unsubscribe-button',
    '#confirm-unsubscribe',
    '#opt-out',
    '#unsub',
    // Class-based selectors
    '.unsubscribe',
    '.unsubscribe-button',
    '.btn-unsubscribe',
    '.unsub-button',
    '.opt-out',
    '.confirm-unsubscribe',
    // Attribute-based selectors
    '[data-action="unsubscribe"]',
    '[data-unsubscribe]',
    '[name="unsubscribe"]',
    // Generic button/link patterns
    'button[type="submit"]',
    'input[type="submit"]',
    'a[href*="unsubscribe"]',
    'a[href*="opt-out"]',
];
// Text patterns to search for in buttons/links (case-insensitive)
const UNSUBSCRIBE_TEXT_PATTERNS = [
    /^unsubscribe$/i,
    /^confirm unsubscribe$/i,
    /^unsubscribe me$/i,
    /^yes, unsubscribe$/i,
    /^opt out$/i,
    /^opt-out$/i,
    /^confirm$/i,
    /^unsubscribe now$/i,
    /^remove me$/i,
];
// Success indicators (text that suggests unsubscribe was successful)
const SUCCESS_INDICATORS = [
    /successfully unsubscribed/i,
    /you have been unsubscribed/i,
    /unsubscribe successful/i,
    /you're unsubscribed/i,
    /unsubscribed successfully/i,
    /removed from mailing list/i,
];
/**
 * Parses the List-Unsubscribe header to extract http/https URLs and mailto: addresses
 * Format: "<https://example.com/unsubscribe>, <mailto:unsubscribe@example.com>"
 */
function parseListUnsubscribeHeader(header) {
    const result = {
        httpUrls: [],
        mailtoAddresses: [],
    };
    // Remove angle brackets and split by comma
    const links = header
        .split(',')
        .map((link) => link.trim().replace(/^<|>$/g, ''))
        .filter((link) => link.length > 0);
    for (const link of links) {
        try {
            const url = new URL(link);
            if (url.protocol === PROTOCOL_MAILTO) {
                result.mailtoAddresses.push(url.pathname || link.replace(PROTOCOL_MAILTO, ''));
            }
            else if ([PROTOCOL_HTTP, PROTOCOL_HTTPS].includes(url.protocol)) {
                result.httpUrls.push(link);
            }
        }
        catch (error) {
            // If URL parsing fails, try to detect mailto: manually
            if (link.toLowerCase().startsWith(PROTOCOL_MAILTO)) {
                const email = link.replace(new RegExp(`^${PROTOCOL_MAILTO}`, 'i'), '').split('?')[0].trim();
                if (email) {
                    result.mailtoAddresses.push(email);
                }
            }
        }
    }
    return result;
}
/**
 * Sends an unsubscribe email via Gmail API
 */
async function sendUnsubscribeEmail(to, gmailClient) {
    // Get user's email address
    const profile = await gmailClient.users.getProfile({ userId: GMAIL_USER_ID });
    const fromEmail = profile.data.emailAddress || GMAIL_USER_ID;
    // Create email message using MailComposer for proper MIME formatting
    const mailOptions = {
        from: fromEmail,
        to: to,
        subject: UNSUBSCRIBE_EMAIL_SUBJECT,
        text: UNSUBSCRIBE_EMAIL_TEXT,
    };
    // Build the RFC 2822 compliant message
    const mailComposer = new MailComposer(mailOptions);
    const message = await new Promise((resolve, reject) => {
        mailComposer.compile().build((err, message) => {
            if (err)
                reject(err);
            else
                resolve(message);
        });
    });
    // Encode to base64url format (required by Gmail API)
    const encodedEmail = message
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    // Send the email
    await gmailClient.users.messages.send({
        userId: GMAIL_USER_ID,
        requestBody: {
            raw: encodedEmail,
        },
    });
}
/**
 * Finds unsubscribe buttons using heuristic selectors
 */
async function findUnsubscribeButtonBySelector(page) {
    for (const selector of UNSUBSCRIBE_SELECTORS) {
        try {
            const element = await page.$(selector);
            if (element) {
                const isVisible = await element.isIntersectingViewport();
                if (isVisible) {
                    return { element, selector };
                }
            }
        }
        catch (error) {
            // Continue to next selector
            continue;
        }
    }
    return null;
}
/**
 * Finds unsubscribe buttons by text content
 */
async function findUnsubscribeButtonByText(page) {
    // Try buttons first
    const buttons = await page.$$(BUTTON_SELECTORS);
    for (const button of buttons) {
        try {
            const text = await page.evaluate((el) => {
                return el.textContent?.trim() || el.value?.trim() || el.getAttribute('aria-label') || '';
            }, button);
            for (const pattern of UNSUBSCRIBE_TEXT_PATTERNS) {
                if (pattern.test(text)) {
                    const isVisible = await button.isIntersectingViewport();
                    if (isVisible) {
                        return { element: button, text };
                    }
                }
            }
        }
        catch (error) {
            continue;
        }
    }
    return null;
}
/**
 * Finds and submits unsubscribe forms
 */
async function findUnsubscribeForm(page) {
    try {
        // Look for forms with unsubscribe-related fields
        const forms = await page.$$('form');
        for (const form of forms) {
            try {
                const formText = await page.evaluate((el) => {
                    return el.textContent?.toLowerCase() || '';
                }, form);
                if (FORM_KEYWORDS.some(keyword => formText.includes(keyword))) {
                    // Try to find submit button in form
                    const submitButton = await form.$(FORM_SUBMIT_SELECTORS);
                    if (submitButton) {
                        await submitButton.click();
                        await waitForTimeout(WAIT_AFTER_FORM_SUBMISSION_MS); // Wait for form submission
                        return true;
                    }
                }
            }
            catch (error) {
                continue;
            }
        }
    }
    catch (error) {
        // No forms found or error
    }
    return false;
}
/**
 * Checks if unsubscribe was successful by looking for success indicators
 */
async function checkSuccess(page) {
    try {
        const pageText = await page.evaluate(() => {
            return document.body.textContent?.toLowerCase() || '';
        });
        for (const pattern of SUCCESS_INDICATORS) {
            if (pattern.test(pageText)) {
                return true;
            }
        }
        // Also check if URL changed (common pattern)
        const currentUrl = page.url();
        if (URL_SUCCESS_INDICATORS.some(indicator => currentUrl.includes(indicator))) {
            return true;
        }
        return false;
    }
    catch (error) {
        return false;
    }
}
/**
 * Attempts to find and click unsubscribe button using multiple strategies
 */
async function attemptUnsubscribe(page, steps) {
    // Strategy 1: Try selector-based detection
    const selectorResult = await findUnsubscribeButtonBySelector(page);
    if (selectorResult) {
        try {
            await selectorResult.element.click();
            steps.push({
                action: ACTION_FIND_BUTTON,
                status: STATUS_SUCCESS,
                selector: selectorResult.selector,
                message: MSG_BUTTON_FOUND_BY_SELECTOR(selectorResult.selector),
            });
            steps.push({
                action: ACTION_CLICK_BUTTON,
                status: STATUS_SUCCESS,
                selector: selectorResult.selector,
            });
            await waitForTimeout(WAIT_AFTER_BUTTON_CLICK_MS); // Wait for page to respond
            return true;
        }
        catch (error) {
            steps.push({
                action: ACTION_CLICK_BUTTON,
                status: STATUS_FAILED,
                selector: selectorResult.selector,
                message: MSG_BUTTON_CLICK_FAILED(error instanceof Error ? error.message : String(error)),
            });
        }
    }
    // Strategy 2: Try text-based detection
    const textResult = await findUnsubscribeButtonByText(page);
    if (textResult) {
        try {
            await textResult.element.click();
            steps.push({
                action: ACTION_FIND_BUTTON,
                status: STATUS_SUCCESS,
                message: MSG_BUTTON_FOUND_BY_TEXT(textResult.text),
            });
            steps.push({
                action: ACTION_CLICK_BUTTON,
                status: STATUS_SUCCESS,
            });
            await waitForTimeout(WAIT_AFTER_BUTTON_CLICK_MS);
            return true;
        }
        catch (error) {
            steps.push({
                action: ACTION_CLICK_BUTTON,
                status: STATUS_FAILED,
                message: MSG_TEXT_BUTTON_CLICK_FAILED(error instanceof Error ? error.message : String(error)),
            });
        }
    }
    // Strategy 3: Try form submission
    const formSubmitted = await findUnsubscribeForm(page);
    if (formSubmitted) {
        steps.push({
            action: ACTION_SUBMIT_FORM,
            status: STATUS_SUCCESS,
            message: MSG_FORM_SUBMITTED,
        });
        return true;
    }
    return false;
}
/**
 * Handles HTTP/HTTPS unsubscribe URLs using Puppeteer
 */
async function handleHttpUnsubscribe(url, debug, timeout, steps) {
    let browser = null;
    try {
        // Launch browser
        steps.push({
            action: ACTION_LAUNCH_BROWSER,
            status: STATUS_SUCCESS,
            message: MSG_BROWSER_LAUNCH_ATTEMPT(!debug),
        });
        try {
            console.log(DEBUG_LAUNCH_BROWSER(!debug));
            // Try to get the executable path
            let executablePath;
            try {
                const puppeteerPath = puppeteer.executablePath();
                console.log(DEBUG_CHROME_EXECUTABLE(puppeteerPath));
                // Verify the path actually exists before using it
                const fs = await import('fs/promises');
                try {
                    await fs.access(puppeteerPath);
                    executablePath = puppeteerPath;
                }
                catch {
                    // Path doesn't exist, Puppeteer will handle downloading/finding Chrome
                    console.log(DEBUG_CHROME_PATH_ERROR('Executable path does not exist, letting Puppeteer find Chrome'));
                }
            }
            catch (pathError) {
                console.log(DEBUG_CHROME_PATH_ERROR(pathError instanceof Error ? pathError.message : String(pathError)));
                // Try to find system Chrome as fallback (macOS)
                const fs = await import('fs/promises');
                for (const chromePath of CHROME_EXECUTABLE_PATHS) {
                    try {
                        await fs.access(chromePath);
                        executablePath = chromePath;
                        console.log(DEBUG_SYSTEM_CHROME(executablePath));
                        break;
                    }
                    catch {
                        // Path doesn't exist, try next one
                        continue;
                    }
                }
                if (!executablePath) {
                    console.log(DEBUG_NO_CHROME);
                }
            }
            const launchOptions = {
                headless: !debug,
                args: BROWSER_ARGS,
            };
            // Only set executablePath if we found one and verified it exists
            if (executablePath) {
                launchOptions.executablePath = executablePath;
            }
            browser = await puppeteer.launch(launchOptions);
            console.log(DEBUG_BROWSER_LAUNCHED, browser ? 'exists' : 'null');
            steps.push({
                action: ACTION_LAUNCH_BROWSER,
                status: STATUS_SUCCESS,
                message: MSG_BROWSER_LAUNCH_SUCCESS,
            });
        }
        catch (launchError) {
            const errorMessage = launchError instanceof Error ? launchError.message : String(launchError);
            console.error(DEBUG_BROWSER_LAUNCH_FAILED, launchError);
            // Check if it's a Chrome not found error
            let enhancedMessage = errorMessage;
            if (CHROME_NOT_FOUND_ERRORS.some(err => errorMessage.includes(err))) {
                enhancedMessage = `${errorMessage}\n\nTo fix this, try running: ${CHROME_INSTALL_HINT}`;
            }
            steps.push({
                action: ACTION_LAUNCH_BROWSER,
                status: STATUS_FAILED,
                message: MSG_BROWSER_LAUNCH_FAILED(enhancedMessage),
            });
            throw launchError;
        }
        const page = await browser.newPage();
        // Set realistic user agent
        await page.setUserAgent(USER_AGENT);
        // Set timeout
        page.setDefaultTimeout(timeout);
        // Navigate to URL
        try {
            await page.goto(url, {
                waitUntil: PUPPETEER_WAIT_UNTIL,
                timeout: timeout,
            });
            steps.push({
                action: ACTION_NAVIGATE,
                status: STATUS_SUCCESS,
                message: MSG_NAVIGATED_TO(url),
            });
        }
        catch (error) {
            steps.push({
                action: ACTION_NAVIGATE,
                status: STATUS_FAILED,
                message: MSG_NAVIGATION_FAILED(error instanceof Error ? error.message : String(error)),
            });
            throw error;
        }
        // Wait a bit for page to fully load
        await waitForTimeout(WAIT_AFTER_NAVIGATION_MS);
        // Attempt to unsubscribe (may require multiple attempts for multi-step flows)
        const maxAttempts = MAX_UNSUBSCRIBE_ATTEMPTS;
        let success = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // Check if already successful
            if (await checkSuccess(page)) {
                steps.push({
                    action: ACTION_CHECK_SUCCESS,
                    status: STATUS_SUCCESS,
                    message: MSG_UNSUBSCRIBE_APPEARS_SUCCESSFUL,
                });
                success = true;
                break;
            }
            // Try to find and click unsubscribe button
            const clicked = await attemptUnsubscribe(page, steps);
            if (clicked) {
                // Wait for page to respond
                await waitForTimeout(WAIT_AFTER_BUTTON_CLICK_MS);
                // Check for success
                if (await checkSuccess(page)) {
                    steps.push({
                        action: ACTION_CHECK_SUCCESS,
                        status: STATUS_SUCCESS,
                        message: MSG_UNSUBSCRIBE_SUCCESSFUL_AFTER_CLICK,
                    });
                    success = true;
                    break;
                }
                // If not successful, might need another step
                if (attempt < maxAttempts) {
                    steps.push({
                        action: ACTION_MULTI_STEP,
                        status: STATUS_SUCCESS,
                        message: MSG_WAITING_FOR_NEXT_STEP(attempt),
                    });
                    await waitForTimeout(WAIT_BETWEEN_ATTEMPTS_MS);
                }
            }
            else {
                if (attempt === 1) {
                    steps.push({
                        action: ACTION_FIND_BUTTON,
                        status: STATUS_FAILED,
                        message: MSG_BUTTON_NOT_FOUND,
                    });
                }
            }
        }
        // Final success check
        if (!success) {
            success = await checkSuccess(page);
            if (success) {
                steps.push({
                    action: ACTION_CHECK_SUCCESS,
                    status: STATUS_SUCCESS,
                    message: MSG_UNSUBSCRIBE_SUCCESSFUL_FINAL,
                });
            }
        }
        return success;
    }
    catch (error) {
        // Log error before re-throwing
        const errorMessage = error instanceof Error ? error.message : String(error);
        steps.push({
            action: ACTION_ERROR,
            status: STATUS_FAILED,
            message: MSG_ERROR_IN_HANDLE_HTTP(errorMessage),
        });
        throw error;
    }
    finally {
        // Clean up browser
        if (browser) {
            try {
                await browser.close();
            }
            catch (closeError) {
                // Log but don't throw - we're in finally block
                steps.push({
                    action: ACTION_CLOSE_BROWSER,
                    status: STATUS_FAILED,
                    message: MSG_BROWSER_CLOSE_FAILED(closeError instanceof Error ? closeError.message : String(closeError)),
                });
            }
        }
    }
}
/**
 * Main handler function
 */
export async function handleUnsubscribeFromLink(args, gmailClient) {
    const steps = [];
    try {
        // Parse the List-Unsubscribe header
        const parsed = parseListUnsubscribeHeader(args.listUnsubscribeHeader);
        if (parsed.httpUrls.length === 0 && parsed.mailtoAddresses.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, ERROR_NO_VALID_LINKS);
        }
        const timeout = args.timeout || DEFAULT_TIMEOUT_MS;
        const debug = args.debug || false;
        let httpSuccess = false;
        let mailtoSuccess = false;
        // Handle HTTP/HTTPS URLs
        if (parsed.httpUrls.length > 0) {
            for (const url of parsed.httpUrls) {
                try {
                    httpSuccess = await handleHttpUnsubscribe(url, debug, timeout, steps);
                    if (httpSuccess) {
                        break; // Success on first URL
                    }
                }
                catch (error) {
                    steps.push({
                        action: ACTION_HTTP_UNSUBSCRIBE,
                        status: STATUS_FAILED,
                        message: MSG_HTTP_UNSUBSCRIBE_FAILED(url, error instanceof Error ? error.message : String(error)),
                    });
                }
            }
        }
        // Handle mailto: addresses
        if (parsed.mailtoAddresses.length > 0) {
            if (!gmailClient) {
                steps.push({
                    action: ACTION_MAILTO_UNSUBSCRIBE,
                    status: STATUS_FAILED,
                    message: MSG_GMAIL_CLIENT_NOT_PROVIDED,
                });
            }
            else {
                for (const email of parsed.mailtoAddresses) {
                    try {
                        await sendUnsubscribeEmail(email, gmailClient);
                        steps.push({
                            action: ACTION_MAILTO_UNSUBSCRIBE,
                            status: STATUS_SUCCESS,
                            message: MSG_EMAIL_SENT(email),
                        });
                        mailtoSuccess = true;
                    }
                    catch (error) {
                        steps.push({
                            action: ACTION_MAILTO_UNSUBSCRIBE,
                            status: STATUS_FAILED,
                            message: MSG_EMAIL_SEND_FAILED(email, error instanceof Error ? error.message : String(error)),
                        });
                    }
                }
            }
        }
        const overallSuccess = httpSuccess || mailtoSuccess;
        const result = {
            success: overallSuccess,
            listUnsubscribeHeader: args.listUnsubscribeHeader,
            httpUrls: parsed.httpUrls.length > 0 ? parsed.httpUrls : undefined,
            mailtoAddresses: parsed.mailtoAddresses.length > 0 ? parsed.mailtoAddresses : undefined,
            steps,
            message: overallSuccess
                ? MSG_SUCCESS_PROCESSED
                : MSG_COULD_NOT_COMPLETE,
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, JSON_INDENT),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const result = {
            success: false,
            listUnsubscribeHeader: args.listUnsubscribeHeader,
            steps,
            message: MSG_ERROR_PREFIX(errorMessage),
        };
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, JSON_INDENT),
                },
            ],
        };
    }
}
