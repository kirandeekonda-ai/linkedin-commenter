import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

async function main() {
  console.log('Launching browser to dump DOM structures...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();

  console.log('Navigating to feed...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const postsInfo = await page.evaluate(() => {
    const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));
    return listItems.map((item, idx) => {
      // Find all elements with data-urn or data-id or data-activity-id or other attributes
      const dataElements = Array.from(item.querySelectorAll('*')).filter(el => {
        return Array.from(el.attributes).some(attr => 
          attr.name.includes('urn') || 
          attr.name.includes('id') || 
          attr.name.includes('activity') ||
          attr.name.includes('key')
        );
      });

      const attrsDump = dataElements.map(el => {
        const itemAttrs = {};
        for (const attr of el.attributes) {
          itemAttrs[attr.name] = attr.value;
        }
        return {
          tagName: el.tagName,
          attrs: itemAttrs,
          textSample: el.textContent?.substring(0, 50).trim()
        };
      });

      // Let's also look for all anchor tags and see their hrefs
      const anchors = Array.from(item.querySelectorAll('a')).map(a => ({
        href: a.getAttribute('href'),
        text: a.textContent?.substring(0, 30).trim(),
        ariaLabel: a.getAttribute('aria-label')
      }));

      return {
        postIndex: idx,
        outerHtmlSample: item.outerHTML.substring(0, 300),
        dataElements: attrsDump,
        anchors
      };
    });
  });

  console.log('DOM Info extracted!');
  fs.writeFileSync(path.join(PROJECT_ROOT, 'data', 'dom-extracted.json'), JSON.stringify(postsInfo, null, 2));
  console.log('Saved to data/dom-extracted.json');

  await browser.close();
}

main().catch(err => {
  console.error(err);
});
