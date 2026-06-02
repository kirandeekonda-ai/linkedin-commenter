import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BrowserGuard } from './browser-guard.js';

// ── Config ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const HISTORY_FILE = path.join(DATA_DIR, 'comment-history.json');

const today = new Date().toISOString().split('T')[0];
const RUN_DIR = path.join(PROJECT_ROOT, 'data', 'runs', today);
const LINKEDIN_FEED = 'https://www.linkedin.com/feed/';

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

// ── Scoring & Connection Degree Evaluator ──────────────────────────────────────

function scorePostRelevance(postText, authorHeadline) {
  const text = (postText || '').toLowerCase();
  const headline = (authorHeadline || '').toLowerCase();
  
  let score = 0.5; // base score
  const matches = [];

  const keywords = {
    agentic: { weight: 0.15, label: "Agentic AI platform design" },
    "multi-agent": { weight: 0.15, label: "Multi-agent orchestration" },
    orchestration: { weight: 0.12, label: "Agentic orchestration" },
    governance: { weight: 0.12, label: "AI governance" },
    "self-hosted": { weight: 0.15, label: "Self-hosted AI infrastructure" },
    "human-in-the-loop": { weight: 0.12, label: "HITL governance" },
    hitl: { weight: 0.12, label: "HITL governance" },
    "model context protocol": { weight: 0.15, label: "Model Context Protocol (MCP)" },
    mcp: { weight: 0.15, label: "Model Context Protocol (MCP)" },
    "systems architect": { weight: 0.12, label: "Systems Architecture" },
    observability: { weight: 0.10, label: "Observability/monitoring" },
    rag: { weight: 0.08, label: "RAG systems design" },
    "vector database": { weight: 0.06, label: "Vector database integration" },
    "fastapi": { weight: 0.08, label: "API boundary contract" },
    "pydantic": { weight: 0.08, label: "Data validation contracts" },
    "production-grade": { weight: 0.06, label: "Production-grade AI systems" },
    "enterprise": { weight: 0.05, label: "Enterprise scale systems" }
  };

  for (const [kw, info] of Object.entries(keywords)) {
    if (text.includes(kw) || headline.includes(kw)) {
      score += info.weight;
      matches.push(info.label);
    }
  }

  score = Math.min(score, 0.99);

  return {
    score: parseFloat(score.toFixed(2)),
    reason: matches.length > 0 
      ? `Discusses ${Array.from(new Set(matches)).slice(0, 3).join(', ')}, mapping perfectly to your principal enterprise architect profile.`
      : "Relevant general software engineering or AI technology discussion."
  };
}

// ── Comment Generator Vault ────────────────────────────────────────────────────

// Global set to keep track of generated comments in the current execution run to ensure zero duplication
const usedComments = new Set();

