import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'firebase/auth';
import { app } from '../firebase-config.js';
import { setAuthToken, api } from '../api.js';
import { uploadImage } from '../modules/submitForm.js';

const auth = getAuth(app);

// ---------- Element refs ----------

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const reviewPanel = document.getElementById('review-panel');
const listPanel = document.getElementById('list-panel');
const reviewCard = document.getElementById('review-card');
const reviewPosition = document.getElementById('review-position');
const reviewQueueLabel = document.getElementById('review-queue-label');
const reviewProgress = document.getElementById('review-progress');
const searchInput = document.getElementById('search-input');
const queueRoot = document.getElementById('queue-root');
const pageInfo = document.getElementById('page-info');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const toastEl = document.getElementById('toast');

// ---------- State ----------

let mode = localStorage.getItem('chaliAdminMode') || 'review'; // 'review' | 'list'
let filter = 'quarantine';
let stats = { total: 0, active: 0, quarantine: 0, deleted: 0 };

// review queue
let queue = [];          // jokes loaded for review
let cursor = 0;          // index into queue
let fetchOffset = 0;     // rows already fetched server-side
let actedCount = 0;      // jokes approved/deleted this session
let reviewLoading = false;
let reviewEndReached = false;

// list
let listQ = '';
let listOffset = 0;
let listLimit = 50;
let listTotal = 0;

// bulk
let selectedIds = new Set();
let bulkProcessing = false;

// undo
let lastAction = null;
let toastTimer = null;

// ---------- Auth ----------

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const token = await user.getIdToken();
      setAuthToken(token);
    } catch (err) {
      console.error('Failed to get auth token:', err);
    }
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    const saved = localStorage.getItem('chaliAdminMode');
    if (saved === 'list' || saved === 'review') mode = saved;
    await loadStats();
    syncMode();
  } else {
    setAuthToken(null);
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
  } catch (err) {
    errorEl.textContent = 'Invalid credentials';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// ---------- Core helpers ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function score(joke) {
  return joke.upvotes - joke.downvotes;
}

async function runStatus(jokeId, status) {
  try {
    await api.adminSetStatus(jokeId, status);
    return true;
  } catch (err) {
    toast(`Error: ${err.message}`, null, true);
    return false;
  }
}

// ---------- Stats ----------

async function loadStats() {
  try {
    const s = await api.adminStats();
    stats = { total: s.total ?? 0, active: s.active ?? 0, quarantine: s.quarantine ?? 0, deleted: s.deleted ?? 0 };
    renderStats();
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function renderStats() {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-active').textContent = stats.active;
  document.getElementById('stat-quarantine').textContent = stats.quarantine;
  document.getElementById('stat-deleted').textContent = stats.deleted;
  updateReviewPosition();
}

// apply a local status flip to stats without hitting the DB
function adjustStats(fromStatus, toStatus) {
  if (stats[fromStatus] !== undefined && stats[fromStatus] > 0) stats[fromStatus]--;
  if (stats[toStatus] !== undefined) stats[toStatus]++;
  renderStats();
}

// ---------- Mode / filter ----------

function syncMode() {
  document.getElementById('mode-review').classList.toggle('active', mode === 'review');
  document.getElementById('mode-list').classList.toggle('active', mode === 'list');
  reviewPanel.classList.toggle('hidden', mode !== 'review');
  listPanel.classList.toggle('hidden', mode !== 'list');

  if (mode === 'review') {
    if (filter !== 'quarantine') {
      mode = 'list';
      syncMode();
      return;
    }
    initReview();
  } else {
    loadList(true);
  }
}

function setFilter(status) {
  filter = status;
  document.querySelectorAll('#filter-pills .pill').forEach((b) =>
    b.classList.toggle('active', b.dataset.status === status));
  if (mode === 'review') {
    if (status !== 'quarantine') {
      setMode('list');
    } else {
      initReview();
    }
  } else {
    loadList(true);
  }
}

function setMode(m) {
  mode = m;
  localStorage.setItem('chaliAdminMode', m);
  syncMode();
}

document.getElementById('mode-review').addEventListener('click', () => setMode('review'));
document.getElementById('mode-list').addEventListener('click', () => setMode('list'));

document.querySelectorAll('#filter-pills .pill').forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.status));
});
document.querySelectorAll('#stats-row .stat-card').forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.status));
  btn.title = `Show ${btn.dataset.status}`;
});

