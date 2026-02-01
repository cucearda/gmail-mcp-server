import {
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer';
import type { Browser, Page, ElementHandle } from 'puppeteer';
import { google } from 'googleapis';
// Import MailComposer from nodemailer for proper MIME message construction
// @ts-expect-error - MailComposer is a CommonJS module without TypeScript definitions
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

/**
 * Helper function to wait for a specified number of milliseconds
 */
function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tool schema definition
export const unsubscribeFromLinkToolSchema = {
  name: 'unsubscribe_from_list_unsubscribe_header',
  description:
    'Navigate to an unsubscribe URL and automatically click unsubscribe buttons using heuristic detection. If the List-Unsubscribe header only has mailto, send an email to the address in the header indicating that the user has unsubscribed.',
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
        description: 'Maximum wait time in milliseconds (default: 30000).',
        default: 30000,
      },
    },
    required: ['listUnsubscribeHeader'],
  },
};

interface StepResult {
  action: string;
  status: 'success' | 'failed' | 'skipped';
  selector?: string;
  message?: string;
}

interface ParsedUnsubscribeLinks {
  httpUrls: string[];
  mailtoAddresses: string[];
}

interface UnsubscribeResult {
  success: boolean;
  listUnsubscribeHeader: string;
  httpUrls?: string[];
  mailtoAddresses?: string[];
  steps: StepResult[];
  message: string;
}

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
function parseListUnsubscribeHeader(header: string): ParsedUnsubscribeLinks {
  const result: ParsedUnsubscribeLinks = {
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
      if (url.protocol === 'mailto:') {
        result.mailtoAddresses.push(url.pathname || link.replace('mailto:', ''));
      } else if (['http:', 'https:'].includes(url.protocol)) {
        result.httpUrls.push(link);
      }
    } catch (error) {
      // If URL parsing fails, try to detect mailto: manually
      if (link.toLowerCase().startsWith('mailto:')) {
        const email = link.replace(/^mailto:/i, '').split('?')[0].trim();
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
async function sendUnsubscribeEmail(
  to: string,
  gmailClient: ReturnType<typeof google.gmail>
): Promise<void> {
  // Get user's email address
  const profile = await gmailClient.users.getProfile({ userId: 'me' });
  const fromEmail = profile.data.emailAddress || 'me';

  // Create email message using MailComposer for proper MIME formatting
  const mailOptions = {
    from: fromEmail,
    to: to,
    subject: 'Unsubscribe Request',
    text: 'Please unsubscribe me from your mailing list',
  };

  // Build the RFC 2822 compliant message
  const mailComposer = new MailComposer(mailOptions);
  const message = await new Promise<Buffer>((resolve, reject) => {
    mailComposer.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
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
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
    },
  });
}

/**
 * Finds unsubscribe buttons using heuristic selectors
 */
async function findUnsubscribeButtonBySelector(
  page: Page
): Promise<{ element: any; selector: string } | null> {
  for (const selector of UNSUBSCRIBE_SELECTORS) {
    try {
      const element = await page.$(selector);
      if (element) {
        const isVisible = await element.isIntersectingViewport();
        if (isVisible) {
          return { element, selector };
        }
      }
    } catch (error) {
      // Continue to next selector
      continue;
    }
  }
  return null;
}

/**
 * Finds unsubscribe buttons by text content
 */
async function findUnsubscribeButtonByText(
  page: Page
): Promise<{ element: any; text: string } | null> {
  // Try buttons first
  const buttons = await page.$$('button, a, input[type="submit"], input[type="button"]');
  
  for (const button of buttons) {
    try {
      const text = await page.evaluate((el: Element) => {
        return el.textContent?.trim() || (el as HTMLInputElement).value?.trim() || el.getAttribute('aria-label') || '';
      }, button);
      
      for (const pattern of UNSUBSCRIBE_TEXT_PATTERNS) {
        if (pattern.test(text)) {
          const isVisible = await button.isIntersectingViewport();
          if (isVisible) {
            return { element: button, text };
          }
        }
      }
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

/**
 * Finds and submits unsubscribe forms
 */
async function findUnsubscribeForm(page: Page): Promise<boolean> {
  try {
    // Look for forms with unsubscribe-related fields
    const forms = await page.$$('form');
    
    for (const form of forms) {
      try {
        const formText = await page.evaluate((el: Element) => {
          return el.textContent?.toLowerCase() || '';
        }, form);
        
        if (formText.includes('unsubscribe') || formText.includes('opt-out')) {
          // Try to find submit button in form
          const submitButton = await form.$('button[type="submit"], input[type="submit"]');
          if (submitButton) {
            await submitButton.click();
            await waitForTimeout(1000); // Wait for form submission
            return true;
          }
        }
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    // No forms found or error
  }
  
  return false;
}

/**
 * Checks if unsubscribe was successful by looking for success indicators
 */
async function checkSuccess(page: Page): Promise<boolean> {
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
    if (currentUrl.includes('success') || currentUrl.includes('confirmed') || currentUrl.includes('unsubscribed')) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Attempts to find and click unsubscribe button using multiple strategies
 */
async function attemptUnsubscribe(
  page: Page,
  steps: StepResult[]
): Promise<boolean> {
  // Strategy 1: Try selector-based detection
  const selectorResult = await findUnsubscribeButtonBySelector(page);
  if (selectorResult) {
    try {
      await selectorResult.element.click();
      steps.push({
        action: 'find_button',
        status: 'success',
        selector: selectorResult.selector,
        message: `Found button using selector: ${selectorResult.selector}`,
      });
      steps.push({
        action: 'click_button',
        status: 'success',
        selector: selectorResult.selector,
      });
      await waitForTimeout(2000); // Wait for page to respond
      return true;
    } catch (error) {
      steps.push({
        action: 'click_button',
        status: 'failed',
        selector: selectorResult.selector,
        message: `Failed to click: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  
  // Strategy 2: Try text-based detection
  const textResult = await findUnsubscribeButtonByText(page);
  if (textResult) {
    try {
      await textResult.element.click();
      steps.push({
        action: 'find_button',
        status: 'success',
        message: `Found button by text: "${textResult.text}"`,
      });
      steps.push({
        action: 'click_button',
        status: 'success',
      });
      await waitForTimeout(2000);
      return true;
    } catch (error) {
      steps.push({
        action: 'click_button',
        status: 'failed',
        message: `Failed to click text-based button: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  
  // Strategy 3: Try form submission
  const formSubmitted = await findUnsubscribeForm(page);
  if (formSubmitted) {
    steps.push({
      action: 'submit_form',
      status: 'success',
      message: 'Submitted unsubscribe form',
    });
    return true;
  }
  
  return false;
}

/**
 * Handles HTTP/HTTPS unsubscribe URLs using Puppeteer
 */
async function handleHttpUnsubscribe(
  url: string,
  debug: boolean,
  timeout: number,
  steps: StepResult[]
): Promise<boolean> {
  let browser: Browser | null = null;
  
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: !debug,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    
    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Set timeout
    page.setDefaultTimeout(timeout);
    
    // Navigate to URL
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: timeout,
      });
      steps.push({
        action: 'navigate',
        status: 'success',
        message: `Navigated to ${url}`,
      });
    } catch (error) {
      steps.push({
        action: 'navigate',
        status: 'failed',
        message: `Failed to navigate: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
    
    // Wait a bit for page to fully load
    await waitForTimeout(1000);
    
    // Attempt to unsubscribe (may require multiple attempts for multi-step flows)
    const maxAttempts = 3;
    let success = false;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Check if already successful
      if (await checkSuccess(page)) {
        steps.push({
          action: 'check_success',
          status: 'success',
          message: 'Unsubscribe appears successful',
        });
        success = true;
        break;
      }
      
      // Try to find and click unsubscribe button
      const clicked = await attemptUnsubscribe(page, steps);
      
      if (clicked) {
        // Wait for page to respond
        await waitForTimeout(2000);
        
        // Check for success
        if (await checkSuccess(page)) {
          steps.push({
            action: 'check_success',
            status: 'success',
            message: 'Unsubscribe successful after click',
          });
          success = true;
          break;
        }
        
        // If not successful, might need another step
        if (attempt < maxAttempts) {
          steps.push({
            action: 'multi_step',
            status: 'success',
            message: `Attempt ${attempt}: Waiting for next step`,
          });
          await waitForTimeout(2000);
        }
      } else {
        if (attempt === 1) {
          steps.push({
            action: 'find_button',
            status: 'failed',
            message: 'Could not find unsubscribe button using any heuristic',
          });
        }
      }
    }
    
    // Final success check
    if (!success) {
      success = await checkSuccess(page);
      if (success) {
        steps.push({
          action: 'check_success',
          status: 'success',
          message: 'Unsubscribe successful (final check)',
        });
      }
    }
    
    return success;
  } finally {
    // Clean up browser
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Main handler function
 */
export async function handleUnsubscribeFromLink(
  args: { listUnsubscribeHeader: string; debug?: boolean; timeout?: number },
  gmailClient?: ReturnType<typeof google.gmail>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const steps: StepResult[] = [];
  
  try {
    // Parse the List-Unsubscribe header
    const parsed = parseListUnsubscribeHeader(args.listUnsubscribeHeader);
    
    if (parsed.httpUrls.length === 0 && parsed.mailtoAddresses.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'No valid unsubscribe links found in List-Unsubscribe header'
      );
    }
    
    const timeout = args.timeout || 30000;
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
        } catch (error) {
          steps.push({
            action: 'http_unsubscribe',
            status: 'failed',
            message: `Failed to unsubscribe from ${url}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
    
    // Handle mailto: addresses
    if (parsed.mailtoAddresses.length > 0) {
      if (!gmailClient) {
        steps.push({
          action: 'mailto_unsubscribe',
          status: 'failed',
          message: 'Gmail client not provided, cannot send unsubscribe email',
        });
      } else {
        for (const email of parsed.mailtoAddresses) {
          try {
            await sendUnsubscribeEmail(email, gmailClient);
            steps.push({
              action: 'mailto_unsubscribe',
              status: 'success',
              message: `Sent unsubscribe email to ${email}`,
            });
            mailtoSuccess = true;
          } catch (error) {
            steps.push({
              action: 'mailto_unsubscribe',
              status: 'failed',
              message: `Failed to send unsubscribe email to ${email}: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
    }
    
    const overallSuccess = httpSuccess || mailtoSuccess;
    
    const result: UnsubscribeResult = {
      success: overallSuccess,
      listUnsubscribeHeader: args.listUnsubscribeHeader,
      httpUrls: parsed.httpUrls.length > 0 ? parsed.httpUrls : undefined,
      mailtoAddresses: parsed.mailtoAddresses.length > 0 ? parsed.mailtoAddresses : undefined,
      steps,
      message: overallSuccess
        ? 'Successfully processed unsubscribe request'
        : 'Could not complete unsubscribe request. Check steps for details.',
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    
    const result: UnsubscribeResult = {
      success: false,
      listUnsubscribeHeader: args.listUnsubscribeHeader,
      steps,
      message: `Error: ${errorMessage}`,
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}
