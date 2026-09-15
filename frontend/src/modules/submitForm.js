import { api } from '../api.js';

// Uploads an image via the future R2 presign flow.
// NOTE: The Worker presign endpoint (/api/uploads) is part of the R2 migration
// and is not wired up yet — until it lands, image uploads are deferred and the
// submit still succeeds with no image.
export async function uploadImage(file) {
  if (!file) return { imageUrl: null, imagePublicId: null };

  const MAX_SIZE_MB = 5;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`Image must be under ${MAX_SIZE_MB}MB`);
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('File must be an image');
  }

  // TODO(R2): call Worker /api/uploads to get a presigned PUT URL, upload the
  // file, and return the public URL. For now images are dropped.
  return { imageUrl: null, imagePublicId: null };
}

export function initSubmitForm() {
  const feedView = document.getElementById('feed-view');
  const submitView = document.getElementById('submit-view');
  const showBtn = document.getElementById('show-submit-btn');
  const backBtn = document.getElementById('submit-back-btn');
  const cancelBtn = document.getElementById('submit-cancel-btn');
  const form = document.getElementById('submit-form');

  const segmentButtons = document.querySelectorAll('#type-segmented .segment');
  const typeInput = document.getElementById('joke-type');
  const questionField = document.getElementById('joke-question');
  const answerField = document.getElementById('joke-answer');
  const questionCount = document.getElementById('question-count');
  const answerCount = document.getElementById('answer-count');
  const imageInput = document.getElementById('joke-image');
  const imagePreview = document.getElementById('joke-image-preview');
  const dropzoneText = document.querySelector('.dropzone-text');
  const dropzoneIcon = document.querySelector('.dropzone-icon');
  const statusEl = document.getElementById('submit-status');

  function openForm() {
    feedView.classList.add('hidden');
    submitView.classList.remove('hidden');
    questionField.focus();
  }

  function resetFormFields() {
    form.reset();
    typeInput.value = 'single';
    segmentButtons.forEach((b) => b.classList.toggle('active', b.dataset.type === 'single'));
    answerField.classList.add('hidden');
    answerCount.classList.add('hidden');
    imagePreview.classList.add('hidden');
    imagePreview.removeAttribute('src');
    dropzoneText.classList.remove('hidden');
    dropzoneIcon.classList.remove('hidden');
    statusEl.textContent = '';
    statusEl.className = '';
    questionCount.textContent = '0 / 500';
    answerCount.textContent = '0 / 500';
  }

  function closeForm() {
    resetFormFields();
    submitView.classList.add('hidden');
    feedView.classList.remove('hidden');
  }

  showBtn.addEventListener('click', openForm);
  backBtn.addEventListener('click', closeForm);
  cancelBtn.addEventListener('click', closeForm);

  segmentButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      segmentButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      typeInput.value = btn.dataset.type;
      const isQna = btn.dataset.type === 'qna';
      answerField.classList.toggle('hidden', !isQna);
      answerCount.classList.toggle('hidden', !isQna);
    });
  });

  questionField.addEventListener('input', () => {
    questionCount.textContent = `${questionField.value.length} / 500`;
  });

  answerField.addEventListener('input', () => {
    answerCount.textContent = `${answerField.value.length} / 500`;
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      imagePreview.classList.remove('hidden');
      dropzoneText.classList.add('hidden');
      dropzoneIcon.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('.btn-submit-chali');
    submitBtn.disabled = true;
    statusEl.className = '';
    statusEl.textContent = 'Submitting...';

    try {
      const type = typeInput.value;
      const question = questionField.value.trim();
      const answer = type === 'qna' ? answerField.value.trim() : null;
      const imageFile = imageInput.files[0];

      if (!question) throw new Error('Joke text is required');
      if (type === 'qna' && !answer) throw new Error('Answer is required for QnA jokes');

      const imageData = await uploadImage(imageFile);

      await api.submitJoke({
        type,
        question,
        answer,
        imageUrl: imageData.imageUrl,
        imagePublicId: imageData.imagePublicId,
      });

      statusEl.textContent = 'Thanks! Your joke is pending review. 🎉';
      statusEl.className = 'success';
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      statusEl.textContent = err.message || 'Submission failed. Try again.';
      statusEl.className = 'error';
      submitBtn.disabled = false;
    }
  });
}
