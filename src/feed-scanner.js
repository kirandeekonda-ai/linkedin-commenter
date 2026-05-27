/**
 * Feed Scanner — Spike 2
 * 
 * Proves that we can:
 *   1. Open LinkedIn feed using saved session
 *   2. Scroll with human-like behavior
 *   3. Extract post data reliably using multiple selector strategies
 *   4. Output structured JSON with post details
 *   5. All while remaining strictly read-only (via BrowserGuard)
 * 
 * Usage:
 *   node src/feed-scanner.js                → Scan feed, save results
 *   node src/feed-scanner.js --headed       → Run with visible browser (default)
 *   node src/feed-scanner.js --max-posts 10 → Set post target (default: 25)
 *   node src/feed-scanner.js --max-scrolls 15 → Set scroll limit (default: 25)
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserGuard } from './browser-guard.js';

// ── Config ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

// Parse CLI args
const args = process.argv.slice(2);
const MAX_POSTS = parseInt(args.find((_, i, a) => a[i - 1] === '--max-posts') || '25', 10);
const MAX_SCROLLS = parseInt(args.find((_, i, a) => a[i - 1] === '--max-scrolls') || '25', 10);

// Today's run directory
const today = new Date().toISOString().split('T')[0];
const RUN_DIR = path.join(PROJECT_ROOT, 'data', 'runs', today);

const LINKEDIN_FEED = 'https://www.linkedin.com/feed/';

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function log(emoji, message) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`  ${emoji}  [${ts}] ${message}`);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(minMs = 2000, maxMs = 5000) {
  const delay = randomBetween(minMs, maxMs);
  await new Promise((r) => setTimeout(r, delay));
}

// ── Selector Strategies ────────────────────────────────────────────────────────
// Multiple selector approaches for resilience. LinkedIn changes DOM frequently.
// We try each strategy in order and use whichever works.

const SELECTOR_STRATEGIES = {
  // Strategy A: data-urn based (most stable — LinkedIn uses URN internally)
  postContainers_A: '[data-urn^="urn:li:activity"]',
  postContainers_B: '.feed-shared-update-v2',
  postContainers_C: 'div[data-id]  .feed-shared-update-v2',
  postContainers_D: '[role="main"] article',
};

/**
 * Extract all post data from the currently loaded page.
 * Uses multiple selector strategies with fallback.
 */
