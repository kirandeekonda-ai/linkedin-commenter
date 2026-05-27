/**
 * DOM Probe — Diagnostic tool
 * 
 * Opens LinkedIn feed and dumps the actual HTML structure
 * of post elements so we can find the right selectors.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

async function probe() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // Probe: What selectors exist for author info?
  const probe = await page.evaluate(() => {
    const results = {};

    // Find the first post container
    const postSelectors = [
      '[data-urn^="urn:li:activity"]',
      '.feed-shared-update-v2',
      '.occludable-update',
    ];

    let firstPost = null;
    for (const sel of postSelectors) {
      firstPost = document.querySelector(sel);
      if (firstPost) {
        results.postSelector = sel;
        break;
      }
    }

    if (!firstPost) {
      results.error = 'No post container found';
      return results;
    }

    // Dump the outer HTML of the actor/author area (first 3000 chars)
    const actorSelectors = [
      '.update-components-actor',
      '.feed-shared-actor',
      '.update-components-actor__container',
      '.update-components-actor__meta',
    ];

    for (const sel of actorSelectors) {
      const el = firstPost.querySelector(sel);
      if (el) {
        results[`actor_html_${sel}`] = el.outerHTML.substring(0, 2000);
      }
    }

    // Try various name selectors and report what they return
    const nameSelectors = [
      '.update-components-actor__name',
      '.update-components-actor__name span',
      '.update-components-actor__name span[aria-hidden="true"]',
      '.update-components-actor__name .hoverable-link-text',
      '.update-components-actor__name .hoverable-link-text span[aria-hidden="true"]',
      '.update-components-actor__title',
      '.update-components-actor__title span[aria-hidden="true"]',
      '.feed-shared-actor__name',
      '.feed-shared-actor__title',
      'a.app-aware-link[href*="/in/"] span',
      '.update-components-actor__container-link',
      '.update-components-actor__meta-link',
      'span.update-components-actor__name',
      'span.update-components-actor__title',
    ];

    results.nameResults = {};
    for (const sel of nameSelectors) {
      const el = firstPost.querySelector(sel);
      results.nameResults[sel] = el
        ? { text: el.textContent.trim().substring(0, 100), tagName: el.tagName, childCount: el.children.length }
        : null;
    }

    // Try getting ALL text nodes that might be the author name
    // Look at the top portion of the post
    const allLinks = firstPost.querySelectorAll('a[href*="/in/"]');
    results.profileLinks = Array.from(allLinks).slice(0, 3).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim().substring(0, 100),
      ariaLabel: a.getAttribute('aria-label'),
    }));

    // Check for headline/description
    const descSelectors = [
      '.update-components-actor__description',
      '.update-components-actor__subtitle',
      '.update-components-actor__sub-description',
      '.feed-shared-actor__description',
    ];
    results.descResults = {};
    for (const sel of descSelectors) {
      const el = firstPost.querySelector(sel);
      results.descResults[sel] = el ? el.textContent.trim().substring(0, 200) : null;
    }

    // Get all class names in the actor area for discovery
    const actorArea = firstPost.querySelector('.update-components-actor') || firstPost;
    const allClasses = new Set();
    actorArea.querySelectorAll('*').forEach(el => {
      el.classList.forEach(c => allClasses.add(c));
    });
    results.allActorClasses = Array.from(allClasses).sort();

    return results;
  });

  // Write probe results
  const outputPath = path.join(PROJECT_ROOT, 'data', 'dom-probe.json');
  fs.writeFileSync(outputPath, JSON.stringify(probe, null, 2));
  console.log('\n📋 DOM Probe Results:\n');
  console.log(JSON.stringify(probe, null, 2));
  console.log(`\n💾 Saved to: ${outputPath}`);

  await browser.close();
}

probe().catch(console.error);