const COMMENT_TEMPLATES = [
  {
    id: "20_80_split",
    keywords: ["anthropic", "claude", "mistake", "20% model", "80% model", "agent stack", "reliability"],
    tone: "experience",
    comment: "This 20/80 split is the absolute truth of enterprise agentic design. In our platform work, we've found that the reasoning engine is merely a probabilistic compiler, whereas actual stability comes from strict boundary schemas, self-hosted sandboxing, and deterministic state management. If you don't build a robust, transparent governance wrapper around the model, you're just scaling unquantifiable errors in production."
  },
  {
    id: "filesystem_memory",
    keywords: ["memory", "state", "organize", "fail", "context", "history", "resumable", "struggle"],
    tone: "addition",
    comment: "This is why the filesystem-as-memory model is replacing vector-only context stores for complex execution. When you treat agent state as a resumable, structured document tree rather than a single massive text history, long-running processes become highly reliable. It moves the cognitive burden out of the prompt window and into the application boundary."
  },
  {
    id: "model_routing",
    keywords: ["routing", "multi-model", "specialized", "composable", "slm", "lrm", "inference", "cost"],
    tone: "experience",
    comment: "Designing custom model-routing logic is where real enterprise cost-efficiency and performance is won. We've had great success using lightweight SLMs for initial intent classification, then routing complex planning to heavy reasoning models before handing execution off to structured tool-calling nodes. Composable intelligence is the only practical way to run these platforms without going bankrupt on inference costs."
  },
  {
    id: "validation_contracts",
    keywords: ["fastapi", "pydantic", "contract", "validation", "schema", "retry", "boundary"],
    tone: "addition",
    comment: "FastAPI combined with custom Pydantic schemas provides the exact contract layer needed to stabilize agent outputs in production. In our implementations, treating model responses as strict data schemas rather than raw text allows us to run deterministic validations and orchestrate graceful retries before errors ever bubble up. The real engineering happens at these boundary contracts, not in the LLM prompts."
  },
  {
    id: "org_operating_model",
    keywords: ["governance", "operating model", "institution", "transform", "organizat", "rethink", "ceo", "board", "process"],
    tone: "experience",
    comment: "Redesigning organization boundaries is the most overlooked phase of AI adoption. If you drop multi-agent platforms onto unmodified workflows, you just get faster, more expensive bad decisions. True enterprise modernization means redefining data ownership, establishing strict human-in-the-loop validation checkpoints, and adapting the compliance model to govern autonomous agents."
  },
  {
    id: "rag_semantic_chunking",
    keywords: ["rag", "retrieval", "semantic", "vector", "chunking", "ingestion", "hallucinat", "data"],
    tone: "addition",
    comment: "Moving RAG from a demo to enterprise reliability is 90% ingestion and 10% model execution. Simple paragraph splitting is the main source of context drift; we've moved entirely to structural semantic chunking and deterministic schema verification before the synthesis step to guarantee repeatable results."
  },
  {
    id: "hexagonal_independence",
    keywords: ["hexagonal", "decouple", "vendor", "lock-in", "swap", "independent", "local"],
    tone: "experience",
    comment: "The hexagonal pattern is particularly vital as the model landscape commoditizes. We always architect our systems to be completely decoupled from specific model providers, allowing us to swap models or run self-hosted LLMs locally without changing the core orchestration logic. It's the only way to avoid vendor lock-in and keep infrastructure costs under control in the long run."
  },
  {
    id: "hierarchical_memory",
    keywords: ["tiered", "episodic", "memory", "cache", "latency", "eviction", "storage"],
    tone: "experience",
    comment: "Hierarchical memory is essential for long-running agent runtimes, but we quickly run into latency overhead without clear eviction policies. In our enterprise deployments, we've implemented strict tiered storage to keep the active reasoning context clean while archiving episodic history. The hard part is always establishing deterministic rules for when to offload warm memory to cold vector stores."
  },
  {
    id: "token_auditing",
    keywords: ["token", "budget", "cost", "caching", "proxy", "spend", "gateway"],
    tone: "addition",
    comment: "The transition from subsidized tokens to rigorous token auditing is inevitable for enterprise budgets. Beyond just restricting code generation, organizations must build transparent proxy caching and semantic deduplication layers at the API level to keep costs predictable. If you don't own the observability of your token spend, you don't own the infrastructure."
  },
  {
    id: "pre_retrieval_parsing",
    keywords: ["fuzzy", "parsing", "key-value", "entity", "match", "identif", "retrieve"],
    tone: "experience",
    comment: "Relying purely on semantic vector spaces for exact identifiers is a common design flaw in enterprise RAG systems. We've found that embedding models are fundamentally built for fuzzy semantic matches, not deterministic key-value retrieval. The most resilient solution is routing queries through an explicit pre-retrieval parser that separates exact entity keys from concept-based search before they ever hit the database."
  },
  {
    id: "devops_pipelines",
    keywords: ["devops", "kubernetes", "k8s", "terraform", "infrastructure", "drift", "deploy", "build"],
    tone: "addition",
    comment: "This is why building declarative infrastructure pipelines is critical for enterprise scale. Moving from manual resource provisioning to structured, version-controlled state definitions under Terraform or Kubernetes is exactly how we eliminate drift and enable reliable developer environments."
  },
  {
    id: "database_optimization",
    keywords: ["database", "postgres", "sql", "query", "index", "bottleneck", "cache"],
    tone: "experience",
    comment: "Query optimization and proper schema indexing are where database stability is actually won. In our scaling work, we've found that throwing hardware or read-replicas at database bottlenecks is a temporary fix; the real solution is designing clean, normalized boundary schemas and a robust query caching strategy."
  },
  {
    id: "modular_hexagonal_architecture",
    keywords: ["code", "refactor", "clean", "design pattern", "modularity", "interface", "skills"],
    tone: "experience",
    comment: "Prioritizing modularity and interface-driven design is the only way to keep enterprise codebases maintainable over a multi-year lifecycle. When we decouple core domain logic from external dependencies like database gateways or web APIs, the entire application becomes much easier to test, modernise, and debug under load."
  },
  {
    id: "agentic_rag_latency",
    keywords: ["agentic rag", "latency", "compounding", "iterative", "loop"],
    tone: "addition",
    comment: "Moving from static RAG to dynamic, agentic RAG is where we start addressing real-world query ambiguity. However, in enterprise systems, this iterative loop introduces compounding latency. Implementing deterministic routing policies and caching layers at the orchestration level is critical to keep these dynamic agent loops performant under load."
  },
  {
    id: "fallback_probabilistic",
    keywords: ["probabilistic", "state machine", "safety gate", "systems", "stability", "guardrail"],
    tone: "addition",
    comment: "Closing the gap between dynamic agent workflows and enterprise stability requires moving away from plain-text prompting toward deterministic execution boundaries. Wrapping probabilistic models in robust state machines and strict boundary schemas is the only way to move from experimental PoC to production impact."
  }
];