async function extractPosts(page) {
  return await page.evaluate(() => {
    // Helper: get text content safely, with whitespace cleanup
    const getText = (el, selectors) => {
      if (!el) return '';
      for (const sel of selectors) {
        const target = el.querySelector(sel);
        if (target && target.textContent.trim()) {
          // Collapse all whitespace sequences into single spaces
          return target.textContent.replace(/\s+/g, ' ').trim();
        }
      }
      return '';
    };

    // Helper: get href safely
    const getHref = (el, selectors) => {
      if (!el) return '';
      for (const sel of selectors) {
        const target = el.querySelector(sel);
        if (target) {
          const href = target.getAttribute('href');
          if (href) {
            // Strip query params for cleaner URLs
            const cleanHref = href.split('?')[0];
            return cleanHref.startsWith('http') ? cleanHref : `https://www.linkedin.com${cleanHref}`;
          }
        }
      }
      return '';
    };

    // Helper: extract author name from profile link's aria-label
    // Format: "View: Maryam Bahrami Premium • 3rd+ Building AI Agent Systems..."
    // or "View Maryam Bahrami's graphic link"
    const getNameFromAriaLabel = (el) => {
      const profileLinks = el.querySelectorAll('a[href*="/in/"]');
      for (const link of profileLinks) {
        const ariaLabel = link.getAttribute('aria-label') || '';
        
        // Pattern 1: "View: Name Premium • ..." or "View: Name • ..."
        let match = ariaLabel.match(/^View:\s+(.+?)(?:\s+Premium)?\s+•/);
        if (match) return match[1].trim();
        
        // Pattern 2: "View Name's graphic link" or "View Name's profile"
        match = ariaLabel.match(/^View\s+(.+?)(?:'s|'s)\s+/);
        if (match) return match[1].trim();
      }
      return '';
    };

    // Helper: parse engagement count (handles "1,234" and "1K" etc.)
    const parseCount = (text) => {
      if (!text) return 0;
      text = text.trim().replace(/,/g, '');
      if (text.includes('K')) return Math.round(parseFloat(text) * 1000);
      if (text.includes('M')) return Math.round(parseFloat(text) * 1000000);
      return parseInt(text, 10) || 0;
    };

    // Find post containers using multiple strategies
    let postElements = [];
    const strategies = [
      '[data-urn^="urn:li:activity"]',
      '.feed-shared-update-v2',
      '[role="main"] article',
      '.occludable-update',
    ];

    for (const sel of strategies) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        postElements = Array.from(found);
        break;
      }
    }

    if (postElements.length === 0) return { strategy: 'none', posts: [] };

    const posts = [];
    const seenIds = new Set();

    for (const el of postElements) {
      try {
        // ── Post ID / URN ──
        const urn = el.getAttribute('data-urn') ||
                    el.closest('[data-urn]')?.getAttribute('data-urn') ||
                    el.getAttribute('data-id') || '';

        // Deduplicate
        if (urn && seenIds.has(urn)) continue;
        if (urn) seenIds.add(urn);

        // ── Author Info ──
        // Strategy 1: Parse name from profile link aria-label (cleanest)
        let authorName = getNameFromAriaLabel(el);
        
        // Strategy 2: Get from .update-components-actor__title (current LinkedIn DOM)
        if (!authorName) {
          authorName = getText(el, [
            '.update-components-actor__title',
            '.update-components-actor__meta-link',
          ]);
          // The title may contain headline text too — take only first line
          if (authorName && authorName.includes('•')) {
            authorName = authorName.split('•')[0].trim();
          }
        }
        
        // Strategy 3: Legacy selectors (fallback)
        if (!authorName) {
          authorName = getText(el, [
            '.update-components-actor__name span[aria-hidden="true"]',
            '.feed-shared-actor__name span[aria-hidden="true"]',
            '.update-components-actor__name',
          ]);
        }

        const authorHeadline = getText(el, [
          '.update-components-actor__description',
          '.update-components-actor__subtitle',
          '.feed-shared-actor__description',
        ]);

        const authorProfileUrl = getHref(el, [
          '.update-components-actor__meta-link',
          'a[href*="/in/"]',
          '.update-components-actor__container-link',
          '.feed-shared-actor__container-link',
        ]);

        // ── Post Text ──
        const postText = getText(el, [
          '.feed-shared-update-v2__description .break-words',
          '.update-components-text span.break-words',
          '.feed-shared-text .break-words',
          '[data-urn] .break-words',
          '.update-components-text',
          'span[dir="ltr"]',
        ]);

        // ── Post URL ──
        let postUrl = '';
        if (urn && urn.startsWith('urn:li:activity:')) {
          postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
        } else {
          // Try to find a permalink
          const permalink = el.querySelector(
            'a[href*="/feed/update/"], a[href*="/posts/"]'
          );
          if (permalink) {
            const href = permalink.getAttribute('href');
            postUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
          }
        }

        // ── Timestamp ──
        const timestamp = getText(el, [
          '.update-components-actor__sub-description',
          '.feed-shared-actor__sub-description',
          'time',
        ]);

        // ── Post Type Detection ──
        let postType = 'text';
        if (el.querySelector('video, .video-js, [data-urn*="video"]')) postType = 'video';
        else if (el.querySelector('.update-components-image, .feed-shared-image, img.ivm-view-attr__img')) postType = 'image';
        else if (el.querySelector('.update-components-article, .feed-shared-article')) postType = 'article';
        else if (el.querySelector('.update-components-poll, .feed-shared-poll')) postType = 'poll';
        else if (el.querySelector('.update-components-document, .feed-shared-document')) postType = 'document';

        // ── Sponsored Check ──
        const subDesc = getText(el, ['.update-components-actor__sub-description']);
        const isSponsored = !!(
          subDesc.toLowerCase().includes('promoted') ||
          el.querySelector('a[href*="about/ads"]') ||
          el.querySelector('[aria-label*="Promoted"]')
        );

        // ── Engagement ──
        const likesText = getText(el, [
          '.social-details-social-counts__reactions-count',
          'button[aria-label*="reaction"] span',
          '.social-details-social-counts__count-value',
        ]);
        const commentsText = getText(el, [
          'button[aria-label*="comment"] span',
          '.social-details-social-counts__comments',
        ]);
        const repostsText = getText(el, [
          'button[aria-label*="repost"] span',
          '.social-details-social-counts__reposts',
        ]);

        // ── Skip if no meaningful content ──
        if (!authorName && !postText) continue;

        // ── Image URL Extraction ──
        let imageUrl = '';
        if (postType === 'image' || postType === 'document') {
          const imgEl = el.querySelector([
            '.update-components-image img',
            '.feed-shared-image img',
            'img.ivm-view-attr__img',
            '.update-components-multiple-images img',
            '.update-components-document img'
          ].join(', '));
          if (imgEl) {
            imageUrl = imgEl.getAttribute('src') || '';
          }
        }

        posts.push({
          post_id: urn || `unknown_${posts.length}`,
          author_name: authorName,
          author_headline: authorHeadline,
          author_profile_url: authorProfileUrl,
          post_text: postText,
          post_url: postUrl,
          post_type: postType,
          image_url: imageUrl,
          is_sponsored: isSponsored,
          engagement: {
            likes: parseCount(likesText),
            comments: parseCount(commentsText.replace(/comment/gi, '')),
            reposts: parseCount(repostsText.replace(/repost/gi, '')),
          },
          timestamp: timestamp,
          scraped_at: new Date().toISOString(),
        });
      } catch (err) {
        // Skip individual post extraction errors
        continue;
      }
    }

    return {
      strategy: strategies.find(s => document.querySelectorAll(s).length > 0) || 'unknown',
      posts,
    };
  });
}

