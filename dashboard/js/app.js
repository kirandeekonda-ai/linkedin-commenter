// ── State Management ────────────────────────────────────────────────────────
const state = {
  date: null,
  comments: [],
  stats: null,
  history: [],
  editingCommentId: null,
  toneChart: null,
};

// ── DOM Elements ────────────────────────────────────────────────────────────
const elements = {
  statAnalyzed: document.getElementById('statAnalyzed'),
  statToday: document.getElementById('statToday'),
  statPostRate: document.getElementById('statPostRate'),
  statPosted: document.getElementById('statPosted'),
  dateSelect: document.getElementById('dateSelect'),
  sectionTitle: document.getElementById('sectionTitle'),
  commentsList: document.getElementById('commentsList'),
  historyTableBody: document.getElementById('historyTableBody'),
  editModal: document.getElementById('editModal'),
  modalTextarea: document.getElementById('modalTextarea'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelModalBtn: document.getElementById('cancelModalBtn'),
  saveModalBtn: document.getElementById('saveModalBtn'),
  runScanBtn: document.getElementById('runScanBtn'),
  toast: document.getElementById('toast'),
};

// ── Initialization ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();
  setupEventListeners();
});

// ── Data Fetching & Loading ──────────────────────────────────────────────────
async function loadDashboardData() {
  await Promise.all([
    fetchStats(),
    fetchHistory()
  ]);
  
  populateDateSelector();
  
  const selectedDate = elements.dateSelect.value;
  if (selectedDate) {
    await fetchCommentsForDate(selectedDate);
  }
  
  renderStats();
  renderComments();
  renderHistory();
  renderCharts();
}

