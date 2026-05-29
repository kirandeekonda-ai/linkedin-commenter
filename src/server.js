import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static dashboard files
app.use(express.static(path.join(PROJECT_ROOT, 'dashboard')));

// Helper to get today's date in YYYY-MM-DD
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// Helper to find comments file for a specific date
function getCommentsPath(date) {
  return path.join(DATA_DIR, 'runs', date, 'comments.json');
}

// ── GET /api/today ──
app.get('/api/today', (req, res) => {
  const today = getTodayDate();
  const filePath = getCommentsPath(today);

  if (!fs.existsSync(filePath)) {
    return res.json({ date: today, comments: [], status: 'No scan run today yet.' });
  }

  try {
    const comments = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json({ date: today, comments, status: 'success' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read comments', details: err.message });
  }
});

// ── GET /api/comments/:date ──
app.get('/api/comments/:date', (req, res) => {
  const date = req.params.date;
  const filePath = getCommentsPath(date);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `No comments found for date: ${date}` });
  }

  try {
    const comments = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json({ date, comments, status: 'success' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read comments', details: err.message });
  }
});

// ── GET /api/stats ──
app.get('/api/stats', (req, res) => {
  if (!fs.existsSync(STATS_FILE)) {
    return res.json({
      total_runs: 0,
      total_posts_analyzed: 0,
      total_comments_generated: 0,
      total_comments_posted: 0,
      posting_rate: '0.0%',
      tones_used: {},
      daily_history: []
    });
  }

  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read stats', details: err.message });
  }
});

// ── POST /api/edit-comment ──
app.post('/api/edit-comment', (req, res) => {
  const { date, commentId, newText } = req.body;
  if (!date || !commentId || newText === undefined) {
    return res.status(400).json({ error: 'Missing parameters: date, commentId, newText' });
  }

  const filePath = getCommentsPath(date);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No comments found for this date' });
  }

  try {
    const comments = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const commentIndex = comments.findIndex(c => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    comments[commentIndex].comment = newText;
    fs.writeFileSync(filePath, JSON.stringify(comments, null, 2));

    // Also update in comment-history.json if present
    const historyPath = path.join(DATA_DIR, 'comment-history.json');
    if (fs.existsSync(historyPath)) {
      try {
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        const histIndex = history.findIndex(h => h.post_id === comments[commentIndex].post_id);
        if (histIndex !== -1) {
          history[histIndex].comment = newText;
          fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        }
      } catch (e) {
        console.error('Failed to update comment-history:', e.message);
      }
    }

    res.json({ status: 'success', comment: comments[commentIndex] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update comment', details: err.message });
  }
});

// ── POST /api/mark-posted ──
app.post('/api/mark-posted', (req, res) => {
  const { date, commentId, wasPosted } = req.body;
  if (!date || !commentId || wasPosted === undefined) {
    return res.status(400).json({ error: 'Missing parameters: date, commentId, wasPosted' });
  }

  const filePath = getCommentsPath(date);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No comments found for this date' });
  }

  try {
    const comments = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const commentIndex = comments.findIndex(c => c.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const oldStatus = comments[commentIndex].was_posted || false;
    if (oldStatus === wasPosted) {
      return res.json({ status: 'no_change', comment: comments[commentIndex] });
    }

    comments[commentIndex].was_posted = wasPosted;
    comments[commentIndex].posted_at = wasPosted ? new Date().toISOString() : null;
    fs.writeFileSync(filePath, JSON.stringify(comments, null, 2));

    // Update global statistics
    if (fs.existsSync(STATS_FILE)) {
      const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      
      // Update counts
      if (wasPosted) {
        stats.total_comments_posted = (stats.total_comments_posted || 0) + 1;
      } else {
        stats.total_comments_posted = Math.max(0, (stats.total_comments_posted || 0) - 1);
      }

      // Re-calculate posting rate
      if (stats.total_comments_generated > 0) {
        stats.posting_rate = ((stats.total_comments_posted / stats.total_comments_generated) * 100).toFixed(1) + '%';
      } else {
        stats.posting_rate = '0.0%';
      }

      // Update daily_history entries
      const dayHist = stats.daily_history?.find(h => h.date === date);
      if (dayHist) {
        if (wasPosted) {
          dayHist.comments_posted = (dayHist.comments_posted || 0) + 1;
        } else {
          dayHist.comments_posted = Math.max(0, (dayHist.comments_posted || 0) - 1);
        }
      }

      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    }

    res.json({ status: 'success', comment: comments[commentIndex] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update stats', details: err.message });
  }
});

// ── GET /api/history ──
app.get('/api/history', (req, res) => {
  const runsDir = path.join(DATA_DIR, 'runs');
  if (!fs.existsSync(runsDir)) {
    return res.json([]);
  }

  try {
    const dates = fs.readdirSync(runsDir).filter(f => fs.statSync(path.join(runsDir, f)).isDirectory());
    const history = [];

    for (const date of dates) {
      const commPath = getCommentsPath(date);
      if (fs.existsSync(commPath)) {
        const fileContent = JSON.parse(fs.readFileSync(commPath, 'utf-8'));
        const postsPath = path.join(DATA_DIR, 'runs', date, 'raw-posts.json');
        let postsCount = 0;
        let scCount = 0;
        
        if (fs.existsSync(postsPath)) {
          const raw = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
          postsCount = raw.meta?.total_found || raw.posts?.length || 0;
          scCount = raw.meta?.scrolls || 0;
        }

        const generated = fileContent.length;
        const posted = fileContent.filter(c => c.was_posted).length;

        history.push({
          date,
          posts_scanned: postsCount,
          scrolls: scCount,
          comments_generated: generated,
          comments_posted: posted,
          status: 'success'
        });
      }
    }

    // Sort descending by date
    history.sort((a, b) => b.date.localeCompare(a.date));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  🟢  Dashboard API server running at http://localhost:${PORT}`);
});