function generateArchitectComment(postText, authorName, historicalComments = new Set()) {
  const text = postText.toLowerCase();
  
  // Calculate fit score for each template based on keyword matching
  const scoredTemplates = COMMENT_TEMPLATES.map(tmpl => {
    // Skip if already used in this run or found in historical comments to ensure zero duplicates
    if (usedComments.has(tmpl.id) || historicalComments.has(tmpl.comment)) {
      return { tmpl, score: -1 };
    }
    
    let matchCount = 0;
    tmpl.keywords.forEach(kw => {
      if (text.includes(kw)) {
        matchCount++;
      }
    });
    
    return { tmpl, score: matchCount };
  });
  
  // Sort by score descending
  scoredTemplates.sort((a, b) => b.score - a.score);
  
  // Select the highest-scoring unused template
  const bestMatch = scoredTemplates.find(st => st.score >= 0);
  
  if (bestMatch && bestMatch.tmpl) {
    usedComments.add(bestMatch.tmpl.id);
    return {
      tone: bestMatch.tmpl.tone,
      comment: bestMatch.tmpl.comment
    };
  }
  
  return {
    tone: "addition",
    comment: `This is an important point, ${authorName}. Closing the gap between dynamic agent workflows and enterprise stability requires moving away from plain-text prompting toward deterministic execution boundaries. Wrapping probabilistic models in robust state machines and strict boundary schemas is the only way to move from experimental PoC to production impact.`
  };
}

// ── DOM Post Extraction ────────────────────────────────────────────────────────