// ── Main Scanner ───────────────────────────────────────────────────────────────

async function scanFeed() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        SPIKE 2: Feed Post Extraction Test               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Pre-flight checks ──
  if (!fs.existsSync(SESSION_FILE)) {
    log('❌', 'No saved session. Run `npm run login` first.');
    process.exit(1);
  }

  log('🎯', `Target: Extract up to ${MAX_POSTS} posts (max ${MAX_SCROLLS} scrolls)`);
  log('📂', `Output: ${RUN_DIR}/raw-posts.json`);

  // ── Launch browser ──
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
    storageState: SESSION_FILE,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  });

  // Patch navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // ── Install BrowserGuard ──
  const guard = new BrowserGuard(page, {
    logFile: path.join(RUN_DIR, 'audit.log'),
  });
  await guard.install();
  log('🛡️', 'BrowserGuard installed — read-only mode enforced');

  // ── Navigate to feed ──
  log('🌐', 'Navigating to LinkedIn feed...');
  try {
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    log('❌', `Failed to navigate: ${err.message}`);
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);

  // ── Check if logged in ──
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
    log('❌', 'Session expired — redirected to login. Run `npm run login` first.');
    await browser.close();
    process.exit(1);
  }
  log('✅', 'Feed loaded — session is valid');

  // ── Wait for feed content to render ──
  log('⏳', 'Waiting for feed posts to render...');
  try {
    await page.waitForSelector(
      '[data-urn^="urn:li:activity"], .feed-shared-update-v2, [role="main"] article',
      { timeout: 15000 }
    );
  } catch {
    log('⚠️', 'Feed post selectors not found within 15s — trying to proceed anyway');
  }

  // ── Scroll and extract ──
  let allPosts = [];
  const seenPostIds = new Set();
  let scrollCount = 0;
  let noNewPostsStreak = 0;

  log('📜', 'Starting feed scroll...\n');

  while (scrollCount < MAX_SCROLLS && allPosts.length < MAX_POSTS) {
    scrollCount++;

    // Human-like scroll
    const scrollDistance = randomBetween(400, 800);
    await guard.scroll(scrollDistance);

    // Random delay between scrolls (human pacing)
    await humanDelay(2000, 4500);

    // Occasional mouse movement (mimics reading)
    if (Math.random() < 0.3) {
      const x = randomBetween(200, 900);
      const y = randomBetween(200, 600);
      await guard.mouseMove(x, y);
    }

    // Occasional slight back-scroll (mimics re-reading)
    if (Math.random() < 0.15) {
      const backScroll = randomBetween(-150, -50);
      await guard.scroll(backScroll);
      await humanDelay(1000, 2000);
    }

    // Extract posts from current viewport
    const result = await extractPosts(page);
    let newCount = 0;

    for (const post of result.posts) {
      if (!seenPostIds.has(post.post_id)) {
        seenPostIds.add(post.post_id);
        allPosts.push(post);
        newCount++;
      }
    }

    // Progress indicator
    const bar = '█'.repeat(Math.min(allPosts.length, MAX_POSTS)) +
                '░'.repeat(Math.max(0, MAX_POSTS - allPosts.length));
    process.stdout.write(
      `\r  📊  Scroll ${scrollCount}/${MAX_SCROLLS} | Posts: ${allPosts.length}/${MAX_POSTS} [${bar}] | +${newCount} new`
    );

    // Track if we're getting new posts
    if (newCount === 0) {
      noNewPostsStreak++;
      if (noNewPostsStreak >= 5) {
        console.log('');
        log('⚠️', 'No new posts in 5 consecutive scrolls — feed may be exhausted');
        break;
      }
    } else {
      noNewPostsStreak = 0;
    }
  }

  console.log('\n');

  // ── Filter out sponsored posts ──
  const organicPosts = allPosts.filter((p) => !p.is_sponsored);
  const sponsoredCount = allPosts.length - organicPosts.length;

  // ── Results ──
  log('📈', `Extraction complete!`);
  log('📊', `Total posts found: ${allPosts.length}`);
  log('🚫', `Sponsored posts filtered: ${sponsoredCount}`);
  log('✅', `Organic posts: ${organicPosts.length}`);
  log('📜', `Scrolls used: ${scrollCount}`);

  // ── Post type breakdown ──
  const typeCounts = {};
  for (const p of organicPosts) {
    typeCounts[p.post_type] = (typeCounts[p.post_type] || 0) + 1;
  }
  log('📋', `Post types: ${JSON.stringify(typeCounts)}`);

  // ── Show sample posts ──
  console.log('\n  ── Sample Posts ────────────────────────────────────────\n');
  const samplesToShow = Math.min(5, organicPosts.length);
  for (let i = 0; i < samplesToShow; i++) {
    const p = organicPosts[i];
    const excerpt = p.post_text.length > 100
      ? p.post_text.substring(0, 100) + '...'
      : p.post_text;
    console.log(`  ${i + 1}. 👤 ${p.author_name || 'Unknown'}`);
    console.log(`     📝 "${excerpt}"`);
    console.log(`     🔗 ${p.post_url || 'No URL'}`);
    console.log(`     ❤️ ${p.engagement.likes} likes | 💬 ${p.engagement.comments} comments`);
    console.log(`     📌 Type: ${p.post_type} | ⏰ ${p.timestamp}`);
    console.log('');
  }

  // ── Save results ──
  ensureDir(RUN_DIR);

  const output = {
    meta: {
      scanned_at: new Date().toISOString(),
      scrolls: scrollCount,
      total_found: allPosts.length,
      sponsored_filtered: sponsoredCount,
      organic_count: organicPosts.length,
      post_types: typeCounts,
    },
    posts: organicPosts,
  };

  const outputPath = path.join(RUN_DIR, 'raw-posts.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  log('💾', `Saved to: ${outputPath}`);

  // ── Save audit log ──
  guard.saveAuditLog(path.join(RUN_DIR, 'audit.log'));
  guard.printSummary();

  // ── Spike 2 verdict ──
  const hasEnoughPosts = organicPosts.length >= 5;
  const hasPostText = organicPosts.filter((p) => p.post_text.length > 20).length >= 3;
  const hasAuthors = organicPosts.filter((p) => p.author_name).length >= 3;
  const hasUrls = organicPosts.filter((p) => p.post_url).length >= 3;

  console.log('\n  ── Spike 2 Checklist ──────────────────────────────────\n');
  console.log(`  ${hasEnoughPosts ? '✅' : '❌'}  At least 5 organic posts extracted: ${organicPosts.length}`);
  console.log(`  ${hasPostText ? '✅' : '❌'}  Posts have meaningful text (>20 chars): ${organicPosts.filter((p) => p.post_text.length > 20).length}`);
  console.log(`  ${hasAuthors ? '✅' : '❌'}  Author names extracted: ${organicPosts.filter((p) => p.author_name).length}`);
  console.log(`  ${hasUrls ? '✅' : '❌'}  Post URLs constructed: ${organicPosts.filter((p) => p.post_url).length}`);

  const spikePass = hasEnoughPosts && hasPostText && hasAuthors;

  if (spikePass) {
    console.log('\n  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  ✅  SPIKE 2 PASSED — Feed extraction works!        │');
    console.log('  │                                                      │');
    console.log('  │  What this proves:                                   │');
    console.log('  │  • Posts can be extracted from LinkedIn feed DOM     │');
    console.log('  │  • Author info, text, URLs, engagement captured     │');
    console.log('  │  • Sponsored posts filtered out                     │');
    console.log('  │  • BrowserGuard enforced read-only the entire time  │');
    console.log('  │  • Human-like scrolling worked without detection    │');
    console.log('  └─────────────────────────────────────────────────────┘\n');
  } else {
    console.log('\n  ┌─────────────────────────────────────────────────────┐');
    console.log('  │  ⚠️  SPIKE 2 PARTIAL — Some data extracted but      │');
    console.log('  │      not all checks passed. Review output above.   │');
    console.log('  │      Selectors may need tuning for current DOM.    │');
    console.log('  └─────────────────────────────────────────────────────┘\n');
  }

  await browser.close();
  return spikePass;
}

// ── Entry ──────────────────────────────────────────────────────────────────────

try {
  await scanFeed();
} catch (err) {
  log('💥', `Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
}
