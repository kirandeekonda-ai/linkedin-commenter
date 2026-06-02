import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

async function testScroll() {
  console.log('Testing scroll properties on LinkedIn...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();
  
  await page.goto('https://www.linkedin.com/feed/?sortBy=recent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  const scrollInfo = await page.evaluate(() => {
    const beforeScroll = {
      scrollY: window.scrollY,
      pageYOffset: window.pageYOffset,
      scrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      scrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
    };
    
    window.scrollBy(0, 500);
    
    const afterScroll = {
      scrollY: window.scrollY,
      pageYOffset: window.pageYOffset,
      scrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
    };
    
    return { beforeScroll, afterScroll };
  });
  
  console.log('Scroll Results:', JSON.stringify(scrollInfo, null, 2));
  await browser.close();
}

testScroll().catch(console.error);
