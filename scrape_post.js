import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SESSION_FILE = './data/browser-state/session.json';
const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7469978412246450176/';
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
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  console.log('Navigating to:', POST_URL);
  await page.goto(POST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // Wait for page to settle

  // Find all images and print details
  const imgDetails = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(i => ({
      className: i.className,
      src: i.getAttribute('src'),
      dataDelayedUrl: i.getAttribute('data-delayed-url'),
      dataSrc: i.getAttribute('data-src'),
      alt: i.getAttribute('alt')
    }));
  });

  console.log('--- ALL IMAGES ON THE PAGE ---');
  imgDetails.forEach((img, index) => {
    console.log(`[${index + 1}] class: "${img.className}"`);
    console.log(`    src: "${img.src}"`);
    console.log(`    data-delayed-url: "${img.dataDelayedUrl}"`);
    console.log(`    data-src: "${img.dataSrc}"`);
    console.log(`    alt: "${img.alt}"`);
  });
  console.log('------------------------------');

  await browser.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
