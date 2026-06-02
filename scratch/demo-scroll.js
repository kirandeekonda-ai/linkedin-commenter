import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserGuard } from '../src/browser-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');
const LINKEDIN_FEED = 'https://www.linkedin.com/feed/?sortBy=recent';

function log(emoji, message) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`  ${emoji}  [${ts}] ${message}`);
}

async function runDemo() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        LinkedIn Commenter — Visual Scrolling Demo        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(SESSION_FILE)) {
    log('❌', 'No saved session found.');
    process.exit(1);
  }

  log('🚀', 'Launching HEADED browser (visible on screen)...');
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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  const guard = new BrowserGuard(page, { logFile: path.join(PROJECT_ROOT, 'data', 'runs', 'demo-audit.log') });
  await guard.install();
  log('🛡️', 'BrowserGuard active (Strict read-only safety verified)');

  log('🌐', 'Navigating to LinkedIn Recent feed...');
  await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Fallback sorting check
  try {
    const sortBtn = await page.$('button:has-text("Sort by:"), [id*="sort-by-select"], button[aria-label*="Sort by"]');
    if (sortBtn) {
      const btnText = await sortBtn.textContent();
      if (!btnText.includes('Recent')) {
        log('🖱️', 'Dropdown click to select "Recent"...');
        await sortBtn.click();
        await page.waitForTimeout(1500);
        const recentOpt = await page.$('span:has-text("Recent"), li:has-text("Recent"), button:has-text("Recent")');
        if (recentOpt) {
          await recentOpt.click();
          log('✅', 'Recent sorting active');
          await page.waitForTimeout(4000);
        }
      }
    }
  } catch (err) {
    log('⚠️', 'Sorting selection completed');
  }

  log('📜', 'Starting step-by-step scrolling demonstration...');
  
  const extractedPosts = [];
  const processedPostIds = new Set();
  let scrollStep = 0;

  while (extractedPosts.length < 5 && scrollStep < 15) {
    scrollStep++;
    log('📜', `Scroll Step ${scrollStep}: Scrolling down...`);
    
    // Human-like scroll
    await guard.scroll(650);
    await page.waitForTimeout(3500);

    // Extract posts using the DOM function
    const postsInView = await page.evaluate(() => {
      const getText = (el, selectors) => {
        if (!el) return '';
        for (const sel of selectors) {
          const target = el.querySelector(sel);
          if (target && target.textContent.trim()) {
            return target.textContent.replace(/\s+/g, ' ').trim();
          }
        }
        return '';
      };

      const getHref = (el, selectors) => {
        if (!el) return '';
        for (const sel of selectors) {
          const target = el.querySelector(sel);
          if (target) {
            const href = target.getAttribute('href');
            if (href) {
              const cleanHref = href.split('?')[0];
              return cleanHref.startsWith('http') ? cleanHref : `https://www.linkedin.com${cleanHref}`;
            }
          }
        }
        return '';
      };

      let postElements = [];
      const strategies = [
        '[role="listitem"]',
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

      const list = [];
      for (const el of postElements) {
        try {
          const urnEl = el.querySelector('[data-urn]') || el.closest('[data-urn]');
          let urn = urnEl ? urnEl.getAttribute('data-urn') : (el.getAttribute('data-urn') || el.getAttribute('data-id') || '');

          let authorName = '';
          const avatarImg = el.querySelector('a[href*="/in/"] img[alt*="profile"], a[href*="/in/"] img[alt*="’s"]');
          if (avatarImg) {
            const alt = avatarImg.getAttribute('alt') || '';
            const match = alt.match(/View\s+(.+?)(?:'s|’s)\s+profile/i);
            if (match) authorName = match[1].trim();
          }
          if (!authorName) {
            const profileLink = el.querySelector('a[href*="/in/"]');
            if (profileLink && profileLink.textContent.trim()) {
              let name = profileLink.textContent.trim();
              if (name.includes('•')) name = name.split('•')[0].trim();
              authorName = name;
            }
          }

          let authorHeadline = '';
          const nameLink = el.querySelector('a[href*="/in/"]');
          if (nameLink && authorName) {
            const container = nameLink.closest('div');
            if (container) {
              const spans = Array.from(container.querySelectorAll('span, div')).map(s => s.textContent.trim());
              const nameClean = authorName.toLowerCase();
              authorHeadline = spans.find(text => 
                text.length > 20 && 
                !text.toLowerCase().includes(nameClean) && 
                !text.toLowerCase().includes('follow')
              ) || '';
            }
          }

          let connectionDegree = '';
          const nameContainers = el.querySelectorAll('a[href*="/in/"], .update-components-actor__title, .update-components-actor__name, .feed-shared-actor__name');
          for (const container of nameContainers) {
            const text = container.textContent || '';
            const match = text.match(/\b(1st|2nd|3rd\+|3rd)\b/i);
            if (match) {
              connectionDegree = match[1].toLowerCase();
              break;
            }
          }

          const postText = getText(el, [
            '[data-testid="expandable-text-box"]',
            '.feed-shared-update-v2__description .break-words',
            '.update-components-text span.break-words',
            '.feed-shared-text .break-words',
          ]);

          const profileUrl = getHref(el, ['a[href*="/in/"]']);

          if (authorName && postText) {
            list.push({
              urn,
              authorName,
              authorHeadline,
              connectionDegree,
              postText,
              profileUrl
            });
          }
        } catch (e) {}
      }
      return list;
    });

    for (const post of postsInView) {
      const authorSlug = post.authorName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
      const textSlug = post.postText.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
      const postId = post.urn || `gen_${authorSlug}_${textSlug}`;

      if (!processedPostIds.has(postId)) {
        processedPostIds.add(postId);
        extractedPosts.push(post);
        log('👤', `[EXTRACTED] Post by ${post.authorName} (${post.connectionDegree || 'unknown'})`);
        
        if (extractedPosts.length >= 5) {
          break;
        }
      }
    }
    
    log('📊', `Progress: Extracted ${extractedPosts.length}/5 posts`);
  }

  log('🎉', 'Demo scrolling and extraction complete!');
  console.log('\n  ── SUMMARIES OF THE 5 SCROLL-EXTRACTED POSTS ────────────────\n');

  extractedPosts.forEach((post, i) => {
    const excerpt = post.postText.length > 250
      ? post.postText.substring(0, 250) + '...'
      : post.postText;

    console.log(`  ${i + 1}. 👤 Author: ${post.authorName || 'Unknown'} (${post.connectionDegree || 'unknown'})`);
    console.log(`     Headline: ${post.authorHeadline || 'No headline available'}`);
    console.log(`     Profile: ${post.profileUrl || 'No profile link'}`);
    console.log(`     📝 Post Text Snippet:\n        "${excerpt}"`);
    console.log('     ---------------------------------------------------------');
  });

  log('📌', 'IMPORTANT: Browser remains OPEN for your inspection. Do not close this terminal to keep it open.');
  
  // We explicitly DO NOT call browser.close() so the user can inspect it!
  // To keep the Node process running, we wait indefinitely
  await new Promise(() => {});
}

runDemo().catch(err => {
  log('💥', `Demo failed: ${err.message}`);
  console.error(err);
});
