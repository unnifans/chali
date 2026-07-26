import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config.js';

const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export async function uploadImageToCloudinary(file) {
  if (!file) return { imageUrl: null, imagePublicId: null };

  const MAX_SIZE_MB = 5;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image must be under ${MAX_SIZE_MB}MB`);
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Image upload is not configured yet (missing Cloudinary env vars)');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', 'malayalam-joke-app');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) {
    throw new Error('Image upload failed');
  }

  const data = await res.json();
  return { imageUrl: data.secure_url, imagePublicId: data.public_id };
}

export function initSubmitForm() {
  const showBtn = document.getElementById('show-submit-btn');
  const cancelBtn = document.getElementById('submit-cancel-btn');
  const form = document.getElementById('submit-form');
  const typeSelect = document.getElementById('joke-type');
  const questionField = document.getElementById('joke-question');
  const answerField = document.getElementById('joke-answer');
  const answerCount = document.getElementById('answer-count');
  const questionCount = document.getElementById('question-count');
  const imageInput = document.getElementById('joke-image');
  const imagePreview = document.getElementById('joke-image-preview');
  const statusEl = document.getElementById('submit-status');

  function openForm() {
    form.classList.remove('hidden');
    showBtn.classList.add('hidden');
    questionField.focus();
  }

  function closeForm() {
    form.reset();
    form.classList.add('hidden');
    showBtn.classList.remove('hidden');
    answerField.classList.add('hidden');
    answerCount.classList.add('hidden');
    imagePreview.classList.add('hidden');
    imagePreview.removeAttribute('src');
    statusEl.textContent = '';
    statusEl.className = '';
    questionCount.textContent = '0 / 1000';
    answerCount.textContent = '0 / 1000';
  }

  showBtn.addEventListener('click', openForm);
  cancelBtn.addEventListener('click', closeForm);

  typeSelect.addEventListener('change', () => {
    const isQna = typeSelect.value === 'qna';
    answerField.classList.toggle('hidden', !isQna);
    answerCount.classList.toggle('hidden', !isQna);
  });

  questionField.addEventListener('input', () => {
    questionCount.textContent = `${questionField.value.length} / 1000`;
  });

  answerField.addEventListener('input', () => {
    answerCount.textContent = `${answerField.value.length} / 1000`;
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) {
      imagePreview.classList.add('hidden');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      imagePreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.className = '';
    statusEl.textContent = 'Submitting...';

    try {
      const type = typeSelect.value;
      const question = questionField.value.trim();
      const answer = type === 'qna' ? answerField.value.trim() : null;
      const imageFile = imageInput.files[0];

      if (!question) throw new Error('Joke text is required');
      if (type === 'qna' && !answer) throw new Error('Answer is required for QnA jokes');

      const imageData = await uploadImageToCloudinary(imageFile);

      await addDoc(collection(db, 'jokes'), {
        type,
        question,
        answer,
        imageUrl: imageData.imageUrl,
        imagePublicId: imageData.imagePublicId,
        upvotes: 5,
        downvotes: 0,
        status: 'quarantine', // held for admin approval
        submittedBy: 'anonymous',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        rand: Math.random(),
      });

      statusEl.textContent = 'Thanks! Your joke is pending review. 🎉';
      statusEl.className = 'success';
      setTimeout(closeForm, 2200);
    } catch (err) {
      statusEl.textContent = err.message || 'Submission failed. Try again.';
      statusEl.className = 'error';
      submitBtn.disabled = false;
    }
  });
}
