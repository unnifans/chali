import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'firebase/auth';
import {
  collection, query, where, orderBy, getDocs, doc, updateDoc, addDoc,
  serverTimestamp, getCountFromServer
} from 'firebase/firestore';
import { app, db } from '../firebase-config.js';
import { uploadImageToCloudinary } from '../modules/submitForm.js';

const auth = getAuth(app);

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');

let currentTab = 'quarantine'; // 'quarantine' | 'active' | 'deleted' | 'all'
let editingJokeId = null; // null = create mode, otherwise editing this doc id

// ---------- Auth ----------

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    loadStats();
    loadJokeList();
  } else {
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = 'Invalid credentials';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

// ---------- Tabs ----------

document.querySelectorAll('#status-tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.status;
    document.querySelectorAll('#status-tabs .tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('list-title').textContent =
      currentTab === 'all' ? 'All Jokes' : `${capitalize(currentTab)} Jokes`;
    loadJokeList();
  });
});

// ---------- Stats ----------

async function loadStats() {
  const jokesRef = collection(db, 'jokes');
  const [total, active, quarantine, deleted] = await Promise.all([
    getCountFromServer(query(jokesRef)),
    getCountFromServer(query(jokesRef, where('status', '==', 'active'))),
    getCountFromServer(query(jokesRef, where('status', '==', 'quarantine'))),
    getCountFromServer(query(jokesRef, where('status', '==', 'deleted'))),
  ]);
  document.getElementById('stat-total').textContent = total.data().count;
  document.getElementById('stat-active').textContent = active.data().count;
  document.getElementById('stat-quarantine').textContent = quarantine.data().count;
  document.getElementById('stat-deleted').textContent = deleted.data().count;
}

// ---------- List ----------

async function loadJokeList() {
  const container = document.getElementById('queue-root');
  container.innerHTML = '<p>Loading...</p>';

  const jokesRef = collection(db, 'jokes');
  const q = currentTab === 'all'
    ? query(jokesRef, orderBy('timestamp', 'desc'))
    : query(jokesRef, where('status', '==', currentTab), orderBy('timestamp', 'desc'));

  try {
    const snap = await getDocs(q);
    renderList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p>Couldn't load jokes: ${escapeHtml(err.message)}</p>`;
  }
}

function renderList(jokes) {
  const container = document.getElementById('queue-root');
  if (jokes.length === 0) {
    container.innerHTML = '<p>Nothing here.</p>';
    return;
  }

  container.innerHTML = jokes.map((joke) => `
    <div class="queue-item admin-card" data-id="${joke.id}">
      <div class="queue-item-body">
        <p><strong>${joke.type}</strong>: ${escapeHtml(joke.question)}
          <span class="status-pill ${joke.status}">${joke.status}</span>
        </p>
        ${joke.answer ? `<p class="muted">A: ${escapeHtml(joke.answer)}</p>` : ''}
        <p class="muted">Score: ${joke.upvotes - joke.downvotes} (↑${joke.upvotes} ↓${joke.downvotes})</p>
        ${joke.imageUrl ? `<img class="queue-item-thumb" src="${joke.imageUrl}" alt="" />` : ''}
        <div class="queue-actions">
          ${joke.status === 'quarantine' ? `<button class="btn-approve" data-id="${joke.id}">Approve</button>` : ''}
          ${joke.status !== 'deleted' ? `<button class="btn-delete" data-id="${joke.id}">Delete</button>` : ''}
          ${joke.status === 'deleted' ? `<button class="btn-restore" data-id="${joke.id}">Restore</button>` : ''}
          <button class="btn-edit" data-id="${joke.id}">Edit</button>
        </div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-approve').forEach((btn) =>
    btn.addEventListener('click', () => setStatus(btn.dataset.id, 'active')));
  container.querySelectorAll('.btn-delete').forEach((btn) =>
    btn.addEventListener('click', () => setStatus(btn.dataset.id, 'deleted')));
  container.querySelectorAll('.btn-restore').forEach((btn) =>
    btn.addEventListener('click', () => setStatus(btn.dataset.id, 'active')));
  container.querySelectorAll('.btn-edit').forEach((btn) =>
    btn.addEventListener('click', () => openEditForm(jokes.find((j) => j.id === btn.dataset.id))));
}

async function setStatus(jokeId, status) {
  await updateDoc(doc(db, 'jokes', jokeId), { status });
  loadJokeList();
  loadStats();
}

// ---------- Create / Edit form ----------

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

document.getElementById('new-joke-btn').addEventListener('click', () => {
  openCreateForm();
});

document.getElementById('joke-form-cancel').addEventListener('click', () => {
  closeForm();
});

formType.addEventListener('change', () => {
  const isQna = formType.value === 'qna';
  formAnswer.classList.toggle('hidden', !isQna);
  formAnswerLabel.classList.toggle('hidden', !isQna);
});

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
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
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
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth' });
}

function closeForm() {
  form.classList.add('hidden');
  editingJokeId = null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  formMsg.textContent = 'Saving...';

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
      const uploaded = await uploadImageToCloudinary(imageFile);
      imagePatch = { imageUrl: uploaded.imageUrl, imagePublicId: uploaded.imagePublicId };
    }

    if (editingJokeId) {
      await updateDoc(doc(db, 'jokes', editingJokeId), {
        type, question, answer, status, ...imagePatch,
      });
      formMsg.textContent = 'Saved.';
    } else {
      await addDoc(collection(db, 'jokes'), {
        type,
        question,
        answer,
        imageUrl: imagePatch.imageUrl || null,
        imagePublicId: imagePatch.imagePublicId || null,
        upvotes: 5,
        downvotes: 0,
        status,
        submittedBy: 'admin',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      formMsg.textContent = 'Created.';
    }

    loadJokeList();
    loadStats();
    setTimeout(closeForm, 500);
  } catch (err) {
    formMsg.textContent = err.message || 'Save failed.';
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Helpers ----------

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
