import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = 'c:\\Users\\Kiran\\linkedin-commenter';
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const HISTORY_FILE = path.join(DATA_DIR, 'comment-history.json');
const today = new Date().toISOString().split('T')[0];
const todayRunDir = path.join(DATA_DIR, 'runs', today);

console.log(`🧹 Cleaning up mock/temporary state for ${today} to prepare a fresh real run...`);

// 1. Clean history
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    const filteredHistory = history.filter(h => h.date !== today);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filteredHistory, null, 2));
    console.log(`✅ Removed ${history.length - filteredHistory.length} today's entries from comment-history.json`);
  } catch (e) {
    console.error('Failed to clean comment-history.json:', e.message);
  }
}

// 2. Clean runs directory
if (fs.existsSync(todayRunDir)) {
  try {
    const files = fs.readdirSync(todayRunDir);
    for (const file of files) {
      if (file !== 'audit.log') {
        fs.unlinkSync(path.join(todayRunDir, file));
      }
    }
    console.log(`✅ Cleared run folder: ${todayRunDir}`);
  } catch (e) {
    console.error('Failed to clear runs directory:', e.message);
  }
}

// 3. Clean stats daily history
if (fs.existsSync(STATS_FILE)) {
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    
    // Remove daily history for today
    const origLength = stats.daily_history?.length || 0;
    if (stats.daily_history) {
      stats.daily_history = stats.daily_history.filter(h => h.date !== today);
    }
    
    // Decrease total runs and stats by what was added today in previous iterations
    // Since we want to reset today's counters to a clean starting state, let's keep stats clean:
    let totalGenerated = 0;
    stats.daily_history?.forEach(h => {
      totalGenerated += (h.comments_generated || 0);
    });
    stats.total_comments_generated = totalGenerated;
    
    const totalPosted = stats.total_comments_posted || 0;
    stats.posting_rate = ((totalPosted / (stats.total_comments_generated || 1)) * 100).toFixed(1) + '%';
    
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    console.log(`✅ Reset stats.json history entries (removed ${origLength - (stats.daily_history?.length || 0)} today's records)`);
  } catch (e) {
    console.error('Failed to clean stats.json:', e.message);
  }
}

console.log('🧹 Cleanup completed successfully!');
