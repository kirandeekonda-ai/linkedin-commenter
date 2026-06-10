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

function containsWord(text, keyword) {
  const escaped = keyword.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9])` + escaped + `(?:$|[^a-zA-Z0-9])`, 'i');
  return regex.test(text);
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
    if (containsWord(text, kw) || containsWord(headline, kw)) {
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

// Global sets to keep track of used components to ensure zero duplication within a run
const usedComments = new Set();
const usedHooks = new Set();
const usedClosers = new Set();

const HOOKS = {
  experience: [
    (name) => `${name}, this matches what we've been seeing in production.`,
    (name) => `In our enterprise architecture work, we've seen a very similar pattern, ${name}.`,
    (name) => `We've run into these exact same dynamics recently, ${name}.`,
    (name) => `${name}, I've observed a very similar behavior in large-scale deployments.`,
    (name) => `This is very consistent with our experience scaling distributed systems, ${name}.`,
    (name) => `That's been a recurring theme in our architectural reviews as well, ${name}.`,
    (name) => `Really hits home, ${name}. We had to solve a very similar challenge last year.`,
    (name) => `From a systems architecture standpoint, this is a very familiar challenge, ${name}.`
  ],
  addition: [
    (name) => `Great points, ${name}. Expanding on this, there's another key layer to consider.`,
    (name) => `Very interesting context, ${name}. To add to that,`,
    (name) => `Appreciate you laying this out, ${name}. One crucial detail stands out from an architecture perspective:`,
    (name) => `Adding to your points, ${name}, it's also worth looking at the integration boundaries.`,
    (name) => `This is a solid breakdown, ${name}. To build on this, we also need to look at`,
    (name) => `Spot on, ${name}. Another aspect that often gets overlooked is`,
    (name) => `A valuable perspective, ${name}. I'd add that`,
    (name) => `Completely agree, ${name}. There's also an interesting secondary effect here:`
  ],
  question: [
    (name) => `Thoughtful analysis, ${name}.`,
    (name) => `Really interesting angle, ${name}.`,
    (name) => `This is a timely discussion, ${name}.`,
    (name) => `You've raised some excellent points here, ${name}.`,
    (name) => `An interesting perspective on this setup, ${name}.`,
    (name) => `Always good to see these design decisions discussed openly, ${name}.`
  ],
  pushback: [
    (name) => `I see your point, ${name}, but there's another side to this.`,
    (name) => `Interesting take, ${name}, though our experience suggests a slightly different path.`,
    (name) => `Appreciate this perspective, ${name}, but enterprise stability requires looking at this differently.`,
    (name) => `That's one way to approach it, ${name}, but at scale, this can introduce serious challenges.`,
    (name) => `I'd look at this slightly differently, ${name}.`,
    (name) => `While that approach works for smaller setups, ${name}, it often falls apart under enterprise load.`
  ],
  appreciation: [
    (name) => `This is an exceptionally clear breakdown, ${name}.`,
    (name) => `Fantastic summary, ${name}. You've articulated this perfectly.`,
    (name) => `So glad you posted this, ${name}. It hits on a very critical area.`,
    (name) => `Very clean explanation, ${name}. Really highlights the core challenges.`,
    (name) => `This is a great reference breakdown, ${name}.`,
    (name) => `Extremely well articulated, ${name}. Appreciate you sharing this.`
  ]
};

