/**
 * Browser Guard — Read-Only Enforcement Layer
 * 
 * Wraps a Playwright page to block any mutation actions.
 * Every interaction goes through this guard — if something tries
 * to click a like button, submit a form, or fill a comment box,
 * it gets blocked and logged.
 * 
 * This is a belt-and-suspenders safety layer on top of simply
 * "not writing code that clicks things."
 */

import fs from 'fs';
import path from 'path';

// Selectors that represent mutation actions on LinkedIn
// These are patterns — if a click target matches any of these, it's blocked.
const BLOCKED_SELECTOR_PATTERNS = [
  // Like / React
  'button.react-button',
  'button[aria-label*="Like"]',
  'button[aria-label*="like"]',
  'button[aria-label*="Love"]',
  'button[aria-label*="Celebrate"]',
  'button[aria-label*="Support"]',
  'button[aria-label*="Insightful"]',
  'button[aria-label*="Funny"]',
  '.reactions-menu',
  'button.reactions-react-button',
  
  // Comment
  'button[aria-label*="Comment"]',
  'button[aria-label*="comment"]',
  '.comments-comment-box',
  '.comments-comment-texteditor',
  'div[role="textbox"]',
  '.ql-editor',
  
  // Share / Repost
  'button[aria-label*="Share"]',
  'button[aria-label*="share"]',
  'button[aria-label*="Repost"]',
  'button[aria-label*="repost"]',
  
  // Connect / Follow
  'button[aria-label*="Connect"]',
  'button[aria-label*="connect"]',
  'button[aria-label*="Follow"]',
  'button[aria-label*="follow"]',
  'button[aria-label*="Invite"]',
  
  // Send / Submit / Post
  'button[aria-label*="Send"]',
  'button[aria-label*="Post"]',
  'button[type="submit"]',
  'form',
  
  // Message
  'button[aria-label*="Message"]',
  'button[aria-label*="message"]',
  
  // More actions
  'button[aria-label*="Dismiss"]',
  'button[aria-label*="Save"]',
  'button[aria-label*="Report"]',
];

// URL patterns that indicate mutation endpoints
const BLOCKED_URL_PATTERNS = [
  '/voyager/api/feed/actions',
  '/voyager/api/messaging',
  '/voyager/api/relationships',
  '/li/track',
];

export class BrowserGuard {
  constructor(page, options = {}) {
    this.page = page;
    this.auditLog = [];
    this.logFile = options.logFile || null;
    this.blockedCount = 0;
    this.allowedCount = 0;
  }

  /**
   * Install the guard on the page.
   * Call this right after creating the page.
   */
  async install() {
    // Intercept network requests — block POST/PUT/DELETE to mutation endpoints
    await this.page.route('**/*', (route) => {
      const method = route.request().method();
      const url = route.request().url();

      // Allow GET/HEAD/OPTIONS
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        return route.continue();
      }

      // For POST/PUT/DELETE — check if it's a mutation endpoint
      const isMutation = BLOCKED_URL_PATTERNS.some((p) => url.includes(p));

      if (isMutation) {
        this._logBlocked('network', `${method} ${url}`);
        return route.abort('blockedbyclient');
      }

      // Allow other POST requests (LinkedIn's tracking, page loads, etc.)
      // We're conservative here — only block known mutation endpoints
      return route.continue();
    });

    this._logAllowed('install', 'Browser guard installed — read-only mode active');
  }

  /**
   * Safe scroll — this is always allowed.
   */
  async scroll(distance) {
    this._logAllowed('scroll', `Scrolling ${distance}px`);
    await this.page.evaluate((d) => {
      const workspace = document.querySelector('main#workspace') || document.querySelector('[role="main"]') || document.body;
      if (workspace && workspace.scrollHeight > workspace.clientHeight) {
        workspace.scrollBy(0, d);
      } else {
        window.scrollBy(0, d);
      }
    }, distance);
  }

  /**
   * Safe mouse move — always allowed.
   */
  async mouseMove(x, y) {
    await this.page.mouse.move(x, y);
  }

  /**
   * Safe text extraction — always allowed.
   */
  async getText(selector) {
    this._logAllowed('getText', selector);
    return this.page.textContent(selector);
  }

  /**
   * Safe evaluation — always allowed (just reads DOM).
   */
  async evaluate(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }

  /**
   * Blocked: click. Always blocked unless explicitly on a safe list.
   * We DON'T expose click at all through the guard.
   */
  click() {
    this._logBlocked('click', 'All clicks are blocked through BrowserGuard');
    throw new Error('BrowserGuard: click() is not allowed in read-only mode');
  }

  /**
   * Blocked: fill/type.
   */
  fill() {
    this._logBlocked('fill', 'All form fills are blocked through BrowserGuard');
    throw new Error('BrowserGuard: fill() is not allowed in read-only mode');
  }

  /**
   * Blocked: type.
   */
  type() {
    this._logBlocked('type', 'All typing is blocked through BrowserGuard');
    throw new Error('BrowserGuard: type() is not allowed in read-only mode');
  }

  // ── Logging ──

  _logBlocked(action, detail) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: 'BLOCKED',
      action,
      detail,
    };
    this.auditLog.push(entry);
    this.blockedCount++;
    console.log(`  🛑  [GUARD] BLOCKED ${action}: ${detail}`);
  }

  _logAllowed(action, detail) {
    const entry = {
      timestamp: new Date().toISOString(),
      status: 'ALLOWED',
      action,
      detail,
    };
    this.auditLog.push(entry);
    this.allowedCount++;
  }

  /**
   * Save the audit log to disk.
   */
  saveAuditLog(filePath) {
    const target = filePath || this.logFile;
    if (!target) return;
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(this.auditLog, null, 2));
  }

  /**
   * Print a summary of actions.
   */
  printSummary() {
    console.log(`\n  📊  Guard Summary: ${this.allowedCount} allowed, ${this.blockedCount} blocked`);
    if (this.blockedCount > 0) {
      console.log(`  🛑  Blocked actions:`);
      this.auditLog
        .filter((e) => e.status === 'BLOCKED')
        .forEach((e) => console.log(`       - ${e.action}: ${e.detail}`));
    }
  }
}
