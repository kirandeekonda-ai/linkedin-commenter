import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

async function findScrollContainer() {
  console.log('Finding scroll container...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: SESSION_FILE });
  const page = await context.newPage();
  
  await page.goto('https://www.linkedin.com/feed/?sortBy=recent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  const containerInfo = await page.evaluate(() => {
    const info = [];
    
    // Check scrollingElement
    const se = document.scrollingElement;
    info.push({
      name: 'scrollingElement',
      tagName: se ? se.tagName : 'none',
      clientHeight: se ? se.clientHeight : 0,
      scrollHeight: se ? se.scrollHeight : 0,
      scrollTop: se ? se.scrollTop : 0
    });
    
    // Check all divs
    const allDivs = document.querySelectorAll('div, main, section, body, html');
    for (const el of allDivs) {
      if (el.scrollHeight > el.clientHeight + 50) {
        // Find if it has overflow scroll or auto
        const style = window.getComputedStyle(el);
        const overflow = style.overflow + ' ' + style.overflowY;
        if (overflow.includes('scroll') || overflow.includes('auto') || el.tagName === 'BODY' || el.tagName === 'HTML') {
          const classes = Array.from(el.classList).join('.');
          info.push({
            tagName: el.tagName,
            id: el.id,
            class: classes,
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            scrollTop: el.scrollTop,
            overflow
          });
        }
      }
    }
    
    return info;
  });
  
  console.log('Scroll Container Candidates:', JSON.stringify(containerInfo, null, 2));
  await browser.close();
}

findScrollContainer().catch(console.error);
