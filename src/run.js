/**
 * Orchestrator — Ties feed scanner and server together
 * 
 * Usage:
 *   node src/run.js            → Scan the feed (using saved session) and start the dashboard
 *   node src/run.js --server   → Just start the dashboard server without scanning
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SESSION_FILE = path.join(PROJECT_ROOT, 'data', 'browser-state', 'session.json');

const args = process.argv.slice(2);
const justServer = args.includes('--server');

function log(emoji, message) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`  ${emoji}  [${ts}] ${message}`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        LinkedIn Commenter Agent — Orchestrator          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (justServer) {
    log('🖥️', 'Starting dashboard server directly...');
    await import('./server.js');
    return;
  }

  // ── Step 1: Pre-flight checks ──
  if (!fs.existsSync(SESSION_FILE)) {
    log('❌', 'No saved session found.');
    log('💡', 'Please setup your session first by running: npm run login');
    process.exit(1);
  }

  // ── Step 2: Run feed scanner ──
  log('📜', 'Starting feed scanner to extract posts...');
  try {
    // Run the feed-scanner script synchronously
    execSync('node src/feed-scanner.js --headed', { stdio: 'inherit', cwd: PROJECT_ROOT });
    log('✅', 'Feed extraction complete.');
  } catch (err) {
    log('⚠️', 'Feed scanner encountered an issue, but we might still have existing data.');
  }

  // ── Step 3: Programmatic Comment Generation ──
  const today = new Date().toISOString().split('T')[0];
  const rawPostsPath = path.join(PROJECT_ROOT, 'data', 'runs', today, 'raw-posts.json');

  if (fs.existsSync(rawPostsPath)) {
    log('🧠', 'Starting programmatic comment generator...');
    try {
      execSync('node src/comment-generator.js', { stdio: 'inherit', cwd: PROJECT_ROOT });
      log('✅', 'Comment generation complete and stats updated!');
    } catch (err) {
      log('❌', `Failed to generate comments: ${err.message}`);
    }
  } else {
    log('❌', 'No raw posts found for today. Scan failed to produce output.');
    process.exit(1);
  }

  // ── Step 4: Start dashboard server ──
  log('🚀', 'Launching dashboard server...');
  await import('./server.js');
}

main().catch(err => {
  log('💥', `Orchestrator crashed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