const COMMENT_TEMPLATES = [
  {
    id: "mcp_tool_broker",
    keywords: ["mcp", "model context protocol", "broker", "tool-calling", "schemas"],
    tone: "addition",
    baseBody: "Treating MCP as a broker interface rather than just a connection protocol is the right architectural play. By shielding the agent from raw schema complexity and centralizing tool governance at the broker level, you decouple client runtimes from downstream API churn. It's the same separation-of-concerns pattern that has historically succeeded in enterprise service buses and API gateways.",
    questions: [
      "Are you finding that routing tools this way helps with query latency, or does the extra broker hop add measurable overhead?",
      "How are you managing schema versioning at the broker level when upstream tool schemas change?"
    ],
    statements: [
      "Decoupling the client runtimes from the tool definition schema is essential for keeping the interface stable over time.",
      "Keeping that layer clean makes it much easier to run security auditing on outbound tool calls."
    ]
  },
  {
    id: "agentic_commerce",
    keywords: ["commerce", "payments", "payment", "tokenization", "credential"],
    tone: "experience",
    baseBody: "The intersection of agentic workflows and payment tokenization is a massive area. Using scoped, revokable tokens as surrogate credentials is the only safe way to delegate spending authority to autonomous agents without exposing raw account rails. Drawing from established payments tokenization standards is far safer than trying to reinvent authorization boundaries from scratch.",
    questions: [
      "Are you seeing payment networks begin to issue native agent-scoped credentials yet?",
      "How do you handle real-time fraud monitoring when an agent initiates a transaction autonomously?"
    ],
    statements: [
      "Leveraging existing security standards is always better than inventing proprietary authorization boundaries.",
      "It adds a much-needed layer of governance before letting agents touch live financial rails."
    ]
  },
  {
    id: "20_80_split",
    keywords: ["anthropic", "claude", "mistake", "20% model", "80% model", "agent stack", "reliability"],
    tone: "experience",
    baseBody: "The 20/80 split is the absolute truth of enterprise agentic design. We've found that the reasoning engine is really just a probabilistic compiler; actual stability comes from strict boundary schemas, self-hosted sandboxing, and deterministic state management. Without a robust, transparent governance wrapper, you're just scaling unquantifiable errors in production.",
    questions: [
      "Are you seeing more teams build custom orchestration layers for this, or rely on vendor-native frameworks?",
      "How are you balancing the trade-offs between custom orchestration code and developer speed?"
    ],
    statements: [
      "Treating the model as a modular component rather than the entire system is key.",
      "Once the boundary schemas are deterministic, debugging agent behavior becomes significantly easier."
    ]
  },
  {
    id: "filesystem_memory",
    keywords: ["memory", "state", "organize", "fail", "context", "history", "resumable", "struggle"],
    tone: "addition",
    baseBody: "Treating agent state as a resumable, structured document tree rather than a single massive text history makes long-running processes highly reliable. It moves the cognitive burden out of the prompt window and directly into the application boundary.",
    questions: [
      "Are you seeing a shift away from standard vector-only storage toward structured episodic storage in your setups?",
      "How do you handle context compression when state documents grow over long execution periods?"
    ],
    statements: [
      "Keeping memory structured makes it much easier to inspect and debug execution paths.",
      "It also helps dramatically with token cost management over long-running sessions."
    ]
  },
  {
    id: "model_routing",
    keywords: ["routing", "multi-model", "specialized", "composable", "slm", "lrm", "inference", "cost"],
    tone: "experience",
    baseBody: "Designing custom model-routing logic is where real enterprise cost-efficiency is won. We've had great success using lightweight SLMs for initial intent classification, then routing complex planning to heavy reasoning models before handing execution off to structured tool-calling nodes. Composable intelligence is the only practical way to run these platforms without going bankrupt on inference costs.",
    questions: [
      "Are you routing dynamically based on real-time token cost, or using static routing schemas?",
      "What tools are you using to classify user intent at the router level without adding too much latency?"
    ],
    statements: [
      "Routing lighter tasks to smaller models is essential for keeping latencies acceptable.",
      "It makes the overall infrastructure much more resilient to single-provider downtime."
    ]
  },
  {
    id: "validation_contracts",
    keywords: ["fastapi", "pydantic", "contract", "validation", "schema", "retry", "boundary"],
    tone: "addition",
    baseBody: "FastAPI combined with custom Pydantic schemas provides the exact contract layer needed to stabilize agent outputs in production. Treating model responses as strict data schemas rather than raw text allows us to run deterministic validations and orchestrate graceful retries before errors ever bubble up.",
    questions: [
      "Do you orchestrate validation retries immediately at the API layer, or let them bubble up to the controller?",
      "How are you handling structural schema changes when downstream models update?"
    ],
    statements: [
      "It gives backend teams a clean boundary to write standard unit tests against.",
      "Catching schema violations early prevents corrupt data from entering downstream databases."
    ]
  },
  {
    id: "org_operating_model",
    keywords: ["governance", "operating model", "institution", "transform", "organizat", "rethink", "ceo", "board", "process"],
    tone: "experience",
    baseBody: "Redesigning organizational boundaries is the most overlooked phase of AI adoption. If you drop multi-agent platforms onto unmodified workflows, you just get faster, more expensive bad decisions. True enterprise modernization means redefining data ownership, establishing strict human-in-the-loop validation checkpoints, and adapting the compliance model to govern autonomous agents.",
    questions: [
      "What has been the biggest hurdle in getting non-technical stakeholders to participate in the HITL review loops?",
      "How are compliance teams reacting to autonomous agents interacting directly with core databases?"
    ],
    statements: [
      "Adapting internal workflows is always harder than writing the actual automation code.",
      "Without clear data governance, scaling these systems introduces massive compliance risks."
    ]
  },
  {
    id: "rag_semantic_chunking",
    keywords: ["rag", "retrieval", "semantic", "vector", "chunking", "ingestion", "hallucinat", "data"],
    tone: "addition",
    baseBody: "Moving RAG from a demo to enterprise reliability is 90% ingestion and 10% model execution. Simple paragraph splitting is the main source of context drift; we've moved entirely to structural semantic chunking and deterministic schema verification before the synthesis step.",
    questions: [
      "Are you parsing document structures manually or leveraging multi-modal models for layout extraction?",
      "How are you validating retrieval accuracy at scale before it goes to synthesis?"
    ],
    statements: [
      "A clean ingestion pipeline solves the majority of hallucination issues at the source.",
      "Context quality beats model size almost every single time in practical retrieval tasks."
    ]
  },
  {
    id: "hexagonal_independence",
    keywords: ["hexagonal", "decouple", "vendor", "lock-in", "swap", "independent", "local"],
    tone: "experience",
    baseBody: "The hexagonal pattern is particularly vital as the model landscape commoditizes. We always architect our systems to be completely decoupled from specific model providers, allowing us to swap models or run self-hosted LLMs locally without changing the core orchestration logic. It's the only way to avoid vendor lock-in and keep infrastructure costs under control.",
    questions: [
      "Are you self-hosting local LLMs for fallback, or just swapping cloud providers?",
      "How do you handle API payload differences when swapping models under the hood?"
    ],
    statements: [
      "Keeping the vendor API out of the core domain logic is software engineering 101.",
      "It gives the business actual leverage when negotiating API pricing and service levels."
    ]
  },
  {
    id: "hierarchical_memory",
    keywords: ["tiered", "episodic", "memory", "cache", "latency", "eviction", "storage"],
    tone: "experience",
    baseBody: "Hierarchical memory is essential for long-running agent runtimes, but we quickly run into latency overhead without clear eviction policies. We've implemented strict tiered storage to keep active reasoning context clean while archiving episodic history. The hard part is always establishing deterministic rules for when to offload warm memory to cold vector stores.",
    questions: [
      "How are you configuring eviction rules for warm vs cold memory without losing execution context?",
      "What database backend are you finding works best for high-throughput episodic history storage?"
    ],
    statements: [
      "Managing this memory hierarchy is very similar to designing OS cache hierarchies.",
      "It keeps the context window focused on what is relevant for the immediate task."
    ]
  },
  {
    id: "token_auditing",
    keywords: ["token", "budget", "cost", "caching", "proxy", "spend", "gateway"],
    tone: "addition",
    baseBody: "The transition from subsidized tokens to rigorous token auditing is inevitable for enterprise budgets. Beyond just restricting code generation, organizations must build transparent proxy caching and semantic deduplication layers at the API level to keep costs predictable.",
    questions: [
      "Are you caching at the semantic level or doing exact match caching for prompt prefixes?",
      "How is your engineering team attributing token costs back to specific user actions or departments?"
    ],
    statements: [
      "Attributing costs to specific business actions is key to proving ROI.",
      "A shared API gateway makes enforcing rate-limiting and cost controls much simpler."
    ]
  },
  {
    id: "pre_retrieval_parsing",
    keywords: ["fuzzy", "parsing", "key-value", "entity", "match", "identif", "retrieve"],
    tone: "experience",
    baseBody: "Relying purely on semantic vector spaces for exact identifiers is a common design flaw in enterprise RAG systems. Embedding models are fundamentally built for fuzzy semantic matches, not deterministic key-value retrieval. The most resilient solution is routing queries through an explicit pre-retrieval parser that separates exact entity keys from concept-based search.",
    questions: [
      "Are you using regex-based extraction or lighter-weight models to separate entity keys?",
      "Have you found that routing queries this way cuts down on hallucinated context?"
    ],
    statements: [
      "Deterministic database lookups should always handle exact ID queries, not vector space searches.",
      "Combining relational schemas with semantic search indexes is the most robust path forward."
    ]
  },
  {
    id: "devops_pipelines",
    keywords: ["devops", "kubernetes", "k8s", "terraform", "infrastructure", "drift", "deploy", "build"],
    tone: "addition",
    baseBody: "Building declarative infrastructure pipelines is critical for enterprise scale. Moving from manual resource provisioning to structured, version-controlled state definitions under Terraform or Kubernetes is exactly how we eliminate drift and enable reliable developer environments.",
    questions: [
      "How are you verifying configuration drift in your infrastructure automatically?",
      "Are you running local k8s clusters for dev environments, or pushing to remote sandboxes?"
    ],
    statements: [
      "Treating infrastructure strictly as code is the only way to ensure auditability.",
      "It removes a massive amount of friction for teams onboarding new microservices."
    ]
  },
  {
    id: "database_optimization",
    keywords: ["database", "postgres", "sql", "query", "index", "bottleneck", "cache"],
    tone: "experience",
    baseBody: "Query optimization and proper schema indexing are where database stability is actually won. Throwing hardware or read-replicas at database bottlenecks is just a temporary fix; the real solution is designing clean, normalized boundary schemas and a robust query caching strategy.",
    questions: [
      "What caching strategies have you found most effective for highly dynamic read/write loads?",
      "Are you relying on automated index advisors, or manually profiling complex transactions?"
    ],
    statements: [
      "A clean query plan is worth ten database scaling operations under load.",
      "Keeping your transactions short and focused is the best safeguard against connection pool exhaustion."
    ]
  },
  {
    id: "modular_hexagonal_architecture",
    keywords: ["code", "refactor", "clean", "design pattern", "modularity", "interface", "skills"],
    tone: "experience",
    baseBody: "Prioritizing modularity and interface-driven design is the only way to keep enterprise codebases maintainable over a multi-year lifecycle. Decoupling core domain logic from external dependencies like database gateways or web APIs makes the entire application much easier to test, modernize, and debug under load.",
    questions: [
      "Are you finding that decoupled adapter layers help with writing cleaner unit tests?",
      "How do you structure your domain folder boundaries to keep developers from bypassing adapters?"
    ],
    statements: [
      "It requires discipline from the team, but it completely prevents spaghetti code.",
      "It makes migrating from one external vendor/framework to another a non-issue."
    ]
  },
  {
    id: "agentic_rag_latency",
    keywords: ["agentic rag", "latency", "compounding", "iterative", "loop"],
    tone: "addition",
    baseBody: "Moving from static RAG to dynamic, agentic RAG is where we start addressing real-world query ambiguity. However, in enterprise systems, this iterative loop introduces compounding latency. Implementing deterministic routing policies and caching layers at the orchestration level is critical to keep these loops performant under load.",
    questions: [
      "Are you running agent loops in parallel, or is the latency hit too high under heavy concurrent load?",
      "What metrics are you tracking to pinpoint where the biggest slowdowns occur in your multi-step retrievals?"
    ],
    statements: [
      "Keeping these loops bounded with a hard time-to-live or step limit is a crucial safety safeguard.",
      "User experience quickly suffers if query latencies cross the sub-second threshold."
    ]
  }
];

