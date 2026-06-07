import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = 'c:/Users/Kiran/linkedin-commenter';
const today = '2026-06-03';
const RUN_DIR = path.join(PROJECT_ROOT, 'data', 'runs', today);
const FILTERED_POSTS_FILE = path.join(RUN_DIR, 'filtered-posts.json');
const COMMENTS_FILE = path.join(RUN_DIR, 'comments.json');
const HISTORY_FILE = path.join(PROJECT_ROOT, 'data', 'comment-history.json');
const STATS_FILE = path.join(PROJECT_ROOT, 'data', 'stats.json');

const customComments = {
  "urn:li:activity:7467190758836727808": {
    tone: "addition",
    comment: "Really interesting pattern match, Navin. Brokering credentials via scoped, revokable tokens is the exact boundary model AI agent commerce needs to adopt. In our platform design, we've found that shielding the agent from raw schema complexity or live payment rails is the only way to make transaction gateways trustworthy. Are you seeing payment networks begin to issue native, agent-scoped credentials yet, or are we stuck building translation brokers like mcp-broker for the foreseeable future?"
  },
  "urn:li:activity:7465303295817969664": {
    tone: "addition",
    comment: "Appreciate you laying this out, Shalini. For production deployments, we've found that the real bottleneck isn't the LLM reasoning capability, but managing resumable agent state without bloating the context window. How are you handling state synchronization and recovery when intermediate agent steps fail under concurrent load?"
  },
  "gen_ramakrishnanraj_decisionintelligence": {
    tone: "experience",
    comment: "Your point about decision loop quality is crucial, Ramakrishnan. Autonomous action is a major liability in enterprise systems unless we wrap the probabilistic model in a deterministic state machine to bound the blast radius. What has been the biggest hurdle in getting compliance and risk teams to trust these autonomous decision boundaries?"
  },
  "urn:li:activity:7467477643060293632": {
    tone: "experience",
    comment: "This is a clean breakdown of the ecosystem, Alok. For teams trying to move from PoC to production, distinguishing between an LLM call and a full agentic architecture is where the actual systems engineering challenges begin. Are you seeing organizations design their stacks to be decoupled from specific model providers to avoid vendor lock-in?"
  },
  "urn:li:activity:7467538303094001664": {
    tone: "addition",
    comment: "Focusing on underlying design patterns rather than ephemeral framework tooling is definitely the right philosophy, Alok. We've seen many teams struggle because they chase the latest SDK update instead of focusing on core engineering principles like state boundary contracts and timeout handling. Which architectural pattern do you see developers struggle with the most when moving their first agent to production?"
  }
};

async function save() {
  if (!fs.existsSync(FILTERED_POSTS_FILE)) {
    console.error('Filtered posts file does not exist');
    process.exit(1);
  }

  const posts = JSON.parse(fs.readFileSync(FILTERED_POSTS_FILE, 'utf-8'));
  const generatedComments = posts.map((post, index) => {
    const custom = customComments[post.post_id] || {
      tone: 'addition',
      comment: `This is a highly relevant point, ${post.author_name}. Closing the gap between dynamic agent workflows and enterprise stability requires moving away from plain-text prompting toward deterministic execution boundaries.`
    };

    return {
      id: `cmt_${today.replace(/-/g, '')}_00${index + 1}`,
      post_id: post.post_id,
      post_url: post.post_url,
      post_author: post.author_name,
      post_author_headline: post.author_headline || "Technology Leader",
      post_excerpt: post.post_text.substring(0, 160) + (post.post_text.length > 160 ? '...' : ''),
      relevance_score: post.relevance_score,
      relevance_reason: post.relevance_reason,
      connection_degree: post.connection_degree || '3rd',
      tone: custom.tone,
      comment: custom.comment,
      generated_at: new Date().toISOString(),
      was_posted: false,
      posted_at: null
    };
  });

  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(generatedComments, null, 2));
  console.log(`Saved generated comments to: ${COMMENTS_FILE}`);

  // Update history database
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    } catch (e) {
      console.warn('Failed to read history, starting fresh');
    }
  }

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
  console.log('Synchronized history database.');

  // Update stats.json
  if (fs.existsSync(STATS_FILE)) {
    try {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      
      stats.total_runs = (stats.total_runs || 0) + 1;
      
      generatedComments.forEach(c => {
        stats.tones_used = stats.tones_used || {};
        stats.tones_used[c.tone] = (stats.tones_used[c.tone] || 0) + 1;
      });

      stats.daily_history = stats.daily_history || [];
      const dayHistIndex = stats.daily_history.findIndex(h => h.date === today);
      if (dayHistIndex !== -1) {
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

      let totalGeneratedComments = 0;
      stats.daily_history.forEach(h => {
        totalGeneratedComments += (h.comments_generated || 0);
      });
      stats.total_comments_generated = totalGeneratedComments;

      const totalPosted = stats.total_comments_posted || 0;
      stats.posting_rate = ((totalPosted / (stats.total_comments_generated || 1)) * 100).toFixed(1) + '%';

      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      console.log('Updated global statistics file.');
    } catch (e) {
      console.warn('Failed to update stats:', e.message);
    }
  }
}

save();
