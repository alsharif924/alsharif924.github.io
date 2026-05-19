import { db } from '../../../shared/js/firebase-config.js';
import { requireAuth, signOut } from '../../../shared/js/firebase-auth.js';
import { uploadMedia } from '../../../shared/js/cloudinary.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { seedIfEmpty, renderTagSelector } from '../../../shared/js/categories.js';

const coverInput        = document.getElementById('coverInput');
const coverUpload       = document.getElementById('coverUpload');
const coverPreview      = document.getElementById('coverPreview');
const coverVideoPreview = document.getElementById('coverVideoPreview');
const coverRemove       = document.getElementById('coverRemove');
const coverPlaceholder  = document.getElementById('coverPlaceholder');
const coverMediaType    = document.getElementById('coverMediaType');

const titleInput          = document.getElementById('postTitle');
const titleCount          = document.getElementById('titleCount');
const summaryInput        = document.getElementById('postSummary');
const summaryCount        = document.getElementById('summaryCount');
const contentInput        = document.getElementById('postContent');
const contentCount        = document.getElementById('contentCount');
const tagSelector         = document.getElementById('tagSelector');
const selectedTag         = document.getElementById('selectedTag');
const orientationSelector = document.getElementById('orientationSelector');
const selectedOrientation = document.getElementById('selectedOrientation');
const clearBtn            = document.getElementById('clearBtn');
const blogForm            = document.getElementById('blogForm');
const formToast           = document.getElementById('formToast');

const DEFAULT_ORIENTATION = 'landscape';

// ── Orientation selector ──────────────────────────────────────────────────────
function setOrientation(value) {
  selectedOrientation.value = value;
  orientationSelector.querySelectorAll('.tag-btn').forEach(btn => {
    btn.classList.toggle('tag-btn--selected', btn.dataset.orientation === value);
  });
}
orientationSelector.querySelectorAll('.tag-btn').forEach(btn => {
  btn.addEventListener('click', () => setOrientation(btn.dataset.orientation));
});
setOrientation(DEFAULT_ORIENTATION);

// ── Cover media upload ────────────────────────────────────────────────────────
coverUpload.addEventListener('click', (e) => {
  if (e.target === coverRemove || coverRemove.contains(e.target)) return;
  coverInput.click();
});

coverInput.addEventListener('change', () => {
  const file = coverInput.files[0];
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) {
    showToast('File exceeds 50 MB limit.', 'error');
    coverInput.value = '';
    return;
  }
  const isVideo = file.type.startsWith('video/');
  coverMediaType.value = isVideo ? 'video' : 'image';
  const url = URL.createObjectURL(file);
  if (isVideo) {
    coverVideoPreview.src = url;
    coverVideoPreview.classList.add('visible');
    coverPreview.classList.remove('visible');
    coverPreview.src = '';
  } else {
    coverPreview.src = url;
    coverPreview.classList.add('visible');
    coverVideoPreview.classList.remove('visible');
    coverVideoPreview.src = '';
  }
  coverPlaceholder.style.display = 'none';
  coverRemove.hidden = false;
});

coverRemove.addEventListener('click', (e) => {
  e.stopPropagation();
  resetCover();
});

function resetCover() {
  coverInput.value = '';
  coverPreview.src = '';
  coverPreview.classList.remove('visible');
  coverVideoPreview.src = '';
  coverVideoPreview.classList.remove('visible');
  coverPlaceholder.style.display = '';
  coverRemove.hidden = true;
  coverMediaType.value = 'image';
}

// ── Character counters ────────────────────────────────────────────────────────
titleInput.addEventListener('input', () => {
  titleCount.textContent = `${titleInput.value.length} / 120`;
});
summaryInput.addEventListener('input', () => {
  summaryCount.textContent = `${summaryInput.value.length} / 200`;
});
contentInput.addEventListener('input', () => {
  contentCount.textContent = `${contentInput.value.length} characters`;
});

// ── Tag selection ─────────────────────────────────────────────────────────────
seedIfEmpty().then(() => renderTagSelector(tagSelector, 'blogs', selectedTag));

// ── Clear form ────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  blogForm.reset();
  titleCount.textContent = '0 / 120';
  summaryCount.textContent = '0 / 200';
  contentCount.textContent = '0 characters';
  selectedTag.value = '';
  tagSelector.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('tag-btn--selected'));
  setOrientation(DEFAULT_ORIENTATION);
  resetCover();
  hideToast();
  [titleInput].forEach(el => el.classList.remove('invalid'));
  tagSelector.classList.remove('invalid');
});

// ── Submit ────────────────────────────────────────────────────────────────────
blogForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate()) return;

  const submitBtn = blogForm.querySelector('[type="submit"]');
  const origHTML  = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publishing…';

  try {
    let coverUrl = '';
    if (coverInput.files[0]) {
      const resourceType = coverMediaType.value === 'video' ? 'video' : 'image';
      coverUrl = await uploadMedia(coverInput.files[0], resourceType);
    }

    await addDoc(collection(db, 'blogs'), {
      title:          titleInput.value.trim(),
      tag:            selectedTag.value,
      orientation:    selectedOrientation.value || DEFAULT_ORIENTATION,
      summary:        summaryInput.value.trim(),
      content:        contentInput.value.trim(),
      coverUrl,
      coverMediaType: coverUrl ? coverMediaType.value : 'image',
      createdAt:      serverTimestamp(),
    });
    showToast('Post published successfully!', 'success');
    clearBtn.click();
  } catch (err) {
    console.error(err);
    showToast('Upload failed. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = origHTML;
  }
});

function validate() {
  let valid = true;

  if (!titleInput.value.trim()) {
    titleInput.classList.add('invalid');
    valid = false;
  } else {
    titleInput.classList.remove('invalid');
  }

  if (!selectedTag.value) {
    tagSelector.classList.add('invalid');
    valid = false;
  } else {
    tagSelector.classList.remove('invalid');
  }

  if (!valid) showToast('Please fill in all required fields.', 'error');
  return valid;
}

function showToast(msg, type) {
  formToast.textContent = msg;
  formToast.className = `form-toast form-toast--${type}`;
  formToast.hidden = false;
  if (type === 'success') setTimeout(hideToast, 4000);
}

function hideToast() {
  formToast.hidden = true;
  formToast.textContent = '';
}

document.getElementById('signOutBtn').addEventListener('click', signOut);
requireAuth();
