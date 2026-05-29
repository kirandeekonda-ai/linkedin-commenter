import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

const today = new Date().toISOString().split('T')[0];
const RUN_DIR = path.join(PROJECT_ROOT, 'data', 'runs', today);
const RAW_POSTS_FILE = path.join(RUN_DIR, 'raw-posts.json');
const FILTERED_POSTS_FILE = path.join(RUN_DIR, 'filtered-posts.json');
const COMMENTS_FILE = path.join(RUN_DIR, 'comments.json');

// Protobuf URN decoder
function decodeBase64ProtobufUrn(text) {
  if (!text) return null;
  const matches = text.match(/(?:Cgs|Egs)I[A-Za-z0-9+/=_-]{12,40}/g);
  if (!matches) return null;
  
  for (const rawMatch of matches) {
    let base64 = rawMatch.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      if (bytes[0] === 0x0a && bytes[2] === 0x08) {
        const len = bytes[1];
        const varintBytes = bytes.slice(3, 3 + len - 1);
        let val = 0n;
        let shift = 0n;
        for (let b of varintBytes) {
          val |= BigInt(b & 0x7f) << shift;
          shift += 7n;
        }
        const activityId = val >> 1n;
        if (activityId >= 7000000000000000000n && activityId <= 8000000000000000000n) {
          return 'urn:li:activity:' + activityId.toString();
        }
      }
    } catch (err) {
      // ignore
    }
  }
  return null;
}

async function repairLinks() {
  console.log('--- LinkedIn Link Repair Tool ---');
  
  if (!fs.existsSync(COMMENTS_FILE)) {
    console.log(`Error: Comments file for today not found at: ${COMMENTS_FILE}`);
    process.exit(1);
  }
  
  const comments = JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf-8'));
  const rawPostsData = fs.existsSync(RAW_POSTS_FILE) ? JSON.parse(fs.readFileSync(RAW_POSTS_FILE, 'utf-8')) : null;
  const filteredPostsData = fs.existsSync(FILTERED_POSTS_FILE) ? JSON.parse(fs.readFileSync(FILTERED_POSTS_FILE, 'utf-8')) : null;
  
  console.log(`Loaded ${comments.length} comments to repair.`);
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
  };

  
  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  } else {
    console.log('Error: Playwright session file not found. Run npm run login first.');
    await browser.close();
    process.exit(1);
  }
  
  const context = await browser.newContext(contextOptions);
  
  // Patch navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  
  console.log('Initializing session by navigating to LinkedIn feed...');
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
      console.log('Error: Session is expired on feed initialization. Please run node src/login-manager.js --login');
      await browser.close();
      process.exit(1);
    }
    console.log('Session successfully initialized and verified!');
  } catch (err) {
    console.log(`Warning during session initialization: ${err.message}`);
  }
  
  let repairedCount = 0;

  
  for (const c of comments) {
    const isProfileLink = c.post_url && (c.post_url.includes('/in/') || c.post_url.includes('/company/'));
    const isRecentActivity = c.post_url && c.post_url.includes('/recent-activity/');
    
    if (isProfileLink || isRecentActivity) {
      console.log(`\nRepairing link for post by "${c.post_author}"...`);
      const targetUrl = c.post_url;
      console.log(`Navigating to author page: ${targetUrl}`);
      
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);
        
        const currentUrl = page.url();
        if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
          console.log(`⚠️ Warning: LinkedIn redirected to a security wall/login. Skipping "${c.post_author}" to avoid rate limits...`);
          continue;
        }
        
        // Find all post elements on the page
        const postData = await page.evaluate((excerpt) => {
          // Helper: decode URN
          const decodeBase64ProtobufUrn = (text) => {
            if (!text) return null;
            const matches = text.match(/(?:Cgs|Egs)I[A-Za-z0-9+/=_-]{12,40}/g);
            if (!matches) return null;
            
            for (const rawMatch of matches) {
              let base64 = rawMatch.replace(/-/g, '+').replace(/_/g, '/');
              while (base64.length % 4 !== 0) {
                base64 += '=';
              }
              
              try {
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                
                if (bytes[0] === 0x0a && bytes[2] === 0x08) {
                  const len = bytes[1];
                  const varintBytes = bytes.slice(3, 3 + len - 1);
                  let val = 0n;
                  let shift = 0n;
                  for (let b of varintBytes) {
                    val |= BigInt(b & 0x7f) << shift;
                    shift += 7n;
                  }
                  const activityId = val >> 1n;
                  if (activityId >= 7000000000000000000n && activityId <= 8000000000000000000n) {
                    return 'urn:li:activity:' + activityId.toString();
                  }
                }
              } catch (err) {
                // ignore
              }
            }
            return null;
          };

          const cleanExcerpt = excerpt.substring(0, 40).toLowerCase();
          const posts = Array.from(document.querySelectorAll('[role="listitem"], article, .feed-shared-update-v2'));
          
          for (const el of posts) {
            const text = el.textContent || '';
            if (text.toLowerCase().includes(cleanExcerpt)) {
              // Try to decode URN from this element's outerHTML
              const urn = decodeBase64ProtobufUrn(el.outerHTML);
              if (urn) {
                return { urn, found: true };
              }
            }
          }
          return { found: false };
        }, c.post_excerpt);
        
        if (postData && postData.found && postData.urn) {
          const directUrl = `https://www.linkedin.com/feed/update/${postData.urn}/`;
          console.log(`✅ Success! Found direct URL: ${directUrl}`);
          
          // Update comments state
          c.post_url = directUrl;
          repairedCount++;
          
          // Update raw posts state
          if (rawPostsData && rawPostsData.posts) {
            const rawIdx = rawPostsData.posts.findIndex(p => p.author_name === c.post_author);
            if (rawIdx !== -1) {
              rawPostsData.posts[rawIdx].post_url = directUrl;
            }
          }
          
          // Update filtered posts state
          if (filteredPostsData && filteredPostsData.posts) {
            const filtIdx = filteredPostsData.posts.findIndex(p => p.author_name === c.post_author);
            if (filtIdx !== -1) {
              filteredPostsData.posts[filtIdx].post_url = directUrl;
            }
          }
        } else {
          console.log(`⚠️ Match not found on the page for this post's excerpt.`);
        }
      } catch (err) {
        console.log(`❌ Error scanning page: ${err.message}`);
      }
      
      // Add a human-like delay between navigations to prevent rate limits
      const delay = Math.floor(Math.random() * (8000 - 5000 + 1)) + 5000;
      console.log(`Waiting ${delay}ms before next navigation...`);
      await page.waitForTimeout(delay);
    } else {
      console.log(`Post by "${c.post_author}" already has a direct URL: ${c.post_url}`);
    }
  }
  
  await browser.close();
  
  if (repairedCount > 0) {
    console.log(`\nSaving ${repairedCount} updated post links...`);
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf-8');
    if (rawPostsData) fs.writeFileSync(RAW_POSTS_FILE, JSON.stringify(rawPostsData, null, 2), 'utf-8');
    if (filteredPostsData) fs.writeFileSync(FILTERED_POSTS_FILE, JSON.stringify(filteredPostsData, null, 2), 'utf-8');
    console.log('🎉 Repair complete! Today\'s links have been updated.');
  } else {
    console.log('\nNo links were repaired.');
  }
}

repairLinks().catch(err => {
  console.error('Fatal repair error:', err);
});