async function extractPostsFromDOM(page) {
  return await page.evaluate(() => {
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

    const decodeBase64ProtobufUrn = (text) => {
      if (!text) return null;
      const matches = text.match(/(?:Cgs|Egs)I[A-Za-z0-9+/=_-]{12,40}/g);
      if (!matches) return null;
      for (const rawMatch of matches) {
        let base64 = rawMatch.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) base64 += '=';
        try {
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          if (bytes[0] === 0x0a && bytes[2] === 0x08) {
            const len = bytes[1];
            const varintBytes = bytes.slice(3, 3 + len - 1);
            let val = 0n, shift = 0n;
            for (let b of varintBytes) {
              val |= BigInt(b & 0x7f) << shift;
              shift += 7n;
            }
            const activityId = val >> 1n;
            if (activityId >= 7000000000000000000n && activityId <= 8000000000000000000n) {
              return 'urn:li:activity:' + activityId.toString();
            }
          }
        } catch (err) {}
      }
      return null;
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

    const posts = [];
    for (const el of postElements) {
      try {
        const urnEl = el.querySelector('[data-urn]') || el.closest('[data-urn]');
        let urn = urnEl ? urnEl.getAttribute('data-urn') : (el.getAttribute('data-urn') || el.getAttribute('data-id') || '');

        if (!urn) {
          const decodedUrn = decodeBase64ProtobufUrn(el.outerHTML);
          if (decodedUrn) urn = decodedUrn;
        }

        // Author Name
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
            if (name.includes('Premium Profile')) name = name.split('Premium Profile')[0].trim();
            authorName = name;
          }
        }

        // Author Headline
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
              !text.toLowerCase().includes('follow') &&
              !text.toLowerCase().includes('suggested')
            ) || '';
          }
        }
        if (!authorHeadline) {
          authorHeadline = getText(el, [
            '.update-components-actor__description',
            '.update-components-actor__subtitle',
            '.feed-shared-actor__description',
          ]);
        }

        const authorProfileUrl = getHref(el, [
          '.update-components-actor__meta-link',
          'a[href*="/in/"]',
          '.update-components-actor__container-link',
          '.feed-shared-actor__container-link',
        ]);

        // Connection degree
        let connectionDegree = '';
        const nameContainers = el.querySelectorAll('a[href*="/in/"], .update-components-actor__title, .update-components-actor__name, .feed-shared-actor__name');
        for (const container of nameContainers) {
          const text = container.textContent || '';
          const match = text.match(/\b(1st|2nd|3rd\+|3rd)\b/i) || text.match(/(1st|2nd|3rd\+|3rd)/i);
          if (match) {
            connectionDegree = match[1].toLowerCase();
            break;
          }
          const ariaLabel = container.getAttribute('aria-label') || '';
          const ariaMatch = ariaLabel.match(/\b(1st|2nd|3rd\+|3rd)\b/i) || ariaLabel.match(/(1st|2nd|3rd\+|3rd)/i);
          if (ariaMatch) {
            connectionDegree = ariaMatch[1].toLowerCase();
            break;
          }
        }

        // Post Text
        const postText = getText(el, [
          '[data-testid="expandable-text-box"]',
          '.feed-shared-update-v2__description .break-words',
          '.update-components-text span.break-words',
          '.feed-shared-text .break-words',
          '[data-urn] .break-words',
          '.update-components-text',
          'span[dir="ltr"]',
        ]);

        // Post URL
        let postUrl = '';
        if (urn && urn.startsWith('urn:li:activity:')) {
          postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
        }

        // Liked check
        const likeBtn = el.querySelector('button[aria-label*="Reacted"], button[aria-pressed="true"], button.social-actions-button--active, button.react-button--active');
        const isLiked = !!likeBtn;

        // Image URL
        let imageUrl = '';
        const imgEl = el.querySelector('.update-components-image img, .feed-shared-image img, img.ivm-view-attr__img');
        if (imgEl) imageUrl = imgEl.getAttribute('src') || '';

        const subDesc = getText(el, ['.update-components-actor__sub-description']);
        const isSponsored = !!(
          subDesc.toLowerCase().includes('promoted') ||
          el.querySelector('a[href*="about/ads"]') ||
          el.querySelector('[aria-label*="Promoted"]')
        );

        if (!authorName && !postText) continue;

        posts.push({
          urn,
          author_name: authorName,
          author_headline: authorHeadline,
          author_profile_url: authorProfileUrl,
          connection_degree: connectionDegree,
          post_text: postText,
          post_url: postUrl,
          post_type: imageUrl ? 'image' : 'text',
          image_url: imageUrl,
          is_sponsored: isSponsored,
          is_liked: isLiked,
          timestamp: subDesc.split('•')[0]?.trim() || ''
        });
      } catch (err) {}
    }

    return posts;
  });
}

