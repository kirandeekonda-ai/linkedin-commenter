/**
 * Login Manager — Spike 1
 * 
 * Proves that we can:
 *   1. Open LinkedIn in a headed browser
 *   2. Let the user log in manually
 *   3. Save the session (cookies + localStorage) via storageState
 *   4. Reuse that session in a new browser context without logging in again
 * 
 * Usage:
 *   npm run login           → Manual login + save session
 *   npm run verify-session   → Verify saved session still works
 *   npm run test-spike1      → Full test: login if needed, then verify reuse
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_DIR = path.join(PROJECT_ROOT, 'data', 'browser-state');
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const SESSION_META_FILE = path.join(SESSION_DIR, 'session-meta.json');

const LINKEDIN_FEED = 'https://www.linkedin.com/feed/';
const LINKEDIN_LOGIN = 'https://www.linkedin.com/login';

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sessionExists() {
  return fs.existsSync(SESSION_FILE);
}

function getSessionAge() {
  if (!fs.existsSync(SESSION_META_FILE)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(SESSION_META_FILE, 'utf-8'));
    const savedAt = new Date(meta.savedAt);
    const ageMs = Date.now() - savedAt.getTime();
    const ageHours = Math.round(ageMs / (1000 * 60 * 60));
    return { savedAt: meta.savedAt, ageHours };
  } catch {
    return null;
  }
}

function log(emoji, message) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`  ${emoji}  [${timestamp}] ${message}`);
}

// ── Core Functions ─────────────────────────────────────────────────────────────

/**
 * Opens a headed browser, navigates to LinkedIn login, and waits for the user
 * to log in manually. Once logged in (detected by URL change to /feed/),
 * saves the storageState to disk.
 */
async function manualLogin() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║          LinkedIn Session Setup — Manual Login           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  log('🚀', 'Launching browser (headed mode)...');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled', // hide automation flag
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  });

  // Patch navigator.webdriver to undefined
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  log('🌐', 'Navigating to LinkedIn login page...');
  await page.goto(LINKEDIN_LOGIN, { waitUntil: 'domcontentloaded' });

  console.log('\n  ┌─────────────────────────────────────────────────────┐');
  console.log('  │  👤  Please log in to LinkedIn in the browser.      │');
  console.log('  │      Complete any 2FA/verification if prompted.     │');
  console.log('  │      This window will detect login automatically.   │');
  console.log('  └─────────────────────────────────────────────────────┘\n');

  log('⏳', 'Waiting for you to complete login...');

  // Wait for navigation to /feed/ — this means login succeeded.
  // Timeout: 5 minutes (user may need time for 2FA)
  try {
    await page.waitForURL('**/feed/**', { timeout: 300_000 });
  } catch {
    // Maybe they navigated elsewhere after login. Check if we're still on login page.
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      log('❌', 'Login was not completed within 5 minutes. Aborting.');
      await browser.close();
      process.exit(1);
    }
    // If they're on some other authenticated page, that's fine — continue
    log('⚠️', `Landed on ${currentUrl} instead of /feed/. Attempting to save session anyway...`);
  }

  // Small delay to let LinkedIn fully settle (load cookies, localStorage)
  await page.waitForTimeout(3000);

  // Verify we're actually logged in by checking for feed content
  const isLoggedIn = await page.evaluate(() => {
    // LinkedIn's feed page has a global nav with profile info when logged in
    return !!(
      document.querySelector('.global-nav') ||
      document.querySelector('[data-control-name="identity_welcome_message"]') ||
      document.querySelector('.feed-identity-module') ||
      document.querySelector('img.feed-identity-module__member-photo') ||
      document.querySelector('.share-box-feed-entry__trigger')
    );
  });

  if (!isLoggedIn) {
    log('⚠️', 'Could not confirm login state via DOM checks. Saving session anyway (URL-based confirmation).');
  } else {
    log('✅', 'Login confirmed! Feed content detected.');
  }

  // Save the session
  ensureDir(SESSION_DIR);
  await context.storageState({ path: SESSION_FILE });

  // Save metadata
  const meta = {
    savedAt: new Date().toISOString(),
    url: page.url(),
    confirmedViaDOM: isLoggedIn,
  };
  fs.writeFileSync(SESSION_META_FILE, JSON.stringify(meta, null, 2));

  log('💾', `Session saved to: ${SESSION_FILE}`);
  log('📋', `Metadata saved to: ${SESSION_META_FILE}`);

  const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  const cookieCount = sessionData.cookies?.length || 0;
  log('🍪', `Captured ${cookieCount} cookies.`);

  await browser.close();

  console.log('\n  ┌─────────────────────────────────────────────────────┐');
  console.log('  │  ✅  Session saved successfully!                     │');
  console.log('  │      Run `npm run verify-session` to test reuse.    │');
  console.log('  └─────────────────────────────────────────────────────┘\n');

  return true;
}

/**
 * Loads the saved session and verifies it works by navigating to LinkedIn's
 * feed without logging in. Returns true if session is valid, false if expired.
 */
