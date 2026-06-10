# 🧠 LinkedIn Commenter Agent

A daily-automated personal productivity assistant that scans your LinkedIn feed, identifies posts relevant to your specific professional domain, and generates **highly human-authentic, visual-informed comments** for you to review, edit, and post manually. 

Designed for systems architects, engineering leaders, and developers looking to expand their organic network presence with zero AI-jargon and absolute read-only safety.

---

## ✨ Core Features

*   **🛡️ Read-Only BrowserGuard Safety**: Wraps Playwright execution to physically intercept and block any mutation actions (clicks on like/comment/connect, form submissions, or write-based network requests). Your account remains 100% compliant.
*   **🍪 Playwright Session Reuse**: Log in manually once, save your session state (`cookies + localStorage`), and let Playwright bypass authentication screens completely on future runs.
*   **✍️ Elite Tone & Comment Engine**: Tailors suggestions to your specific developer profile. Avoids AI clichés, generic openings ("Great post!"), and emoji spam, selecting exactly one context-appropriate tone (Addition, Experience, Question, Appreciation, Pushback).
*   **🖥️ Dark Glassmorphism Dashboard**: An interactive, premium web interface at `http://localhost:3000` to review, edit, click-to-copy, and log engagement metrics with Chart.js-powered visual trends.
*   **⏰ Autonomous Scheduling**: Configured for 100% human-out-of-the-loop background trigger runs using native Windows Task Scheduler at **08:00 AM** daily.

---

## 🛠️ Project Structure

```text
linkedin-commenter/
├── package.json
├── AUTONOMOUS_SETUP.md      # Detailed Windows Task Scheduler automation guide
├── README.md                # Project index and setup overview
│
├── src/
│   ├── run.js               # Unified pipeline orchestrator (Scanner + Writer + Server)
│   ├── feed-scanner.js      # Playwright feed scraper (image extraction + BrowserGuard active)
│   ├── browser-guard.js     # Strict read-only interception middleware
│   ├── login-manager.js     # Persistent session loader and manual authenticator
│   └── server.js            # Dashboard REST API Express server
│
├── dashboard/               # Glassmorphism Client Web App
│   ├── index.html
│   ├── css/index.css
│   └── js/app.js
│
├── data/                    # Persistent storage (gitignored except template)
│   ├── profile.md           # Your professional bio and tone specifications
│   ├── stats.json           # Cumulative analytics and history metrics
│   ├── comment-history.json # Historical logs to prevent duplicate author engagement
│   └── runs/                # Today's scan and generated comments database
│
└── tests/
    └── browser-guard.test.js # Safety validation unit tests
```

---

## 🚀 Quick Start Guide

### 1. Installation
Install project dependencies using your command line:
```bash
npm install
```

### 2. Manual Login (One-Time Setup)
Run the session authenticating script:
```bash
npm run login
```
*A headed browser will open. Log into your LinkedIn account, handle any 2FA/security codes, and wait for your feed to load. The script will automatically capture your session cookies to `data/browser-state/session.json` and exit.*

### 3. Configure Your Professional Profile
Create a markdown file at `data/profile.md` using the template format to instruct the generator how to sound like you:
```markdown
# Profile

## Your current role & domain
Enterprise Systems Architect specializing in Agentic AI Platform Design.

## Key skills/technologies
Multi-agent orchestration, self-hosted transparent infrastructure, LLM integrations.

## What kind of tone you prefer
Direct, thoughtful, professional. Authoritative yet collaborative.
```

---

## ⚙️ Command Guide

| Command | Action |
|---|---|
| **`npm run orchestrate`** | Runs the full pipeline: scans your feed, generates visual comments, and launches the server. |
| **`npm start`** | Starts only the interactive Glassmorphism Dashboard at `http://localhost:3000`. |
| **`npm run scan`** | Scrapes the feed and extracts posts/images without triggering comment writing. |
| **`npm run verify-session`**| Checks if your saved LinkedIn browser session is active and working. |
| **`npm test`** | Runs safety unit tests ensuring `BrowserGuard` blocks mutation actions. |

---

## 🤖 Custom Agent Chat Trigger

If you are pair programming with an AI coding assistant (like Antigravity or any other Gemini agent) in a fresh chat session, you can use this shortcut:
*   **/generate-comments**: Type this text directly in the chat. The AI agent will parse this `README.md` document, recognize the custom trigger, and automatically execute the entire pipeline (`npm run orchestrate`), generate 5 unique comments, and start your dashboard server without requiring long instruction prompts.

---

## ⏰ Deploying Autonomous Background Runs

To automate the entire workflow without manual chat or CLI approvals, set up **Windows Task Scheduler** to execute the built-in launcher script **`run.bat`** at **08:00 AM** every morning.

For step-by-step instructions on setting this up, please refer to:
📄 **[AUTONOMOUS_SETUP.md](file:///c:/Users/Kiran/linkedin-commenter/AUTONOMOUS_SETUP.md)**

---

## 🛡️ Security & Compliance Disclaimer

This project is a personal productivity tool. It does **not** perform automated posting, liking, or connecting, and operates entirely in **read-only mode**. All generated comments are kept in a local database and only posted when you manually click "Copy Comment" and paste it yourself. Use at your own discretion.
