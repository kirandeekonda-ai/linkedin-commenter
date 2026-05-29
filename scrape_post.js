import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_FILE = './data/browser-state/session.json';
const POST_URL = 'https://www.linkedin.com/posts/sumanth077_turn-any-git-repo-into-an-ai-agent-gitagent-share-7465757538484023296-3oFK/';
const OUTPUT_FILE = './data/scraped-post.json';

async function main() {
  console.log('Starting Playwright...');
  const browser = await chromium.launch({ headless: true });
  
  let contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  };

  if (fs.existsSync(SESSION_FILE)) {
    console.log('Loading session from:', SESSION_FILE);
    contextOptions.storageState = SESSION_FILE;
  } else {
    console.log('WARNING: Session file not found, running without session!');
  }

  const context = await browser.newContext(contextOptions);
  
  // Patch navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  
  console.log('Navigating to:', POST_URL);
  await page.goto(POST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // Wait for page to settle

  console.log('Current URL:', page.url());

  // Click "see more" button if visible
  try {
    const seeMoreButtons = await page.$$('button:has-text("see more"), button:has-text("...see more"), span:has-text("...see more")');
    console.log(`Found ${seeMoreButtons.length} potential "see more" buttons.`);
    for (const btn of seeMoreButtons) {
      if (await btn.isVisible()) {
        console.log('Clicking "see more" button...');
        await btn.click({ force: true });
        await page.waitForTimeout(1000);
      }
    }
  } catch (err) {
    console.log('Error clicking see-more:', err.message);
  }

  // Extract content
  const postData = await page.evaluate(() => {
    // Try multiple selectors for author name
    let authorName = '';
    const nameSelectors = [
      '.update-components-actor__title',
      '.update-components-actor__name span[aria-hidden="true"]',
      '.feed-shared-actor__name span[aria-hidden="true"]',
      '.update-components-actor__name',
      '.feed-identity-module__name',
      'h1.text-heading-xlarge', // in case we went to profile page
      'a[href*="/in/"]'
    ];
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        authorName = el.textContent.trim().split('•')[0].trim();
        break;
      }
    }

    // Try multiple selectors for author headline
    let authorHeadline = '';
    const headlineSelectors = [
      '.update-components-actor__description',
      '.update-components-actor__subtitle',
      '.feed-shared-actor__description',
      '.text-body-medium.break-words'
    ];
    for (const sel of headlineSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        authorHeadline = el.textContent.trim();
        break;
      }
    }

    // Try multiple selectors for post text
    let postText = '';
    const textSelectors = [
      '.feed-shared-update-v2__description .break-words',
      '.update-components-text span.break-words',
      '.feed-shared-text .break-words',
      '[data-testid="expandable-text-box"]',
      '.update-components-text',
      'span[dir="ltr"]',
      '.feed-shared-update-v2__commentary'
    ];
    for (const sel of textSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el && el.textContent.trim()) {
          const t = el.textContent.replace(/\s+/g, ' ').trim();
          if (t.length > postText.length) {
            postText = t;
          }
        }
      }
    }

    // Fallback: get text of whole body if needed
    if (!postText) {
      const main = document.querySelector('main') || document.body;
      postText = main ? main.innerText : '';
    }

    return {
      authorName,
      authorHeadline,
      postText
    };
  });

  console.log('Extracted Post Data:');
  console.log('Author Name:', postData.authorName);
  console.log('Author Headline:', postData.authorHeadline);
  console.log('Post Text Length:', postData.postText.length);
  console.log('Post Text Snippet:', postData.postText.slice(0, 300) + '...');

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(postData, null, 2), 'utf-8');
  console.log('Saved to:', OUTPUT_FILE);

  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