document.getElementById('new-joke-btn').addEventListener('click', openCreateForm);

// ---------- Review engine ----------

async function initReview() {
  queue = [];
  cursor = 0;
  fetchOffset = 0;
  actedCount = 0;
  reviewEndReached = false;
  await loadMoreReviews(true);
  updateReviewPosition();
  renderReviewCard();
}

async function loadMoreReviews(reset) {
  if (reviewLoading) return;
  reviewLoading = true;
  try {
    const res = await api.adminList({ status: 'quarantine', limit: 40, offset: fetchOffset });
    const rows = (res && res.jokes) || [];
    fetchOffset += rows.length;
    const seen = new Set(queue.map((j) => j.id));
    queue.push(...rows.filter((j) => !seen.has(j.id)));
    if (rows.length < 40) reviewEndReached = true;
  } catch (err) {
    toast(`Couldn't load: ${err.message}`, null, true);
  } finally {
    reviewLoading = false;
    updateReviewPosition();
    renderReviewCard();
  }
}

function updateReviewPosition() {
  const total = stats.quarantine || 0;
  const remaining = total - actedCount;
  reviewPosition.textContent = `${remaining} to review`;
  reviewQueueLabel.textContent = total ? `${remaining} left of ${total}` : '—';
  reviewProgress.style.width = total ? `${Math.min(100, (actedCount / total) * 100)}%` : '0%';
  reviewProgress.style.background = total === 0
    ? 'linear-gradient(90deg, #4fd18a, #2e9e5b)'
    : 'linear-gradient(90deg, var(--accent-green), #4fd18a)';
}

function renderReviewCard() {
  const joke = queue[cursor];
  if (!joke) {
    reviewCard.innerHTML = '<p class="review-empty">Nothing to review here. Nice!</p>';
    reviewQueueLabel.textContent = reviewEndReached ? 'Queue drained 🎉' : 'Loading…';
    if (!reviewEndReached && !reviewLoading && fetchOffset > 0) loadMoreReviews();
    return;
  }

  reviewCard.innerHTML = `
    <div class="review-badges">
      <span class="type-pill">${joke.type === 'qna' ? 'Q&amp;A' : 'Single'}</span>
      <span class="status-pill ${joke.status}">${joke.status}</span>
    </div>
    <p class="review-question">${escapeHtml(joke.question)}</p>
    ${joke.type === 'qna' && joke.answer ? `<div class="review-answer">${escapeHtml(joke.answer)}</div>` : ''}
    ${joke.imageUrl ? `<img src="${joke.imageUrl}" alt="" referrerpolicy="no-referrer" />` : ''}
    <div class="review-meta">
      Score: ${score(joke)} (↑${joke.upvotes} ↓${joke.downvotes}) · by ${escapeHtml(joke.submittedBy || '—')}
    </div>
  `;
}

async function reviewConsume(action) {
  const joke = queue[cursor];
  if (!joke) return;

  if (action) {
    const prevStatus = joke.status;
    const ok = await runStatus(joke.id, action);
    if (!ok) return;
    adjustStats(prevStatus, action);
    lastAction = { id: joke.id, status: prevStatus, to: action, joke };
    queue.splice(cursor, 1);
    actedCount++;
    toast(action === 'active' ? 'Approved' : 'Deleted', showUndoCard());
  } else {
    cursor++; // skip
  }

  if (cursor >= queue.length) {
    if (reviewEndReached) {
      // drained everything; start fresh to pick up newly submitted jokes
      queue = [];
      cursor = 0;
      fetchOffset = 0;
      reviewEndReached = false;
      await loadMoreReviews(true);
    } else {
      await loadMoreReviews();
    }
  }
  updateReviewPosition();
  renderReviewCard();
}

// build a button that undoes from the current card's position
function showUndoCard() {
  return () => undoLast();
}

document.getElementById('review-approve').addEventListener('click', () => reviewConsume('active'));
document.getElementById('review-delete').addEventListener('click', () => reviewConsume('deleted'));
document.getElementById('review-skip').addEventListener('click', () => reviewConsume(null));
document.getElementById('review-edit').addEventListener('click', () => {
  const joke = queue[cursor];
  if (joke) openEditForm(joke);
});

// ---------- Undo ----------

