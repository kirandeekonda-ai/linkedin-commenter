# LinkedIn Commenter Agent — Autonomous Production Setup Guide

This document describes how to configure the LinkedIn Commenter Agent to run **100% autonomously** in the background every morning at **08:00 AM** without requiring any manual confirmation dialogs or UI approvals.

---

## 🧠 Architectural Overview

The system uses a two-part decoupled execution model to maintain strict security, reliability, and ease of use:

1.  **🧠 Programmatic Backend Orchestrator (`src/run.js` & `src/comment-generator.js`)**: 
    An autonomous script that launches Playwright to scrape posts, uses the Gemini API to analyze images, filters by domain relevance, generates visual-informed comments, and updates the local JSON database files.
2.  **🖥️ Interactive Glassmorphism Dashboard (`src/server.js` & `dashboard/`)**: 
    A local web server serving a stunning dark glassmorphism dashboard at `http://localhost:3000` where you can review, edit, copy, and log your engagement metrics in real-time.

---

## 🛠️ Step-by-Step Setup Instructions

### 1. Configure the Gemini API Key
To enable the background scripts to score posts and generate comments autonomously:
1. Navigate to the project root directory: `c:\Users\Kiran\linkedin-commenter`.
2. Locate the template file **`.env.example`**.
3. Create a copy of it and name it exactly **`.env`**.
4. Visit [Google AI Studio](https://aistudio.google.com/) and generate a free API key.
5. Open your `.env` file and paste the key:
   ```env
   GEMINI_API_KEY=AIzaSyD...your_actual_key_here...
   PORT=3000
   ```

---

### 2. Schedule the Task Natively (No-Confirmation Execution)
Because standard terminal triggers inside developer tools require manual click-approvals to prevent unverified code execution, the absolute best path for background automation is using **Windows Task Scheduler**. It executes the launcher script natively, completely bypassing any UI confirm prompts.

1.  Press the Windows Key, type **Task Scheduler**, and press Enter.
2.  In the right-hand *Actions* panel, click **Create Basic Task...**
3.  **Name**: `LinkedIn Commenter Pipeline`
4.  **Description**: `Scrapes LinkedIn feed, analyzes images, generates relevant comment suggestions, and updates the dashboard.`
5.  **Trigger**: Select **Daily** and click Next.
6.  **Recurrence**: Set the start time to **08:00 AM** (your local clock) and click Next.
7.  **Action**: Select **Start a program** and click Next.
8.  **Program/script**: Click Browse and select the launcher batch script:
    ```text
    c:\Users\Kiran\linkedin-commenter\run.bat
    ```
9.  **Start in (optional)**: Type your project folder to ensure relative path resolution:
    ```text
    c:\Users\Kiran\linkedin-commenter
    ```
10. Click **Finish**.

---

### 3. Run the Persistent Dashboard Server
To keep your review panel running so you can access recommendations at any time during the day:
1. Open a terminal in the project directory: `c:\Users\Kiran\linkedin-commenter`.
2. Launch the Express server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**.

---

## 🚀 Daily Workflow

1.  **08:00 AM**: Windows Task Scheduler silently runs `run.bat` in the background. Playwright automatically extracts posts, Gemini generates visually informed comment suggestions, and updates the databases (`comments.json` and `stats.json`).
2.  **Anytime**: You open **`http://localhost:3000`** in your browser. Today's 5 domain-relevant comment recommendations are already rendered on your screen.
3.  **Review & Post**: Read the suggestions, make inline edits if needed, click **Copy Comment**, navigate to the original post via the convenient link button, and paste manually.
4.  **Engage**: Check the **Mark as Posted** box to log your engagement and watch your metrics and tone charts update in real-time.

---

## 🛠️ Maintenance & Session Check

If your LinkedIn session cookies ever expire (typically after 14–30 days), the background scraper will gracefully record a session error. To re-authenticate:

1. Open your terminal in `c:\Users\Kiran\linkedin-commenter`.
2. Run the manual session setup script:
   ```bash
   npm run login
   ```
3. A headed Chromium window will open. Enter your credentials, complete 2FA, and wait for your feed page to load. The script will automatically save your fresh session and close the window!