const FALLBACK_TEMPLATES = [
  {
    id: "fallback_decoupling",
    tone: "experience",
    baseBody: "Keeping system boundaries clean by defining strict interfaces is one of those classic principles that is easy to skip but expensive to ignore. The moment database details bleed into the client interface, you inherit massive technical debt that slows down the whole engineering pipeline.",
    questions: [
      "How does your team prevent database details from bleeding into the client interface?",
      "Do you use custom gateway mappers or rely on automated serialization libraries?"
    ],
    statements: [
      "It is a hard line to hold when moving fast, but it saves so much headache during future migrations.",
      "Keeping these boundary definitions clean keeps the domain logic highly testable."
    ]
  },
  {
    id: "fallback_observability",
    tone: "addition",
    baseBody: "At scale, distributed systems fail in ways we can't always predict. Having structured logs and distributed tracing isn't just about debugging; it's about understanding how components interact under real-world load. Without proper observability, you are essentially flying blind when a bottleneck hits.",
    questions: [
      "What tools have you found most effective for tracing async calls without adding too much latency?",
      "Are you using auto-instrumentation or manually instrumenting critical paths?"
    ],
    statements: [
      "Investing in good telemetry early on is probably one of the highest-return design decisions a team can make.",
      "It completely changes how you run incident response and post-mortems."
    ]
  },
  {
    id: "fallback_tech_debt",
    tone: "experience",
    baseBody: "The tension between shipping quickly and building clean code is always present. The key is distinguishing between conscious technical debt (with a clear plan to repay) and accidental messiness that stalls development. Good architecture isn't about perfect code; it's about deliberate, transparent trade-offs.",
    questions: [
      "How does your team align business stakeholders on allocating time for technical debt repayment?",
      "Do you track tech debt items in a separate backlog or prioritize them alongside product features?"
    ],
    statements: [
      "Making these architectural compromises visible is the only way to manage them effectively over time.",
      "A healthy team knows when to build fast and when to build for longevity."
    ]
  },
  {
    id: "fallback_reliability",
    tone: "addition",
    baseBody: "Reliability isn't something you can easily bolt on to an existing application after the fact. It has to be built into the core design through mechanisms like graceful degradation, circuit breakers, and retry backoffs. A system that fails gracefully is infinitely better than one that fails silently.",
    questions: [
      "How are you simulating partial failures in your environments to test these resilience patterns?",
      "Do you run automated chaos engineering tests or stick to manual game days?"
    ],
    statements: [
      "Designing for failure from day one is really the only way to build trust in enterprise-level services.",
      "A clean fallback flow is often the difference between a minor hiccup and a complete outage."
    ]
  },
  {
    id: "fallback_api_contracts",
    tone: "addition",
    baseBody: "A contract-first approach to API design makes cross-team collaboration much smoother. By agreeing on request and response schemas before writing any code, backend and frontend teams can work completely in parallel. It completely eliminates the integration surprises later.",
    questions: [
      "Do you use automated tooling to enforce schema compliance in your CI/CD pipelines?",
      "How are you managing API documentation updates when schemas change?"
    ],
    statements: [
      "It requires some upfront coordination, but the speed gains during integration are massive.",
      "Treating your APIs as hard contracts makes client libraries much cleaner to generate."
    ]
  },
  {
    id: "fallback_modular_design",
    tone: "experience",
    baseBody: "True modularity is about high cohesion and low coupling. If changing a feature in one module requires editing three other unrelated modules, the architecture has failed. Keeping dependencies unidirectional and interfaces minimal is key to scaling developer velocity.",
    questions: [
      "What metrics or patterns do you use to detect when modules are becoming too tightly coupled?",
      "How do you organize folder boundaries to prevent developers from bypassing modular interfaces?"
    ],
    statements: [
      "It takes constant vigilance to keep those boundary lines clean as the codebase grows.",
      "Keeping the interface small is the best way to decouple release cycles."
    ]
  },
  {
    id: "fallback_caching",
    tone: "experience",
    baseBody: "Caching is a powerful tool, but cache invalidation remains one of the hardest problems in systems design. If you throw a cache at a slow database query without a clear eviction strategy and data-consistency model, you are often just trading a performance issue for a data corruption issue.",
    questions: [
      "How are you handling cache invalidation in highly concurrent write environments?",
      "Are you using write-through caching, or running background cache synchronization workers?"
    ],
    statements: [
      "Sometimes, optimizing the underlying query plan is a much safer bet than introducing cache layers.",
      "A cache is a bandage; fixing the root-cause query complexity is the cure."
    ]
  },
  {
    id: "fallback_platform_eng",
    tone: "addition",
    baseBody: "Platform engineering is really about reducing cognitive load for product developers. By building paved paths—self-service templates for infrastructure, deployment, and monitoring—you enable teams to ship safely without needing to be SRE experts. It's about guardrails, not roadblocks.",
    questions: [
      "What has been the most successful paved path your team has introduced recently?",
      "How do you measure developer adoption and satisfaction with the platform tooling?"
    ],
    statements: [
      "Focusing on the developer experience as a first-class product is what makes platform teams successful.",
      "Guardrails build confidence and speed up onboarding times significantly."
    ]
  },
  {
    id: "fallback_async_queues",
    tone: "experience",
    baseBody: "Moving from synchronous API calls to asynchronous event-driven queues is a great way to decouple system components and handle spike loads. However, it introduces new challenges like out-of-order execution, idempotency requirements, and complex error state handling that need careful planning.",
    questions: [
      "How do you handle message deduplication and dead-letter queues in your event processors?",
      "Do you use distributed transactions or rely on sagas for multi-service consistency?"
    ],
    statements: [
      "Designing every consumer to be strictly idempotent is probably the most critical safeguard here.",
      "Handling failures asynchronously is much more robust than letting synchronous threads timeout."
    ]
  },
  {
    id: "fallback_refactoring",
    tone: "experience",
    baseBody: "Rewriting a legacy system from scratch is rarely the right choice. It is almost always better to incrementally refactor using patterns like the Strangler Fig, gradually replacing old components with new services behind an API gateway. It minimizes risk and delivers value continuously.",
    questions: [
      "What strategies have you found most effective for running old and new systems in parallel during a migration?",
      "How do you handle data synchronization between legacy and new databases during a rollout?"
    ],
    statements: [
      "It is a slower and more disciplined process, but the risk profile is significantly lower.",
      "Delivering incremental updates maintains stakeholder confidence and proves the migration path."
    ]
  }
];

