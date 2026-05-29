/**
 * DOM Probe — Diagnostic tool
 * 
 * Target-searches for "Rakesh Gohel" or "Sandeep Gulati" to see where they live in the DOM.
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
  console.log('🌐 Navigating to feed...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // Take screenshot
  const screenshotPath = path.join(PROJECT_ROOT, 'data', 'dom-probe-screenshot.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`📸 Screenshot saved to: ${screenshotPath}`);

  // Probe
  const probeResult = await page.evaluate(() => {
    const results = {};
    results.url = window.location.href;
    results.title = document.title;
    results.bodyTextLength = document.body.innerText.length;

    // Helper: search by text
    const findElementByText = (text) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.includes(text)) {
          return node.parentElement;
        }
      }
      return null;
    };

    // Find the first role="listitem" post container
    const firstPost = document.querySelector('[role="listitem"]');
    results.postContainerFound = !!firstPost;
    
    if (firstPost) {
      results.containerTag = firstPost.tagName;
      
      // Discover all descendants with text content length > 40
      const largeTextElements = [];
      firstPost.querySelectorAll('*').forEach(el => {
        const text = el.textContent.trim();
        // Skip elements that just contain other elements with the same text
        const isLeafish = Array.from(el.children).filter(c => c.textContent.trim().length > 40).length === 0;
        if (text.length > 40 && isLeafish) {
          largeTextElements.push({
            tag: el.tagName,
            textSample: text.substring(0, 150),
            length: text.length,
            classes: Array.from(el.classList),
            attributes: Array.from(el.attributes).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {})
          });
        }
      });
      results.largeTextElements = largeTextElements;

      // Discover all links inside this post container
      const links = [];
      firstPost.querySelectorAll('a').forEach(a => {
        links.push({
          href: a.getAttribute('href'),
          text: a.textContent.trim().substring(0, 80),
          ariaLabel: a.getAttribute('aria-label'),
          classes: Array.from(a.classList)
        });
      });
      results.links = links;

      // Discover all images inside
      const images = [];
      firstPost.querySelectorAll('img').forEach(img => {
        images.push({
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt'),
          classes: Array.from(img.classList)
        });
      });
      results.images = images;

      // Find all text blocks inside to locate post text
      const textBlocks = [];
      // Traverse all leaf elements with text content
      const traverse = (el) => {
        if (el.children.length === 0 && el.textContent.trim().length > 0) {
          textBlocks.push({
            tag: el.tagName,
            classes: Array.from(el.classList),
            text: el.textContent.trim().substring(0, 150)
          });
        }
        Array.from(el.children).forEach(traverse);
      };
      traverse(firstPost);
      results.textBlocks = textBlocks;
    }

    return results;
  });

  const outputPath = path.join(PROJECT_ROOT, 'data', 'dom-probe.json');
  fs.writeFileSync(outputPath, JSON.stringify(probeResult, null, 2));
  console.log('\n📋 DOM Probe Results:\n');
  console.log(JSON.stringify(probeResult, null, 2));
  console.log(`\n💾 Saved to: ${outputPath}`);

  await browser.close();
}

probe().catch(console.error);