async function undoLast() {
  if (!lastAction) return;
  const { id, status, to, joke } = lastAction;
  lastAction = null;
  hideToast();
  const ok = await runStatus(id, status);
  if (!ok) return;
  if (to !== status) adjustStats(to, status);
  if (status === 'quarantine' && mode === 'review' && filter === 'quarantine') {
    queue.unshift(joke);
    cursor = 0;
    actedCount = Math.max(0, actedCount - 1);
    renderReviewCard();
  } else {
    if (mode === 'list') loadList(false);
    if (mode === 'review') {
      queue = [];
      cursor = 0;
      fetchOffset = 0;
      reviewEndReached = false;
      await loadMoreReviews(true);
    }
  }
  updateReviewPosition();
  toast('Undone ✓');
}

// remove unused applyStatsFlip in favor of direct adjustStats calls

// ---------- List engine ----------

async function loadList(reset) {
  if (reset) { listOffset = 0; }
  queueRoot.innerHTML = '<p class="list-empty">Loading…</p>';
  document.getElementById('bulk-bar').classList.add('hidden');
  clearSelection(true);

  try {
    const params = { status: filter, limit: listLimit, offset: listOffset };
    if (listQ) params.q = listQ;
    const res = await api.adminList(params);
    const rows = (res && res.jokes) || [];
    listTotal = res.total ?? rows.length;
    renderList(rows);
  } catch (err) {
    queueRoot.innerHTML = `<p class="list-empty">Couldn't load jokes: ${escapeHtml(err.message)}</p>`;
  }
}

function renderList(jokes) {
  const showBulk = !listQ && filter === 'quarantine';
  document.getElementById('bulk-bar').classList.toggle('hidden', !showBulk);

  if (jokes.length === 0) {
    queueRoot.innerHTML = '<p class="list-empty">Nothing here.</p>';
  } else {
    queueRoot.innerHTML = jokes.map((joke) => `
      <div class="list-item" data-id="${joke.id}" data-status="${joke.status}">
        ${showBulk ? `
          <label class="list-item-check">
            <input type="checkbox" class="joke-check" data-id="${joke.id}" ${selectedIds.has(joke.id) ? 'checked' : ''} />
          </label>` : ''}
        <div class="list-item-body">
          <p class="list-item-question">
            <span class="type-pill">${joke.type === 'qna' ? 'Q&amp;A' : 'Single'}</span>
            <span class="status-pill ${joke.status}">${joke.status}</span>
            &nbsp;${escapeHtml(joke.question)}
          </p>
          ${joke.answer ? `<p class="list-item-answer">A: ${escapeHtml(joke.answer)}</p>` : ''}
          <p class="list-item-meta">Score: ${score(joke)} (↑${joke.upvotes} ↓${joke.downvotes}) · by ${escapeHtml(joke.submittedBy || '—')}</p>
        </div>
        <div class="list-item-actions">
          ${joke.status === 'quarantine' ? `<button class="btn-approve" data-id="${joke.id}">Approve</button>` : ''}
          ${joke.status === 'deleted' ? `<button class="btn-restore" data-id="${joke.id}">Restore</button>` : ''}
          ${joke.status !== 'deleted' ? `<button class="btn-delete" data-id="${joke.id}">Delete</button>` : ''}
          <button class="btn-edit" data-id="${joke.id}">Edit</button>
        </div>
      </div>`).join('');
  }

  const from = listTotal ? listOffset + 1 : 0;
  const to = Math.min(listOffset + jokes.length, listTotal);
  pageInfo.textContent = listTotal ? `${from}–${to} of ${listTotal}` : '';
  prevPageBtn.disabled = listOffset === 0;
  nextPageBtn.disabled = listOffset + jokes.length >= listTotal;

  // wire events
  queueRoot.querySelectorAll('.joke-check').forEach((cb) =>
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      updateBulkBar();
    }));

  queueRoot.querySelectorAll('.btn-approve').forEach((btn) =>
    btn.addEventListener('click', () => singleAction(btn.dataset.id, 'active', btn.closest('.list-item').dataset.status)));
  queueRoot.querySelectorAll('.btn-delete').forEach((btn) =>
    btn.addEventListener('click', () => singleAction(btn.dataset.id, 'deleted', btn.closest('.list-item').dataset.status)));
  queueRoot.querySelectorAll('.btn-restore').forEach((btn) =>
    btn.addEventListener('click', () => singleAction(btn.dataset.id, 'active', btn.closest('.list-item').dataset.status)));
  queueRoot.querySelectorAll('.btn-edit').forEach((btn) =>
    btn.addEventListener('click', () => openEditById(btn.dataset.id, jokes)));
}