const GENERAL_QUESTIONS = [
  "How are you balancing these trade-offs in your current setups?",
  "What's your take on how this scales as system complexity grows?",
  "Have you run into any unexpected edge cases with this pattern?",
  "How does your team usually handle this boundary?"
];

const GENERAL_STATEMENTS = [
  "It's always a delicate trade-off, but keeping these boundaries clean is definitely worth the effort.",
  "This makes a massive difference in long-term maintainability.",
  "Really glad to see these patterns being discussed more openly.",
  "It is definitely one of the key design decisions that pays off down the road.",
  "Designing for this early on saves a lot of refactoring headache later.",
  "It is a solid approach to keeping the system architecture modular and clean."
];

function getFirstName(fullName) {
  if (!fullName) return 'there';
  let cleanName = fullName.split(',')[0].split('•')[0].trim();
  cleanName = cleanName.replace(/^(Dr\.|Dr\b|Prof\.|Prof\b|Mr\.|Mr\b|Ms\.|Ms\b)\s+/i, '');
  const parts = cleanName.split(/\s+/);
  return parts[0] || 'there';
}

function getUniqueHook(authorName, tone) {
  const firstName = getFirstName(authorName);
  const toneHooks = HOOKS[tone] || HOOKS.experience;
  
  let availableIndices = [];
  for (let i = 0; i < toneHooks.length; i++) {
    const hookKey = `${tone}_${i}`;
    if (!usedHooks.has(hookKey)) {
      availableIndices.push(i);
    }
  }
  
  if (availableIndices.length === 0) {
    for (let i = 0; i < toneHooks.length; i++) {
      usedHooks.delete(`${tone}_${i}`);
    }
    availableIndices = Array.from({ length: toneHooks.length }, (_, i) => i);
  }
  
  const selectedIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
  usedHooks.add(`${tone}_${selectedIndex}`);
  return toneHooks[selectedIndex](firstName);
}

