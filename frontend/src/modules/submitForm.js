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
  const backBtn = document.getElementById('back-btn');
  const cancelBtn = document.getElementById('submit-cancel-btn');
  const jokeCard = document.getElementById('joke-card');
  const submitPanel = document.getElementById('submit-panel');

  const form = document.getElementById('submit-form');
  const typeHidden = document.getElementById('joke-type');
  const typeOptions = form.querySelectorAll('.type-option');
  const questionField = document.getElementById('joke-question');
  const answerField = document.getElementById('joke-answer');
  const answerCount = document.getElementById('answer-count');
  const questionCount = document.getElementById('question-count');

  const imageInput = document.getElementById('joke-image');
  const uploadZone = document.getElementById('upload-zone');
  const uploadPlaceholder = document.getElementById('upload-placeholder');
  const imagePreview = document.getElementById('joke-image-preview');
  const removeImageBtn = document.getElementById('remove-image');
  const statusEl = document.getElementById('submit-status');

  function openForm() {
    jokeCard.classList.add('hidden');
    submitPanel.classList.remove('hidden');
    questionField.focus();
  }

  function closeForm() {
    submitPanel.classList.add('hidden');
    jokeCard.classList.remove('hidden');
    resetForm();
  }

  function resetForm() {
    form.reset();
    typeHidden.value = 'single';
    typeOptions.forEach(btn => btn.classList.toggle('active', btn.dataset.value === 'single'));
    answerField.classList.add('hidden');
    answerCount.classList.add('hidden');
    imagePreview.classList.add('hidden');
    imagePreview.removeAttribute('src');
    uploadPlaceholder.classList.remove('hidden');
    removeImageBtn.classList.add('hidden');
    statusEl.textContent = '';
    statusEl.className = '';
    questionCount.textContent = '0 / 300';
    answerCount.textContent = '0 / 300';
  }

  showBtn.addEventListener('click', openForm);
  backBtn.addEventListener('click', closeForm);
  cancelBtn.addEventListener('click', closeForm);

  // Type toggle
  typeOptions.forEach(btn => {
    btn.addEventListener('click', () => {
      typeOptions.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      typeHidden.value = btn.dataset.value;
      const isQna = btn.dataset.value === 'qna';
      answerField.classList.toggle('hidden', !isQna);
      answerCount.classList.toggle('hidden', !isQna);
    });
  });

  questionField.addEventListener('input', () => {
    questionCount.textContent = `${questionField.value.length} / 300`;
  });

  answerField.addEventListener('input', () => {
    answerCount.textContent = `${answerField.value.length} / 300`;
  });

  // Upload zone
  uploadZone.addEventListener('click', (e) => {
    if (e.target !== removeImageBtn && !removeImageBtn.contains(e.target)) {
      imageInput.click();
    }
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      imagePreview.classList.remove('hidden');
      uploadPlaceholder.classList.add('hidden');
      removeImageBtn.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  });

  removeImageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    imageInput.value = '';
    imagePreview.classList.add('hidden');
    imagePreview.removeAttribute('src');
    uploadPlaceholder.classList.remove('hidden');
    removeImageBtn.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('.btn-submit');
    submitBtn.disabled = true;
    statusEl.className = '';
    statusEl.textContent = 'Submitting...';

    try {
      const type = typeHidden.value;
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
        status: 'quarantine',
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