async function singleAction(jokeId, status, fromStatus) {
  if (!(await runStatus(jokeId, status))) return;
  if (fromStatus && fromStatus !== status) adjustStats(fromStatus, status);
  loadList(false);
}

prevPageBtn.addEventListener('click', () => { listOffset = Math.max(0, listOffset - listLimit); loadList(false); });
nextPageBtn.addEventListener('click', () => { listOffset += listLimit; loadList(false); });

// ---------- Bulk ----------

function updateBulkBar() {
  document.getElementById('bulk-count').textContent = `${selectedIds.size} selected`;
  document.getElementById('bulk-approve-btn').textContent = `Approve (${selectedIds.size})`;
  document.getElementById('bulk-delete-btn').textContent = `Delete (${selectedIds.size})`;
  const disabled = selectedIds.size === 0 || bulkProcessing;
  document.getElementById('bulk-approve-btn').disabled = disabled;
  document.getElementById('bulk-delete-btn').disabled = disabled;
}

function clearSelection(skipBar) {
  selectedIds.clear();
  document.getElementById('select-all-check').checked = false;
  if (!skipBar) updateBulkBar();
}

document.getElementById('select-all-check').addEventListener('change', (e) => {
  const checks = document.querySelectorAll('#queue-root .joke-check');
  selectedIds.clear();
  if (e.target.checked) checks.forEach((c) => selectedIds.add(c.dataset.id));
  checks.forEach((c) => { c.checked = e.target.checked; });
  updateBulkBar();
});

async function bulkSetStatus(label, status) {
  const ids = [...selectedIds];
  if (!ids.length || bulkProcessing) return;
  const verb = status === 'active' ? 'Approve' : 'Delete';
  if (!confirm(`${verb} ${ids.length} joke(s)?`)) return;

  bulkProcessing = true;
  updateBulkBar();
  try {
    let failed = 0;
    for (const id of ids) {
      if (!(await runStatus(id, status))) failed++;
    }
    adjustStats('quarantine', status === 'active' ? 'active' : 'deleted');
    lastAction = null;
    toast(`${verb}d ${ids.length - failed}${failed ? `, ${failed} failed` : ''} ✓`);
    loadList(false);
  } finally {
    bulkProcessing = false;
    clearSelection();
    loadStatsTick();
  }
}

document.getElementById('bulk-approve-btn').addEventListener('click', () => bulkSetStatus('Approving', 'active'));
document.getElementById('bulk-delete-btn').addEventListener('click', () => bulkSetStatus('Deleting', 'deleted'));

// ---------- Search ----------

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    listQ = searchInput.value.trim();
    if (listQ && mode === 'review') setMode('list');
    loadList(true);
  }, 250);
});

// focus search on "/"
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !isTyping(e.target)) {
    e.preventDefault();
    searchInput.focus();
  }
});

// ---------- Edit / Create modal ----------

const form = document.getElementById('joke-form');
const formTitle = document.getElementById('joke-form-title');
const formIdField = document.getElementById('joke-form-id');
const formType = document.getElementById('joke-form-type');
const formQuestion = document.getElementById('joke-form-question');
const formAnswerLabel = document.getElementById('joke-form-answer-label');
const formAnswer = document.getElementById('joke-form-answer');
const formStatus = document.getElementById('joke-form-status');
const formImage = document.getElementById('joke-form-image');
const formMsg = document.getElementById('joke-form-status-msg');
const editModal = document.getElementById('edit-modal');

let editingJokeId = null;
let editingCallback = null; // called after successful save

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function openModal() {
  editModal.classList.remove('hidden');
  formQuestion.focus();
}

function closeModal() {
  editModal.classList.add('hidden');
  editingJokeId = null;
  editingCallback = null;
}

function openCreateForm() {
  editingJokeId = null;
  formTitle.textContent = 'New Joke';
  formIdField.value = '';
  formType.value = 'single';
  formQuestion.value = '';
  formAnswer.value = '';
  formAnswerLabel.classList.add('hidden');
  formAnswer.classList.add('hidden');
  formStatus.value = 'active';
  formImage.value = '';
  formMsg.textContent = '';
  openModal();
}

