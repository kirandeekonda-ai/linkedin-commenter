import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.md');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const HISTORY_FILE = path.join(DATA_DIR, 'comment-history.json');

// Helper to get today's date in YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Helper to clean and parse JSON from LLM response
function parseLLMResponse(text) {
  try {
    // Strip markdown code block wrappers if present
    const cleanText = text.replace(/```json\s*|```\s*/g, '').trim();
    return JSON.parse(cleanText);
  } catch (err) {
    console.error('Failed to parse LLM response as JSON:', text);
    throw err;
  }
}

// ── Main LLM Comment Generation Flow ──
async function generateComments() {
  console.log('\n🧠  [LLM] Starting Programmatic Comment Generator...');

  // Load .env file programmatically if it exists (Node-version safe)
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = (match[2] || '').trim();
          // Strip enclosing quotes if present
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          process.env[key] = value;
        }
      });
    } catch (e) {
      console.warn('⚠️  Could not parse .env file:', e.message);
    }
  }

  // Get Gemini API Key from environment variables
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌  [LLM] Error: GEMINI_API_KEY is not set in environment variables.');
    console.log('💡  Please set it in your system environment variables or create a .env file.');
    process.exit(1);
  }

  const today = getTodayDate();
  const runDir = path.join(DATA_DIR, 'runs', today);
  const rawPostsPath = path.join(runDir, 'raw-posts.json');
  const commentsPath = path.join(runDir, 'comments.json');
  const filteredPostsPath = path.join(runDir, 'filtered-posts.json');

  if (!fs.existsSync(rawPostsPath)) {
    console.error(`❌  [LLM] Error: Today's raw posts file not found at: ${rawPostsPath}`);
    console.log('💡  Please run the scanner first: npm run scan');
    process.exit(1);
  }

  if (!fs.existsSync(PROFILE_FILE)) {
    console.error(`❌  [LLM] Error: Profile file not found at: ${PROFILE_FILE}`);
    process.exit(1);
  }

  const profile = fs.readFileSync(PROFILE_FILE, 'utf-8');
  const rawData = JSON.parse(fs.readFileSync(rawPostsPath, 'utf-8'));
  const posts = rawData.posts || [];

  if (posts.length === 0) {
    console.log('⚠️  [LLM] No posts found to analyze for today.');
    process.exit(0);
  }

  console.log(`📊  [LLM] Loaded ${posts.length} organic posts for analysis.`);

  // Load comment history to prevent duplicate authors
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      console.error('⚠️  Failed to read history, starting fresh:', e.message);
    }
  }
  const recentlyCommentedAuthors = new Set(history.map(h => h.author_name));

  // ── Step 1: Score & Filter Posts ──
  const scoredPosts = [];
  
  for (const post of posts) {
    // Skip if we commented on this author recently
    if (post.author_name && recentlyCommentedAuthors.has(post.author_name)) {
      console.log(`⏭️  [LLM] Skipping post by ${post.author_name} (already commented on recently).`);
      continue;
    }

    console.log(`🔍  [LLM] Scoring post by ${post.author_name || 'Unknown'}...`);

    const scoringPrompt = `
You are a systems architecture evaluator. Score the relevance of the following LinkedIn post to the user's professional profile.

User Profile:
"""
${profile}
"""

LinkedIn Post:
* Author Name: ${post.author_name}
* Author Headline: ${post.author_headline}
* Text Content: ${post.post_text}

Provide your response in raw JSON format matching this exact schema:
{
  "relevance_score": 0.0 to 1.0,
  "relevance_reason": "Brief explanation of why it is relevant or not."
}
Only output the JSON object. Do not add any conversational text.
`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: scoringPrompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const resJson = await response.json();
      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const scoreData = parseLLMResponse(text);

      scoredPosts.push({
        ...post,
        relevance_score: scoreData.relevance_score,
        relevance_reason: scoreData.relevance_reason
      });
    } catch (err) {
      console.error(`⚠️  [LLM] Failed to score post by ${post.author_name}:`, err.message);
      // Fallback scoring
      scoredPosts.push({
        ...post,
        relevance_score: 0.1,
        relevance_reason: "Failed scoring pass."
      });
    }
  }

  // Sort by score descending and take top 5
  scoredPosts.sort((a, b) => b.relevance_score - a.relevance_score);
  const top5 = scoredPosts.slice(0, 5);

  console.log(`🎯  [LLM] Selected top ${top5.length} relevant posts.`);
  fs.writeFileSync(filteredPostsPath, JSON.stringify(top5, null, 2));

  // ── Step 2: Generate Comments ──
  const generatedComments = [];

  for (let i = 0; i < top5.length; i++) {
    const post = top5[i];
    console.log(`✍️  [LLM] Generating comment for ${post.author_name}...`);

    const commentPrompt = `
You are a world-class Enterprise Systems Architect and Technical Leader. Generate a highly realistic, visual-informed LinkedIn comment suggestion for the following post based on your profile context.

Your Profile Context:
"""
${profile}
"""

LinkedIn Post details:
* Author: ${post.author_name}
* Author Headline: ${post.author_headline}
* Post Text: ${post.post_text}
${post.image_url ? `* Post contains an attached image URL: ${post.image_url}` : ''}

Strict Comment Guidelines:
1. Maximum 2-3 sentences. Keep it short, crisp, and plain English.
2. Absolutely no business buzzwords (e.g. leverage, synergy, game-changer, seamless, scale, paradigm, transformational, at the end of the day).
3. Do NOT use generic starts (e.g. "Great post!", "Love this!", "Spot on!", "Totally agree").
4. Sound highly human, authentic, and professional. Use natural contractions.
5. Reference a highly specific element from the post text. 
6. Make it direct and thoughtful. Give a brief system-architect level observation or constructive addition.
7. Select exactly ONE tone matching the context of the post: "addition", "experience", "question", "appreciation", or "pushback".

Provide your response in raw JSON format matching this exact schema:
{
  "tone": "addition|experience|question|appreciation|pushback",
  "comment": "The custom suggested comment here."
}
Only output the JSON object. Do not add any conversational text.
`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: commentPrompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const resJson = await response.json();
      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const commentData = parseLLMResponse(text);

      const commentObj = {
        id: `cmt_${today.replace(/-/g, '')}_00${i + 1}`,
        post_id: post.post_id,
        post_url: post.post_url,
        post_author: post.author_name,
        post_author_headline: post.author_headline,
        post_excerpt: post.post_text.substring(0, 160) + (post.post_text.length > 160 ? '...' : ''),
        relevance_score: post.relevance_score,
        relevance_reason: post.relevance_reason,
        tone: commentData.tone,
        comment: commentData.comment,
        generated_at: new Date().toISOString(),
        was_posted: false,
        posted_at: null
      };

      generatedComments.push(commentObj);
      
      // Update comment-history on memory
      history.push({
        date: today,
        post_id: post.post_id,
        author_name: post.author_name,
        comment: commentData.comment
      });

    } catch (err) {
      console.error(`❌  [LLM] Comment generation failed for ${post.author_name}:`, err.message);
    }
  }

  // Save comments database
  fs.writeFileSync(commentsPath, JSON.stringify(generatedComments, null, 2));
  console.log(`💾  [LLM] Comments saved successfully to: ${commentsPath}`);

  // Save comment history
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // ── Step 3: Update Global Stats ──
  if (fs.existsSync(STATS_FILE)) {
    try {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      
      stats.total_runs = (stats.total_runs || 0) + 1;
      stats.total_posts_analyzed = (stats.total_posts_analyzed || 0) + posts.length;
      stats.total_comments_generated = (stats.total_comments_generated || 0) + generatedComments.length;
      
      // Update tone statistics
      stats.tones_used = stats.tones_used || {};
      for (const c of generatedComments) {
        stats.tones_used[c.tone] = (stats.tones_used[c.tone] || 0) + 1;
      }

      // Update daily history
      stats.daily_history = stats.daily_history || [];
      const dayHistIndex = stats.daily_history.findIndex(h => h.date === today);
      if (dayHistIndex !== -1) {
        stats.daily_history[dayHistIndex].posts_scanned = posts.length;
        stats.daily_history[dayHistIndex].relevant_found = generatedComments.length;
        stats.daily_history[dayHistIndex].comments_generated = generatedComments.length;
      } else {
        stats.daily_history.push({
          date: today,
          posts_scanned: posts.length,
          relevant_found: generatedComments.length,
          comments_generated: generatedComments.length,
          comments_posted: 0
        });
      }

      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      console.log('📊  [LLM] Statistics successfully updated in stats.json!');
    } catch (e) {
      console.error('⚠️  Failed to update stats.json:', e.message);
    }
  }

  console.log('🎉  [LLM] Comment generation process successfully complete!\n');
}

generateComments().catch(err => {
  console.error('💥  [LLM] Generator crashed:', err.message);
  process.exit(1);
});