async function fetchCommentsForDate(date) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = date === today ? '/api/today' : `/api/comments/${date}`;
    const res = await fetch(url);
    const data = await res.json();
    state.date = data.date;
    state.comments = data.comments || [];
  } catch (err) {
    console.error(`Error fetching comments for date ${date}:`, err);
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    state.stats = await res.json();
  } catch (err) {
    console.error('Error fetching stats:', err);
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    state.history = await res.json();
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

function populateDateSelector() {
  elements.dateSelect.innerHTML = '';
  
  if (state.history.length === 0) {
    const today = new Date().toISOString().split('T')[0];
    const opt = document.createElement('option');
    opt.value = today;
    opt.textContent = `${today} (Today)`;
    elements.dateSelect.appendChild(opt);
    return;
  }
  
  state.history.forEach((run) => {
    const today = new Date().toISOString().split('T')[0];
    const isToday = run.date === today;
    const opt = document.createElement('option');
    opt.value = run.date;
    opt.textContent = isToday ? `${run.date} (Today)` : run.date;
    elements.dateSelect.appendChild(opt);
  });
}

// ── Render Functions ─────────────────────────────────────────────────────────

function renderStats() {
  if (!state.stats) return;
  
  elements.statAnalyzed.textContent = state.stats.total_posts_analyzed || 0;
  elements.statToday.textContent = state.comments.length;
  elements.statPostRate.textContent = state.stats.posting_rate || '0.0%';
  elements.statPosted.textContent = state.stats.total_comments_posted || 0;
}

function renderComments() {
  elements.commentsList.innerHTML = '';
  
  if (state.comments.length === 0) {
    elements.commentsList.innerHTML = `
      <div class="empty-state">
        <span style="font-size: 3rem; margin-bottom: 1rem;">📭</span>
        <h3>No Comments for this Date</h3>
        <p>No scan runs are saved for the selected date.</p>
      </div>
    `;
    return;
  }
  
  state.comments.forEach(c => {
    const relevancePercent = Math.round(c.relevance_score * 100);
    const excerpt = c.post_excerpt || '';
    const isPosted = c.was_posted || false;
    
    // Fallback to recent activity page if post_url is a profile link
    let displayUrl = c.post_url || '';
    if (displayUrl && displayUrl.includes('/in/') && !displayUrl.includes('/recent-activity/')) {
      const base = displayUrl.endsWith('/') ? displayUrl : displayUrl + '/';
      displayUrl = base + 'recent-activity/all/';
    }
    
    const card = document.createElement('div');
    card.className = `post-card animate-fade-in`;
    
    // Add image preview if local path is available
    let imageHtml = '';
    if (c.local_image_path) {
      imageHtml = `
        <div class="post-image-preview" style="margin-top: 12px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color); background: rgba(255,255,255,0.02); max-height: 280px; display: flex; justify-content: center; align-items: center;">
          <img src="/${c.local_image_path}" alt="Post attachment" style="max-width: 100%; max-height: 280px; object-fit: contain; display: block;" />
        </div>
      `;
    }

    const fullText = c.post_text || excerpt;
    const hasMore = fullText.length > excerpt.length;
    const bodyHtml = hasMore 
      ? `<p class="post-text-short" style="line-height: 1.5;">${excerpt} <span class="read-more-toggle" style="color: var(--color-cyan); cursor: pointer; font-weight: 600; font-size: 0.85rem; margin-left: 4px;" onclick="this.parentElement.style.display='none'; this.parentElement.nextElementSibling.style.display='block';">... Show more</span></p>
         <p class="post-text-full" style="display: none; white-space: pre-wrap; line-height: 1.5;">${fullText} <span class="read-less-toggle" style="color: var(--color-cyan); cursor: pointer; font-weight: 600; font-size: 0.85rem; margin-left: 4px;" onclick="this.parentElement.style.display='none'; this.parentElement.previousElementSibling.style.display='block';">Show less</span></p>`
      : `<p style="white-space: pre-wrap; line-height: 1.5;">${fullText}</p>`;

    card.innerHTML = `
      <div class="post-header">
        <div class="author-meta">
          <span class="author-name">${c.post_author}</span>
          <span class="author-title">${c.post_author_headline}</span>
        </div>
        <div class="post-badges">
          <span class="badge-relevance">🔥 ${relevancePercent}% Match</span>
          <span class="badge-tone">${c.tone}</span>
          <a href="${displayUrl}" target="_blank" class="post-link" title="Open Post on LinkedIn">🔗</a>
        </div>
      </div>
      <div class="post-body">
        ${bodyHtml}
        ${imageHtml}
      </div>

      <div class="comment-section">
        <div class="comment-label">
          <span>💬 Suggested Comment</span>
        </div>
        <div class="comment-box" id="box_${c.id}">${c.comment}</div>
        <div class="card-actions">
          <label class="checkbox-container">
            <input type="checkbox" id="check_${c.id}" ${isPosted ? 'checked' : ''} onchange="togglePosted('${c.id}', this.checked)">
            <span class="checkmark"></span>
            <span>Mark as Posted</span>
          </label>
          <div class="card-action-btns">
            <button class="btn btn-secondary btn-sm" onclick="openEditModal('${c.id}')">
              <span>✏️</span> Edit
            </button>
            <button class="btn btn-primary btn-sm" onclick="copyComment('${c.id}')">
              <span>📋</span> Copy Comment
            </button>
          </div>
        </div>
      </div>
    `;
    elements.commentsList.appendChild(card);
  });
}

function renderHistory() {
  elements.historyTableBody.innerHTML = '';
  
  if (state.history.length === 0) {
    elements.historyTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center text-muted">No runs found in history.</td>
      </tr>
    `;
    return;
  }
  
  state.history.forEach(run => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${run.date}</strong></td>
      <td>${run.posts_scanned}</td>
      <td>${run.comments_generated}</td>
      <td><span class="text-green">${run.comments_posted}</span></td>
    `;
    elements.historyTableBody.appendChild(tr);
  });
}

function renderCharts() {
  if (!state.stats || !state.stats.tones_used) return;
  
  const ctx = document.getElementById('toneChart').getContext('2d');
  
  // Destroy existing chart to avoid overlay issues on refresh
  if (state.toneChart) {
    state.toneChart.destroy();
  }
  
  const tones = state.stats.tones_used;
  const labels = Object.keys(tones).map(label => label.charAt(0).toUpperCase() + label.slice(1));
  const data = Object.values(tones);
  
  if (data.every(val => val === 0)) {
    // If no tones are used, don't render or show placeholders
    ctx.font = '14px Inter';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText('No data available yet.', 150, 115);
    return;
  }

  state.toneChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: [
          '#4f46e5', // Primary / Indigo (question)
          '#10b981', // Green (appreciation)
          '#06b6d4', // Cyan (addition)
          '#8b5cf6', // Purple (experience)
          '#f59e0b'  // Amber (pushback)
        ],
        borderWidth: 2,
        borderColor: '#151828',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#9ca3af',
            font: {
              family: 'Inter',
              size: 11
            },
            boxWidth: 12
          }
        }
      },
      cutout: '65%'
    }
  });
}