function openEditById(id, list) {
  const joke = list.find((j) => j.id === id);
  if (joke) openEditForm(joke);
}

function openEditForm(joke) {
  if (!joke) return;
  editingJokeId = joke.id;
  formTitle.textContent = 'Edit Joke';
  formIdField.value = joke.id;
  formType.value = joke.type;
  formQuestion.value = joke.question;
  formAnswer.value = joke.answer || '';
  const isQna = joke.type === 'qna';
  formAnswer.classList.toggle('hidden', !isQna);
  formAnswerLabel.classList.toggle('hidden', !isQna);
  formStatus.value = joke.status;
  formImage.value = '';
  formMsg.textContent = '';
  openModal();
}

document.getElementById('joke-form-cancel').addEventListener('click', closeModal);
document.getElementById('joke-form-cancel-btn').addEventListener('click', closeModal);

document.getElementById('edit-modal').addEventListener('click', (e) => {
  if (e.target === editModal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

formType.addEventListener('change', () => {
  const isQna = formType.value === 'qna';
  formAnswer.classList.toggle('hidden', !isQna);
  formAnswerLabel.classList.toggle('hidden', !isQna);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  formMsg.textContent = 'Saving…';

  try {
    const type = formType.value;
    const question = formQuestion.value.trim();
    const answer = type === 'qna' ? formAnswer.value.trim() : null;
    const status = formStatus.value;
    const imageFile = formImage.files[0];

    if (!question) throw new Error('Joke text is required');
    if (type === 'qna' && !answer) throw new Error('Answer is required for QnA jokes');

    let imagePatch = {};
    if (imageFile) {
      const uploaded = await uploadImage(imageFile);
      imagePatch = { imageUrl: uploaded.imageUrl, imagePublicId: uploaded.imagePublicId };
    }

    if (editingJokeId) {
      await api.adminUpdate(editingJokeId, { type, question, answer, status, ...imagePatch });
      toast('Saved ✓');
    } else {
      await api.adminCreate({ type, question, answer, status, ...imagePatch });
      toast('Created ✓');
    }
    closeModal();
    reloadAfterSave();
  } catch (err) {
    formMsg.textContent = err.message || 'Save failed.';
  } finally {
    submitBtn.disabled = false;
  }
});

function reloadAfterSave() {
  if (mode === 'review' && filter === 'quarantine') {
    queue = queue.map((j) => {
      if (j.id === editingJokeId) {
        // will be refetched on next review pass; drop it if it left quarantine
        return j;
      }
      return j;
    });
    queue = queue.filter((j) => j.id !== editingJokeId); // force a fresh review of it
    initReview();
  } else {
    loadList(false);
  }
  loadStatsTick();
}

// ---------- Keyboard shortcuts (review mode) ----------

document.addEventListener('keydown', (e) => {
  if (editModal && !editModal.classList.contains('hidden')) return;
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (mode !== 'review' || reviewPanel.classList.contains('hidden')) return;

  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'd') {
    e.preventDefault();
    reviewConsume(k === 'a' ? 'active' : 'deleted');
  } else if (k === 'e') {
    e.preventDefault();
    const joke = queue[cursor];
    if (joke) openEditForm(joke);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    reviewConsume(null);
  }
});

// ---------- Toast ----------

function toast(msg, undoFn, isError) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  toastEl.textContent = msg;
  toastEl.style.background = isError ? '#3d1d1d' : '#123a24';
  toastEl.style.borderColor = isError ? '#d64545' : '#2e9e5b';
  if (undoFn) {
    const btn = document.createElement('button');
    btn.textContent = 'Undo';
    btn.addEventListener('click', undoFn);
    toastEl.appendChild(btn);
  }
  toastEl.classList.remove('hidden');
  if (!undoFn) {
    toastTimer = setTimeout(hideToast, 2500);
  } else {
    toastTimer = setTimeout(hideToast, 6000);
  }
}

function hideToast() {
  toastEl.classList.add('hidden');
  clearTimeout(toastTimer);
}

// periodic light stats refresh (only when user is actively browsing, throttled)
let statsTickTimer = null;
function loadStatsTick() {
  clearTimeout(statsTickTimer);
  statsTickTimer = setTimeout(loadStats, 1500);
}