async function verifySession() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        LinkedIn Session Verification                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (!sessionExists()) {
    log('❌', 'No saved session found. Run `npm run login` first.');
    return false;
  }

  // Show session age
  const age = getSessionAge();
  if (age) {
    log('📅', `Session was saved on: ${age.savedAt}`);
    log('⏱️', `Session age: ${age.ageHours} hours`);
    if (age.ageHours > 120) {
      log('⚠️', 'Session is older than 5 days — it might be expired.');
    }
  }

  log('🚀', 'Launching browser with saved session...');

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE, // ← The magic — reuse saved cookies
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  });

  // Patch navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();

  log('🌐', 'Navigating to LinkedIn feed (without logging in)...');

  try {
    const response = await page.goto(LINKEDIN_FEED, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Wait a moment for any redirects to settle
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    log('📍', `Landed on: ${currentUrl}`);

    // Check 1: Did we get redirected to login?
    if (currentUrl.includes('/login') || currentUrl.includes('/authwall') || currentUrl.includes('/checkpoint')) {
      log('❌', 'Session is EXPIRED — redirected to login page.');
      await browser.close();
      console.log('\n  ┌─────────────────────────────────────────────────────┐');
      console.log('  │  ❌  Session expired! Run `npm run login` to re-     │');
      console.log('  │      authenticate.                                   │');
      console.log('  └─────────────────────────────────────────────────────┘\n');
      return false;
    }

    // Check 2: Are we on the feed?
    const onFeed = currentUrl.includes('/feed');

    // Check 3: Can we see feed content?
    const feedCheck = await page.evaluate(() => {
      const indicators = {
        globalNav: !!document.querySelector('.global-nav'),
        shareBox: !!document.querySelector('.share-box-feed-entry__trigger'),
        feedContainer: !!(
          document.querySelector('.scaffold-finite-scroll__content') ||
          document.querySelector('[role="main"]')
        ),
      };
      return indicators;
    });

    log('🔍', `Feed check: URL on feed=${onFeed}, nav=${feedCheck.globalNav}, shareBox=${feedCheck.shareBox}, feedContainer=${feedCheck.feedContainer}`);

    const isValid = onFeed && (feedCheck.globalNav || feedCheck.feedContainer);

    if (isValid) {
      log('✅', 'SESSION IS VALID — feed loaded without login!');

      // Bonus: Try to extract one post title as proof of concept
      const samplePost = await page.evaluate(() => {
        const postEl =
          document.querySelector('.feed-shared-update-v2 .feed-shared-text') ||
          document.querySelector('[data-urn] .break-words') ||
          document.querySelector('.update-components-text span[dir="ltr"]');
        if (postEl) {
          return postEl.textContent?.trim().substring(0, 120) + '...';
        }
        return null;
      });

      if (samplePost) {
        log('📝', `Sample post text: "${samplePost}"`);
      } else {
        log('⚠️', 'Could not extract a sample post — selectors may need updating, but session IS valid.');
      }
    } else {
      log('⚠️', 'Session might be partially valid — on a LinkedIn page but feed content not confirmed.');
    }

    await browser.close();

    if (isValid) {
      console.log('\n  ┌─────────────────────────────────────────────────────┐');
      console.log('  │  ✅  SPIKE 1 PASSED — Session reuse works!          │');
      console.log('  │                                                      │');
      console.log('  │  What this proves:                                   │');
      console.log('  │  • Playwright storageState saves LinkedIn cookies    │');
      console.log('  │  • Saved session can be reused across runs           │');
      console.log('  │  • No re-login needed until session expires          │');
      console.log('  │  • Feed content is accessible via saved session      │');
      console.log('  └─────────────────────────────────────────────────────┘\n');
    }

    return isValid;
  } catch (err) {
    log('❌', `Error during verification: ${err.message}`);
    await browser.close();
    return false;
  }
}

/**
 * Full test: Login if no session exists, then verify the session works.
 * This is the complete Spike 1 test.
 */
async function fullTest() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              SPIKE 1: Session Persistence Test          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Step 1: Check if session exists
  if (sessionExists()) {
    log('📁', 'Existing session found. Verifying...');
    const valid = await verifySession();
    if (valid) {
      log('🎉', 'Spike 1 complete — session reuse confirmed!');
      return true;
    }
    log('🔄', 'Session expired. Starting fresh login...');
  } else {
    log('📁', 'No saved session. Starting manual login...');
  }

  // Step 2: Manual login
  const loginOk = await manualLogin();
  if (!loginOk) {
    log('❌', 'Login failed. Spike 1 could not be completed.');
    return false;
  }

  // Step 3: Wait a moment then verify
  log('⏳', 'Waiting 3 seconds before verification...');
  await new Promise((r) => setTimeout(r, 3000));

  // Step 4: Verify the saved session in a fresh browser
  log('🔄', 'Now verifying the saved session in a NEW browser instance...');
  const valid = await verifySession();

  if (valid) {
    log('🎉', 'SPIKE 1 PASSED — Full login → save → reuse cycle works!');
  } else {
    log('❌', 'SPIKE 1 FAILED — Session was saved but could not be reused.');
  }

  return valid;
}

// ── CLI Entry Point ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || '--full-test';

try {
  switch (command) {
    case '--login':
      await manualLogin();
      break;
    case '--verify':
      await verifySession();
      break;
    case '--full-test':
      await fullTest();
      break;
    default:
      console.log('Usage:');
      console.log('  node src/login-manager.js --login       Manual login + save session');
      console.log('  node src/login-manager.js --verify      Verify saved session');
      console.log('  node src/login-manager.js --full-test   Full spike test');
  }
} catch (err) {
  log('💥', `Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
}