// ── User Actions ─────────────────────────────────────────────────────────────

window.copyComment = function(commentId) {
  const commentText = document.getElementById(`box_${commentId}`).textContent;
  navigator.clipboard.writeText(commentText).then(() => {
    showToast('Copied to clipboard! Ready to paste on LinkedIn.');
  }).catch(err => {
    console.error('Failed to copy text:', err);
  });
};

window.openEditModal = function(commentId) {
  const comment = state.comments.find(c => c.id === commentId);
  if (!comment) return;
  
  state.editingCommentId = commentId;
  elements.modalTextarea.value = comment.comment;
  elements.editModal.classList.add('active');
};

window.togglePosted = async function(commentId, isChecked) {
  try {
    const res = await fetch('/api/mark-posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        commentId: commentId,
        wasPosted: isChecked
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      // Update local state
      const commentIndex = state.comments.findIndex(c => c.id === commentId);
      if (commentIndex !== -1) {
        state.comments[commentIndex].was_posted = isChecked;
      }
      
      // Refresh stats
      await fetchStats();
      await fetchHistory();
      renderStats();
      renderHistory();
      renderCharts();
      
      showToast(isChecked ? 'Marked as posted on LinkedIn!' : 'Marked as unposted.');
    }
  } catch (err) {
    console.error('Error toggling posted status:', err);
  }
};

// ── Event Handlers ───────────────────────────────────────────────────────────

function setupEventListeners() {
  // Modal Close Events
  elements.closeModalBtn.addEventListener('click', closeModal);
  elements.cancelModalBtn.addEventListener('click', closeModal);
  elements.saveModalBtn.addEventListener('click', saveCommentEdit);
  
  // Close modal when clicking overlay
  elements.editModal.addEventListener('click', (e) => {
    if (e.target === elements.editModal) closeModal();
  });
  
  // Date Selector Change Event
  elements.dateSelect.addEventListener('change', async (e) => {
    const selectedDate = e.target.value;
    const today = new Date().toISOString().split('T')[0];
    
    if (selectedDate === today) {
      elements.sectionTitle.textContent = "🎯 Today's Recommended Comments";
    } else {
      elements.sectionTitle.textContent = `🎯 Recommended Comments (${selectedDate})`;
    }
    
    elements.commentsList.innerHTML = `
      <div class="loading-state">
        <span class="spinner"></span>
        <p>Loading comments for ${selectedDate}...</p>
      </div>
    `;
    
    await fetchCommentsForDate(selectedDate);
    renderComments();
  });
  
  // Run Scan Action
  elements.runScanBtn.addEventListener('click', () => {
    showToast('Starting scan in background. Check your console log.');
    // In our system, scanning is run via Antigravity scheduler or node terminal commands
    console.log('User requested scan execution.');
  });
}

function closeModal() {
  elements.editModal.classList.remove('active');
  state.editingCommentId = null;
}

async function saveCommentEdit() {
  const commentId = state.editingCommentId;
  const newText = elements.modalTextarea.value.trim();
  
  if (!commentId || !newText) return;
  
  try {
    const res = await fetch('/api/edit-comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        commentId: commentId,
        newText: newText
      })
    });
    
    if (res.ok) {
      // Update local state
      const commentIndex = state.comments.findIndex(c => c.id === commentId);
      if (commentIndex !== -1) {
        state.comments[commentIndex].comment = newText;
      }
      
      // Update UI
      document.getElementById(`box_${commentId}`).textContent = newText;
      closeModal();
      showToast('Comment updated successfully!');
    }
  } catch (err) {
    console.error('Error saving comment edit:', err);
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('active');
  
  setTimeout(() => {
    elements.toast.classList.remove('active');
  }, 3500);
}