// ── Orchestration Loop ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        LinkedIn Commenter Agent — Autonomous Runner      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (!fs.existsSync(SESSION_FILE)) {
    log('❌', 'No saved session. Run `npm run login` first.');
    process.exit(1);
  }

  // Load history to prevent duplicate commenting
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      log('⚠️', 'Failed to read comment history database.');
    }
  }
  const alreadyCommentedUrls = new Set(history.map(h => h.post_url));
  const alreadyCommentedAuthors = new Set(history.map(h => h.author_name));
  const historicalComments = new Set(history.map(h => h.comment).filter(Boolean));

  log('🎯', 'Goal: Keep scrolling and evaluating until we get EXACTLY 5 qualified new comments.');

  // Launch browser
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
  const guard = new BrowserGuard(page, { logFile: path.join(RUN_DIR, 'audit.log') });
  await guard.install();
  log('🛡️', 'BrowserGuard active — 100% read-only operations enforced');

  log('🌐', 'Navigating to LinkedIn feed sorted by Recent...');
  try {
    await page.goto('https://www.linkedin.com/feed/?sortBy=recent', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    log('⚠️', 'Direct sortBy=recent navigation failed, attempting standard feed...');
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(5000);

  // Fallback programmatic click if not sorted by recent
  try {
    const sortBtn = await page.$('button:has-text("Sort by:"), [id*="sort-by-select"], button[aria-label*="Sort by"]');
    if (sortBtn) {
      const btnText = await sortBtn.textContent();
      if (!btnText.includes('Recent')) {
        log('🖱️', 'Clicking "Sort by" dropdown to select "Recent"...');
        await sortBtn.click();
        await page.waitForTimeout(1500);
        
        // Select Recent option
        const recentOpt = await page.$('span:has-text("Recent"), li:has-text("Recent"), button:has-text("Recent")');
        if (recentOpt) {
          await recentOpt.click();
          log('✅', 'Successfully selected "Recent" sorting dropdown');
          await page.waitForTimeout(4000);
        }
      } else {
        log('✅', 'Feed is already successfully sorted by Recent');
      }
    }
  } catch (clickErr) {
    log('⚠️', `Failed to programmatically select Recent sorting: ${clickErr.message}`);
  }

  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/authwall')) {
    log('❌', 'Session expired. Run `npm run login` first.');
    await browser.close();
    process.exit(1);
  }
  log('✅', 'Feed successfully loaded');

  const allScrapedPosts = [];
  const qualifiedPosts = [];
  const generatedComments = [];
  const processedPostIds = new Set();

  let scrollCount = 0;
  const maxScrolls = 100;
  let consecutiveStuckCount = 0;

  while (scrollCount < maxScrolls && qualifiedPosts.length < 5) {
    scrollCount++;
    
    // Get current scroll position to detect stuck state
    const currentScrollY = await page.evaluate(() => {
      const workspace = document.querySelector('main#workspace') || document.querySelector('[role="main"]') || document.body;
      return workspace ? workspace.scrollTop : window.scrollY;
    });

    // Scroll down
    const distance = randomBetween(500, 950);
    await guard.scroll(distance);
    await humanDelay(2500, 4500);

    // Get new scroll position
    const newScrollY = await page.evaluate(() => {
      const workspace = document.querySelector('main#workspace') || document.querySelector('[role="main"]') || document.body;
      return workspace ? workspace.scrollTop : window.scrollY;
    });

    log('🔍', `Scroll Position Debug: Current = ${currentScrollY}px | New = ${newScrollY}px | Delta = ${newScrollY - currentScrollY}px`);

    if (newScrollY === currentScrollY) {
      consecutiveStuckCount++;
      log('⏳', `Feed scroll position unchanged (stuck at bottom). Streak: ${consecutiveStuckCount}. Waiting 5s for LinkedIn to load new content...`);
      await page.waitForTimeout(5000);

      if (consecutiveStuckCount >= 2) {
        log('🔄', 'Still stuck. Performing scroll-up shake to trigger infinite scroll listener...');
        await guard.scroll(-300);
        await page.waitForTimeout(1500);
        await guard.scroll(600);
        await page.waitForTimeout(2000);
        consecutiveStuckCount = 0;
      }
    } else {
      consecutiveStuckCount = 0;
    }

    // Extract posts from DOM
    const DOMPosts = await extractPostsFromDOM(page);
    let newlyFound = 0;

    for (const post of DOMPosts) {
      // Deterministic unique post id
      const authorSlug = (post.author_name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
      const textSlug = (post.post_text || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
      const postId = post.urn || `gen_${authorSlug}_${textSlug}`;

      if (processedPostIds.has(postId)) continue;
      processedPostIds.add(postId);
      newlyFound++;

      const cleanPost = {
        post_id: postId,
        ...post
      };

      allScrapedPosts.push(cleanPost);

      // Check if already liked in DOM
      if (cleanPost.is_liked) {
        log('⏭️', `Skipping post by ${cleanPost.author_name} (already Liked in DOM)`);
        continue;
      }

      // Check if already commented in history
      if (alreadyCommentedUrls.has(cleanPost.post_url)) {
        log('⏭️', `Skipping post by ${cleanPost.author_name} (already commented in history)`);
        continue;
      }

      // Check if duplicate author today or recently to avoid spamming the same connection
      if (qualifiedPosts.some(q => q.author_name === cleanPost.author_name) || alreadyCommentedAuthors.has(cleanPost.author_name)) {
        log('⏭️', `Skipping post by ${cleanPost.author_name} (author already has a recent comment)`);
        continue;
      }

      // Evaluate score
      const evalData = scorePostRelevance(cleanPost.post_text, cleanPost.author_headline);
      const score = evalData.score;
      const deg = cleanPost.connection_degree || '3rd'; // default to 3rd if unknown

      // Rules execution:
      // Skip if score <= 90% (weak match)
      if (score < 0.91) continue;

      // 1st connections require elite 96%
      if (deg === '1st' && score < 0.96) {
        log('⏭️', `Skipping 1st connection post by ${cleanPost.author_name} | Score: ${(score * 100).toFixed(0)}% (below 96% elite threshold)`);
        continue;
      }

      // Post qualifies!
      log('🎯', `[QUALIFIED] Author: ${cleanPost.author_name} (${deg}) | Score: ${(score * 100).toFixed(0)}%`);
      
      const enrichedPost = {
        ...cleanPost,
        relevance_score: score,
        relevance_reason: evalData.reason
      };

      qualifiedPosts.push(enrichedPost);

      // Generate architectures comment
      const commentData = generateArchitectComment(enrichedPost.post_text, enrichedPost.author_name, historicalComments);
      
      const commentObj = {
        id: `cmt_${today.replace(/-/g, '')}_00${qualifiedPosts.length}`,
        post_id: enrichedPost.post_id,
        post_url: enrichedPost.post_url,
        post_author: enrichedPost.author_name,
        post_author_headline: enrichedPost.author_headline || "Technology Leader",
        post_excerpt: enrichedPost.post_text.substring(0, 160) + (enrichedPost.post_text.length > 160 ? '...' : ''),
        relevance_score: enrichedPost.relevance_score,
        relevance_reason: enrichedPost.relevance_reason,
        connection_degree: deg,
        tone: commentData.tone,
        comment: commentData.comment,
        generated_at: new Date().toISOString(),
        was_posted: false,
        posted_at: null
      };

      generatedComments.push(commentObj);

      if (qualifiedPosts.length >= 5) {
        break;
      }
    }

    log('📜', `Scroll ${scrollCount}/${maxScrolls} | Extracted: ${allScrapedPosts.length} | Qualified: ${qualifiedPosts.length}/5`);

    if (qualifiedPosts.length >= 5) {
      break;
    }
  }

  // ── Fallback relaxation logic to guarantee 5 comments ──
  if (qualifiedPosts.length < 5) {
    log('⚠️', `Scanned feed completely but only found ${qualifiedPosts.length} posts matching all filters. Relaxing thresholds to guarantee 5 comments...`);
    
    for (const post of allScrapedPosts) {
      if (qualifiedPosts.length >= 5) break;
      if (qualifiedPosts.some(q => q.post_id === post.post_id)) continue;

      if (post.is_liked || alreadyCommentedUrls.has(post.post_url)) continue;

      // Relax constraints: accept score >= 85% for any connection
      const evalData = scorePostRelevance(post.post_text, post.author_headline);
      let score = evalData.score;
      if (score < 0.85) continue;

      log('🎯', `[RELAXED QUALIFIED] Author: ${post.author_name} (${post.connection_degree || '3rd'}) | Score: ${(score * 100).toFixed(0)}%`);

      const enrichedPost = {
        ...post,
        relevance_score: score,
        relevance_reason: evalData.reason
      };

      qualifiedPosts.push(enrichedPost);

      const commentData = generateArchitectComment(enrichedPost.post_text, enrichedPost.author_name, historicalComments);
      
      const commentObj = {
        id: `cmt_${today.replace(/-/g, '')}_00${qualifiedPosts.length}`,
        post_id: enrichedPost.post_id,
        post_url: enrichedPost.post_url,
        post_author: enrichedPost.author_name,
        post_author_headline: enrichedPost.author_headline || "Technology Leader",
        post_excerpt: enrichedPost.post_text.substring(0, 160) + (enrichedPost.post_text.length > 160 ? '...' : ''),
        relevance_score: enrichedPost.relevance_score,
        relevance_reason: enrichedPost.relevance_reason,
        connection_degree: enrichedPost.connection_degree || '3rd',
        tone: commentData.tone,
        comment: commentData.comment,
        generated_at: new Date().toISOString(),
        was_posted: false,
        posted_at: null
      };

      generatedComments.push(commentObj);
    }
  }

  await browser.close();

  // Save the daily runs output files
  ensureDir(RUN_DIR);
  
  const rawOutput = {
    meta: {
      scanned_at: new Date().toISOString(),
      scrolls: scrollCount,
      total_found: allScrapedPosts.length,
      sponsored_filtered: allScrapedPosts.filter(p => p.is_sponsored).length,
      organic_count: allScrapedPosts.filter(p => !p.is_sponsored).length,
      post_types: { "text": allScrapedPosts.length }
    },
    posts: allScrapedPosts
  };

  fs.writeFileSync(path.join(RUN_DIR, 'raw-posts.json'), JSON.stringify(rawOutput, null, 2));
  fs.writeFileSync(path.join(RUN_DIR, 'filtered-posts.json'), JSON.stringify(qualifiedPosts, null, 2));
  fs.writeFileSync(path.join(RUN_DIR, 'comments.json'), JSON.stringify(generatedComments, null, 2));

  log('💾', 'Raw posts, qualified posts, and comments successfully saved to data/runs directory.');

  // Update comment-history.json
  generatedComments.forEach(c => {
    if (!history.some(h => h.post_id === c.post_id && h.date === today)) {
      history.push({
        date: today,
        post_id: c.post_id,
        author_name: c.post_author,
        comment: c.comment
      });
    }
  });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  log('💾', 'Updated history database synchronized.');

  // Update stats.json
  if (fs.existsSync(STATS_FILE)) {
    try {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      
      stats.total_runs = (stats.total_runs || 0) + 1;
      stats.total_posts_analyzed = (stats.total_posts_analyzed || 0) + allScrapedPosts.length;
      
      generatedComments.forEach(c => {
        stats.tones_used[c.tone] = (stats.tones_used[c.tone] || 0) + 1;
      });

      stats.daily_history = stats.daily_history || [];
      const dayHistIndex = stats.daily_history.findIndex(h => h.date === today);
      if (dayHistIndex !== -1) {
        stats.daily_history[dayHistIndex].posts_scanned = allScrapedPosts.length;
        stats.daily_history[dayHistIndex].relevant_found = qualifiedPosts.length;
        stats.daily_history[dayHistIndex].comments_generated = generatedComments.length;
      } else {
        stats.daily_history.push({
          date: today,
          posts_scanned: allScrapedPosts.length,
          relevant_found: qualifiedPosts.length,
          comments_generated: generatedComments.length,
          comments_posted: 0
        });
      }

      let totalGeneratedComments = 0;
      stats.daily_history.forEach(h => {
        totalGeneratedComments += (h.comments_generated || 0);
      });
      stats.total_comments_generated = totalGeneratedComments;

      const totalPosted = stats.total_comments_posted || 0;
      stats.posting_rate = ((totalPosted / (stats.total_comments_generated || 1)) * 100).toFixed(1) + '%';

      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      log('📊', 'Global statistics successfully updated in stats.json');
    } catch (e) {
      log('⚠️', `Failed to update statistics: ${e.message}`);
    }
  }

  log('🎉', `Process completed successfully! Generated exactly ${generatedComments.length} comments.`);

  // Load and start Express server to serve dashboard
  log('🚀', 'Launching dashboard server...');
  await import('./server.js');
}

main().catch(err => {
  log('💥', `Autonomous execution failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