function getUniqueCloser(templateId, templateClosers, type) {
  let closersList = templateClosers;
  if (!closersList || closersList.length === 0) {
    closersList = type === "question" ? GENERAL_QUESTIONS : GENERAL_STATEMENTS;
  }
  
  let availableIndices = [];
  for (let i = 0; i < closersList.length; i++) {
    const closerKey = `${templateId}_${type}_${i}`;
    if (!usedClosers.has(closerKey)) {
      availableIndices.push(i);
    }
  }
  
  if (availableIndices.length === 0) {
    for (let i = 0; i < closersList.length; i++) {
      usedClosers.delete(`${templateId}_${type}_${i}`);
    }
    availableIndices = Array.from({ length: closersList.length }, (_, i) => i);
  }
  
  const selectedIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
  usedClosers.add(`${templateId}_${type}_${selectedIndex}`);
  return closersList[selectedIndex];
}

function generateArchitectComment(postText, authorName, historicalComments = new Set()) {
  const text = postText.toLowerCase();
  
  // Calculate fit score for each template based on keyword matching
  const scoredTemplates = COMMENT_TEMPLATES.map(tmpl => {
    // Skip if already used in this run or found in historical comments to ensure zero duplicates
    const hypotheticalCommentSnippet = tmpl.baseBody.substring(0, 50);
    const hasBeenUsedHistorically = Array.from(historicalComments).some(h => h.includes(hypotheticalCommentSnippet));

    if (usedComments.has(tmpl.id) || hasBeenUsedHistorically) {
      return { tmpl, score: -1 };
    }
    
    let matchCount = 0;
    tmpl.keywords.forEach(kw => {
      if (containsWord(text, kw)) {
        matchCount++;
      }
    });
    
    return { tmpl, score: matchCount };
  });
  
  // Sort by score descending
  scoredTemplates.sort((a, b) => b.score - a.score);
  
  // Select the highest-scoring template that matched at least one keyword (score > 0)
  const bestMatch = scoredTemplates.find(st => st.score > 0);
  
  let selectedTmpl;
  
  if (bestMatch) {
    selectedTmpl = bestMatch.tmpl;
  } else {
    // Fallback if no specific template matched: pick an unused fallback template
    const availableFallbacks = FALLBACK_TEMPLATES.filter(tmpl => {
      const snippet = tmpl.baseBody.substring(0, 50);
      const hasBeenUsedHistorically = Array.from(historicalComments).some(h => h.includes(snippet));
      return !usedComments.has(tmpl.id) && !hasBeenUsedHistorically;
    });
    
    if (availableFallbacks.length > 0) {
      selectedTmpl = availableFallbacks[Math.floor(Math.random() * availableFallbacks.length)];
    } else {
      // If all fallback templates are exhausted, clear used states and pick a random fallback
      usedComments.clear();
      selectedTmpl = FALLBACK_TEMPLATES[Math.floor(Math.random() * FALLBACK_TEMPLATES.length)];
    }
  }
  
  // Mark template as used
  usedComments.add(selectedTmpl.id);
  
  const tone = selectedTmpl.tone;
  
  // Decide whether to prepend a greeting (70% probability)
  let hook = "";
  const useGreeting = Math.random() > 0.3; // 70% yes, 30% no
  if (useGreeting) {
    hook = getUniqueHook(authorName, tone);
  }
  
  // Decide closer type: 20% question, 40% statement, 40% none
  let closer = "";
  const rand = Math.random();
  if (rand < 0.20) {
    closer = getUniqueCloser(selectedTmpl.id, selectedTmpl.questions || [], "question");
  } else if (rand < 0.60) {
    closer = getUniqueCloser(selectedTmpl.id, selectedTmpl.statements || [], "statement");
  } else {
    closer = ""; // 40% probability of no closer
  }
  
  // Assemble final comment
  let commentText = "";
  if (hook) {
    commentText = `${hook} ${selectedTmpl.baseBody}`;
  } else {
    // Ensure baseBody first letter is capitalized
    commentText = selectedTmpl.baseBody;
  }
  
  if (closer) {
    commentText = `${commentText} ${closer}`;
  }
  
  return {
    tone: tone,
    comment: commentText
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
          const match = el.outerHTML.match(/urn:li:activity:\d+/);
          if (match) urn = match[0];
        }

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
        } else if (authorProfileUrl) {
          let cleanProfile = authorProfileUrl.trim();
          if (!cleanProfile.endsWith('/')) {
            cleanProfile += '/';
          }
          postUrl = `${cleanProfile}recent-activity/all/`;
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

const MOCK_POSTS = [
  {
    "post_id": "urn:li:activity:7467194084311355392",
    "author_name": "Rakesh Gohel",
    "author_headline": "Scaling with AI Agents | Expert in Agentic AI & Cloud Native Solutions",
    "connection_degree": "3rd",
    "post_text": "Anthropic just shipped AI agents that catch their own mistakes. For enterprise teams, that reliability matters more than raw capability. Building a reliable agent is maybe 20% model and 80% the system around it.",
    "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:7467194084311355392/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "4h"
  },
  {
    "post_id": "gen_ketansagare_mostaiagentsdontfail",
    "author_name": "Ketan Sagare",
    "author_headline": "Data Scientist | Artificial Intelligence & Agents",
    "connection_degree": "3rd",
    "post_text": "Most AI agents don't fail because they're not smart enough. They fail because they can't stay organized. The industry is obsessed with model intelligence. But the biggest shift happening right now isn't from better models. It's from better agent architecture. A standard agent usually follows a simple loop: Think -> Act -> Observe -> Repeat. The future of AI agents isn't just bigger context windows. It's systems that can plan, delegate, remember, recover, and execute for hours or days without falling apart.",
    "post_url": "https://www.linkedin.com/in/ketan-sagare-15b4a9157/recent-activity/all/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "6h"
  },
  {
    "post_id": "urn:li:activity:7464895668420186112",
    "author_name": "Naresh Hingorani",
    "author_headline": "I Turn AI Into Actionable, Structured Systems | Automation • Workflow Design",
    "connection_degree": "2nd",
    "post_text": "8 AI Model Architectures Every AI Engineer Must Understand in 2026. Everyone is talking about AI Agents... But very few people are talking about the models behind them. The next generation of AI systems is no longer powered by a single LLM. They're powered by a stack of specialized models working together. Composable Intelligence.",
    "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:7464895668420186112/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "12h"
  },
  {
    "post_id": "urn:li:activity:7466387388190359552",
    "author_name": "Vishal Sharma",
    "author_headline": "Lead Engineer @ Samsung R&D Institute | Knowledge Graphs | Agentic AI | RAG",
    "connection_degree": "3rd",
    "post_text": "Recently came across an interview process for a Senior AI Engineer role that focused heavily on production-grade GenAI systems rather than just LLM fundamentals. Round 1: RAG & Agentic AI (Financial RAG architecture, adaptive retrieval, HITL). Round 2: Hands-on & System Design (FastAPI, Pydantic, retry logic, timeouts, LangGraph reducers, observability). Round 3: Observability, monitoring, and tracing.",
    "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:7466387388190359552/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "1d"
  },
  {
    "post_id": "urn:li:activity:7465643031401017344",
    "author_name": "Vattan",
    "author_headline": "AI Practice Leader & Enterprise Strategist",
    "connection_degree": "2nd",
    "post_text": "Head of AI is not an engineering job. Most companies hire a senior engineer, give them the title, and it starts well... Redesigning the institution around what models make possible... Whether the governance, data, and accountability infrastructure exists before you scale. How the organisation changes — not just the technology.",
    "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:7465643031401017344/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "2d"
  },
  {
    "post_id": "gen_general_dev_1",
    "author_name": "Alex Miller",
    "author_headline": "Senior Frontend Developer | React | TypeScript",
    "connection_degree": "2nd",
    "post_text": "I'm always amazed at how fast the frontend ecosystem moves. We are constantly updating dependencies, refactoring components, and trying to keep build times low. It feels like a full-time job just keeping the package.json clean and avoiding build errors under load.",
    "post_url": "https://www.linkedin.com/in/alex-miller/recent-activity/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "3d"
  },
  {
    "post_id": "gen_general_dev_2",
    "author_name": "Sarah Jenkins",
    "author_headline": "Engineering Manager | Developer Velocity",
    "connection_degree": "1st",
    "post_text": "Our team spent the last two weeks focusing on developer experience and tooling. We automated our deployment checklist and added self-service scripts for local setup. The feedback has been amazing—onboarding time dropped by 50%. Developer velocity is all about clear, paved paths.",
    "post_url": "https://www.linkedin.com/in/sarah-jenkins/recent-activity/",
    "post_type": "text",
    "image_url": "",
    "is_sponsored": false,
    "is_liked": false,
    "timestamp": "5d"
  }
];

// ── Orchestration Loop ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        LinkedIn Commenter Agent — Autonomous Runner      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (process.argv.includes('--simulate')) {
    log('🎮', 'Running in simulation (dry-run) mode with mock posts...');
    
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

    const qualifiedPosts = [];
    const generatedComments = [];
    
    // Evaluate mock posts
    for (const post of MOCK_POSTS) {
      if (qualifiedPosts.length >= 5) break;

      // In simulation mode, ignore history checks to allow testing multiple times
      if (false) {
        log('⏭️', `[Sim] Skipping post by ${post.author_name} (already engaged)`);
        continue;
      }

      const evalData = scorePostRelevance(post.post_text, post.author_headline);
      const score = evalData.score;
      const deg = post.connection_degree || '3rd';

      // In simulation mode, ignore scoring limits to generate a full set of comments
      if (false) {
        if (score < 0.91) {
          log('⏭️', `[Sim] Skipping post by ${post.author_name} | Score: ${(score * 100).toFixed(0)}% (below 91%)`);
          continue;
        }
        if (deg === '1st' && score < 0.96) {
          log('⏭️', `[Sim] Skipping 1st connection post by ${post.author_name} | Score: ${(score * 100).toFixed(0)}% (below 96%)`);
          continue;
        }
      }

      log('🎯', `[Sim QUALIFIED] Author: ${post.author_name} (${deg}) | Score: ${(score * 100).toFixed(0)}%`);
      const enrichedPost = { ...post, relevance_score: score, relevance_reason: evalData.reason };
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
        connection_degree: deg,
        tone: commentData.tone,
        comment: commentData.comment,
        generated_at: new Date().toISOString(),
        was_posted: false,
        posted_at: null,
        is_simulation: true
      };
      generatedComments.push(commentObj);
    }

    // Relaxed fallback if < 5 qualified
    if (qualifiedPosts.length < 5) {
      log('⚠️', `[Sim] Only found ${qualifiedPosts.length} qualified posts. Relaxing thresholds...`);
      for (const post of MOCK_POSTS) {
        if (qualifiedPosts.length >= 5) break;
        if (qualifiedPosts.some(q => q.post_id === post.post_id)) continue;
        // Ignore history check in simulation mode
        if (false) continue;

        const evalData = scorePostRelevance(post.post_text, post.author_headline);
        const score = evalData.score;
        if (score < 0.85) continue;

        log('🎯', `[Sim RELAXED QUALIFIED] Author: ${post.author_name} (${post.connection_degree || '3rd'}) | Score: ${(score * 100).toFixed(0)}%`);
        const enrichedPost = { ...post, relevance_score: score, relevance_reason: evalData.reason };
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
          posted_at: null,
          is_simulation: true
        };
        generatedComments.push(commentObj);
      }
    }

    // Save outputs only if they won't overwrite a real run
    let shouldOverwrite = true;
    const commentsFilePath = path.join(RUN_DIR, 'comments.json');
    if (fs.existsSync(commentsFilePath)) {
      try {
        const existingComments = JSON.parse(fs.readFileSync(commentsFilePath, 'utf-8'));
        if (existingComments.length > 0 && existingComments.some(c => !c.is_simulation)) {
          shouldOverwrite = false;
        }
      } catch (e) {
        // ignore parsing error, overwrite if corrupt
      }
    }

    if (shouldOverwrite) {
      ensureDir(RUN_DIR);
      fs.writeFileSync(path.join(RUN_DIR, 'raw-posts.json'), JSON.stringify({ meta: { scanned_at: new Date().toISOString(), total_found: MOCK_POSTS.length }, posts: MOCK_POSTS }, null, 2));
      fs.writeFileSync(path.join(RUN_DIR, 'filtered-posts.json'), JSON.stringify(qualifiedPosts, null, 2));
      fs.writeFileSync(commentsFilePath, JSON.stringify(generatedComments, null, 2));

      // Update history
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
      log('💾', '[Sim] Updated history database.');

      // Update stats
      if (fs.existsSync(STATS_FILE)) {
        try {
          const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
          stats.total_runs = (stats.total_runs || 0) + 1;
          stats.total_posts_analyzed = (stats.total_posts_analyzed || 0) + MOCK_POSTS.length;
          generatedComments.forEach(c => {
            stats.tones_used[c.tone] = (stats.tones_used[c.tone] || 0) + 1;
          });

          stats.daily_history = stats.daily_history || [];
          const dayHistIndex = stats.daily_history.findIndex(h => h.date === today);
          if (dayHistIndex !== -1) {
            stats.daily_history[dayHistIndex].posts_scanned = MOCK_POSTS.length;
            stats.daily_history[dayHistIndex].relevant_found = qualifiedPosts.length;
            stats.daily_history[dayHistIndex].comments_generated = generatedComments.length;
          } else {
            stats.daily_history.push({
              date: today,
              posts_scanned: MOCK_POSTS.length,
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
          log('📊', '[Sim] Global statistics successfully updated.');
        } catch (e) {
          log('⚠️', `[Sim] Failed to update stats: ${e.message}`);
        }
      }
    } else {
      log('ℹ️', '[Sim] Real run comments already exist for today. Skipping overwriting run files and stats.');
    }

    log('🎉', `[Sim] Completed successfully! Generated ${generatedComments.length} comments.`);
    console.log('\n--- SIMULATED COMMENTS ---');
    generatedComments.forEach((c, idx) => {
      console.log(`\n[${idx + 1}] Author: ${c.post_author} (${c.connection_degree}) | Tone: ${c.tone}`);
      console.log(`    Post: "${c.post_excerpt}"`);
      console.log(`    Comment: "${c.comment}"`);
    });
    console.log('--------------------------\n');

    log('🚀', 'Launching dashboard server...');
    await import('./server.js');
    return;
  }

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

  if (process.argv.includes('--scrape-only')) {
    log('💾', 'Scrape-only complete. Saved raw-posts.json and filtered-posts.json.');
    process.exit(0);
  }

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
