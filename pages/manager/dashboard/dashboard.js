import { db } from '../../../shared/js/firebase-config.js';
import { requireAuth, signOut } from '../../../shared/js/firebase-auth.js';
import { collection, getDocs, deleteDoc, doc, query, orderBy, where, addDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { auth } from '../../../shared/js/firebase-auth.js';
import {
  seedIfEmpty, getCategories, createCategory, updateCategory, deleteCategory,
  countItemsUsingCategory,
} from '../../../shared/js/categories.js';
import { getHomeSettings, setHomeCover } from '../../../shared/js/settings.js';
import { uploadMedia } from '../../../shared/js/cloudinary.js';

const labels = { images: 'AI Images', videos: 'AI Videos', blogs: 'Blog Posts', systems: 'Systems' };

const statEls = {
  images:  document.getElementById('statImages'),
  videos:  document.getElementById('statVideos'),
  blogs:   document.getElementById('statBlogs'),
  systems: document.getElementById('statSystems'),
};

const contentPanel  = document.getElementById('contentPanel');
const panelTitle    = document.getElementById('panelTitle');
const panelCount    = document.getElementById('panelCount');
const panelGrid     = document.getElementById('panelGrid');
const panelEmpty    = document.getElementById('panelEmpty');
const panelClose    = document.getElementById('panelClose');
const delModal      = document.getElementById('delModal');
const delBackdrop   = document.getElementById('delBackdrop');
const delCancel     = document.getElementById('delCancel');
const delConfirm    = document.getElementById('delConfirm');

const detailModal   = document.getElementById('detailModal');
const detailBackdrop= document.getElementById('detailBackdrop');
const detailClose   = document.getElementById('detailClose');
const detailMedia   = document.getElementById('detailMedia');
const detailTag     = document.getElementById('detailTag');
const detailTitle   = document.getElementById('detailTitle');
const detailDesc    = document.getElementById('detailDesc');
const detailExtra   = document.getElementById('detailExtra');

let data = { images: [], videos: [], blogs: [], systems: [] };
let activeType = null;
let pendingDelete = null;
let tagLabelMap = { images: new Map(), videos: new Map(), blogs: new Map(), systems: new Map() };

async function refreshTagLabelMaps() {
  await Promise.all(['images','videos','blogs','systems'].map(async t => {
    const cats = await getCategories(t, { forceRefresh: true });
    tagLabelMap[t] = new Map(cats.map(c => [c.slug, (localStorage.getItem('lang') === 'ar' ? c.label_ar : c.label_en) || c.slug]));
  }));
}

function extractYouTubeId(url) {
  const m = (url || '').match(/(?:v=|youtu\.be\/)([^&\n?#]+)/);
  return m ? m[1] : null;
}

const FALLBACK_VIDEO_THUMB = '/assets/images/placeholders/video_thumnail.jpg';

function cloudinaryFirstFrame(url) {
  if (!url || !url.includes('cloudinary.com') || !url.includes('/video/upload/')) return null;
  return url.replace(/\.(mp4|mov|webm|m4v|avi|mkv|3gp|ogv|wmv|flv)(\?.*)?$/i, '.jpg');
}

function pickVideoThumb(item) {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  const url = item.videoUrl || '';
  const ytId = extractYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  const cloudFrame = cloudinaryFirstFrame(url);
  if (cloudFrame) return cloudFrame;
  return FALLBACK_VIDEO_THUMB;
}

function updateStats() {
  Object.keys(statEls).forEach(type => {
    statEls[type].textContent = data[type].length;
  });
}

function getImg(type, item) {
  if (type === 'images') return item.imageUrl || '';
  if (type === 'videos') return pickVideoThumb(item);
  if (type === 'blogs' && item.coverMediaType === 'video' && item.coverUrl) {
    return cloudinaryFirstFrame(item.coverUrl) || item.coverUrl;
  }
  return item.coverUrl || '';
}

function buildCard(type, item) {
  const img = getImg(type, item);
  const trashBtn = `<button class="panel-item__trash" data-id="${item.id}" aria-label="Delete ${item.title}">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
  </button>`;

  const tagLabel = tagLabelMap[type]?.get(item.tag) || item.tag || '';

  if (type === 'blogs') {
    return `<div class="panel-item" style="cursor:pointer;">
      <img class="panel-item__img panel-item__img--wide" src="${img}" alt="${item.title}" loading="lazy" />
      <div class="panel-item__body">
        <span class="panel-item__tag">${tagLabel}</span>
        <p class="panel-item__title">${item.title}</p>
        <p class="panel-item__meta">${item.summary || ''}</p>
      </div>
      ${trashBtn}
    </div>`;
  }

  let ratio;
  if (type === 'images') {
    ratio = (item.orientation === 'landscape') ? ' panel-item__img--land' : '';
  } else if (type === 'videos') {
    ratio = (item.orientation === 'portrait') ? ' panel-item__img--portrait' : ' panel-item__img--wide';
  } else {
    ratio = ' panel-item__img--wide';
  }

  return `<div class="panel-item" style="cursor:pointer;">
    <img class="panel-item__img${ratio}" src="${img}" alt="${item.title}" loading="lazy" />
    <div class="panel-item__body">
      <span class="panel-item__tag">${tagLabel}</span>
      <p class="panel-item__title">${item.title}</p>
    </div>
    ${trashBtn}
  </div>`;
}

function openDetailModal(type, item) {
  detailMedia.innerHTML = '';
  if (type === 'videos') {
    const ytId = extractYouTubeId(item.videoUrl);
    if (ytId) {
      detailMedia.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}" allow="autoplay;encrypted-media;fullscreen" allowfullscreen></iframe>`;
    } else if (item.videoUrl) {
      detailMedia.innerHTML = `<video src="${item.videoUrl}" controls controlsList="nodownload" oncontextmenu="return false"></video>`;
    }
  } else if (type === 'blogs' && item.coverMediaType === 'video' && item.coverUrl) {
    detailMedia.innerHTML = `<video src="${item.coverUrl}" controls controlsList="nodownload" oncontextmenu="return false"></video>`;
  } else {
    const imgUrl = getImg(type, item);
    if (imgUrl) detailMedia.innerHTML = `<img src="${imgUrl}" alt="${item.title}" />`;
  }

  const tagLabel = tagLabelMap[type]?.get(item.tag) || item.tag || '';
  detailTag.textContent   = tagLabel;
  detailTitle.textContent = item.title;
  detailDesc.textContent  = type === 'blogs' ? (item.summary || '') : (item.description || '');

  detailExtra.innerHTML = '';
  if (type === 'blogs' && item.content) {
    const paragraphs = item.content.split(/\n\n+/).filter(Boolean);
    paragraphs.forEach(pText => {
      const pEl = document.createElement('p');
      pText.split('\n').forEach((line, idx, arr) => {
        pEl.appendChild(document.createTextNode(line));
        if (idx < arr.length - 1) pEl.appendChild(document.createElement('br'));
      });
      detailExtra.appendChild(pEl);
    });
  }
  if (type === 'systems') {
    if (item.techTags?.length) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'detail-modal__tech-tags';
      tagsDiv.innerHTML = item.techTags.map(t => `<span>${t}</span>`).join('');
      detailExtra.appendChild(tagsDiv);
    }
    if (item.websiteUrl) {
      const link = document.createElement('a');
      link.href = item.websiteUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'detail-modal__link';
      link.textContent = 'View Project →';
      detailExtra.appendChild(link);
    }
  }

  detailModal.classList.add('open');
  detailModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDetailModal() {
  detailModal.classList.remove('open');
  detailModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  detailMedia.innerHTML = '';
}

detailClose.addEventListener('click', closeDetailModal);
detailBackdrop.addEventListener('click', closeDetailModal);

function renderPanel(type) {
  const items = data[type];
  panelTitle.textContent = labels[type];
  panelCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;
  panelGrid.className = `content-panel__grid content-panel__grid--${type}`;

  if (items.length === 0) {
    panelGrid.innerHTML = '';
    panelEmpty.hidden = false;
    return;
  }
  panelEmpty.hidden = true;
  panelGrid.innerHTML = items.map(item => buildCard(type, item)).join('');

  panelGrid.querySelectorAll('.panel-item__trash').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      pendingDelete = { type, id: btn.dataset.id };
      delModal.hidden = false;
    });
  });

  panelGrid.querySelectorAll('.panel-item').forEach((el, i) => {
    el.addEventListener('click', e => {
      if (e.target.closest('.panel-item__trash')) return;
      openDetailModal(type, items[i]);
    });
  });
}

function openPanel(type) {
  activeType = type;
  document.querySelectorAll('.stat-card').forEach(c => c.classList.toggle('active', c.dataset.type === type));
  contentPanel.hidden = false;
  renderPanel(type);
  contentPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePanel() {
  activeType = null;
  contentPanel.hidden = true;
  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
}

document.querySelectorAll('.stat-card').forEach(card => {
  card.addEventListener('click', () => {
    const type = card.dataset.type;
    if (activeType === type) { closePanel(); } else { openPanel(type); }
  });
});

panelClose.addEventListener('click', closePanel);

const delMsgEl = delModal.querySelector('.del-modal__msg');
const DEFAULT_DEL_MSG = delMsgEl?.textContent || 'Delete this item? This cannot be undone.';

delConfirm.addEventListener('click', async () => {
  if (!pendingDelete) return;
  delConfirm.disabled = true;
  try {
    if (pendingDelete.kind === 'category') {
      await deleteCategory(pendingDelete.id);
      pendingDelete = null;
      delModal.hidden = true;
      if (delMsgEl) delMsgEl.textContent = DEFAULT_DEL_MSG;
      await refreshTagLabelMaps();
      await renderCategoryList();
      if (activeType) renderPanel(activeType);
    } else if (pendingDelete.kind === 'aiPending') {
      const { id } = pendingDelete;
      await deleteDoc(doc(db, 'blogs', id));
      aiPending = aiPending.filter(item => item.id !== id);
      pendingDelete = null;
      delModal.hidden = true;
      renderAiBlogs();
    } else {
      const { type, id } = pendingDelete;
      await deleteDoc(doc(db, type, id));
      data[type] = data[type].filter(item => item.id !== id);
      pendingDelete = null;
      delModal.hidden = true;
      updateStats();
      renderPanel(type);
    }
  } catch (err) {
    console.error('Delete failed', err);
  } finally {
    delConfirm.disabled = false;
  }
});

function resetDelModal() {
  delModal.hidden = true;
  pendingDelete = null;
  if (delMsgEl) delMsgEl.textContent = DEFAULT_DEL_MSG;
}
delCancel.addEventListener('click', resetDelModal);
delBackdrop.addEventListener('click', resetDelModal);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (detailModal.classList.contains('open')) { closeDetailModal(); return; }
    resetDelModal();
  }
});

async function loadAll() {
  await seedIfEmpty();
  await refreshTagLabelMaps();
  const types = ['images', 'videos', 'blogs', 'systems'];
  await Promise.all(types.map(async type => {
    const q = query(collection(db, type), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Pending AI drafts live in the AI Blogs section, not the main Blog Posts panel.
    if (type === 'blogs') items = items.filter(item => item.status !== 'pending');
    data[type] = items;
  }));
  updateStats();
  if (activeType) renderPanel(activeType);
  await initCategoriesSection();
  await initCoverPhotosSection();
  await initAiBlogsSection();
}

/* ---------- CATEGORIES SECTION ---------- */

const catTabs       = document.getElementById('catTabs');
const catList       = document.getElementById('catList');
const catAddForm    = document.getElementById('catAddForm');
const catAddSlug    = document.getElementById('catAddSlug');
const catAddEn      = document.getElementById('catAddEn');
const catAddAr      = document.getElementById('catAddAr');
const catError      = document.getElementById('catError');

let activeCatType = 'images';
let editingId = null;

function showCatError(msg) {
  if (!catError) return;
  catError.textContent = msg;
  catError.hidden = false;
}

function clearCatError() {
  if (!catError) return;
  catError.hidden = true;
  catError.textContent = '';
}

async function renderCategoryList() {
  const cats = await getCategories(activeCatType, { forceRefresh: true });
  if (!catList) return;
  if (cats.length === 0) {
    catList.innerHTML = '<div class="cat-empty">No categories yet. Add one below.</div>';
    return;
  }
  catList.innerHTML = cats.map(c => {
    const editing = editingId === c.id;
    if (editing) {
      return `<div class="category-row" data-id="${c.id}">
        <span class="cat-row__slug">${escapeHtml(c.slug)}</span>
        <input class="cat-row__input" data-field="en" value="${escapeAttr(c.label_en || '')}" />
        <input class="cat-row__input cat-row__label--ar" data-field="ar" dir="rtl" value="${escapeAttr(c.label_ar || '')}" />
        <div class="cat-row__actions">
          <button class="cat-row__btn cat-row__btn--save" data-action="save" aria-label="Save">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="cat-row__btn" data-action="cancel" aria-label="Cancel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>`;
    }
    return `<div class="category-row" data-id="${c.id}">
      <span class="cat-row__slug">${escapeHtml(c.slug)}</span>
      <span class="cat-row__label">${escapeHtml(c.label_en || '')}</span>
      <span class="cat-row__label cat-row__label--ar">${escapeHtml(c.label_ar || '')}</span>
      <div class="cat-row__actions">
        <button class="cat-row__btn" data-action="edit" aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="cat-row__btn cat-row__btn--danger" data-action="delete" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  catList.querySelectorAll('.category-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleRowAction(btn.dataset.action, id, row));
    });
  });
}

async function handleRowAction(action, id, row) {
  clearCatError();
  if (action === 'edit') {
    editingId = id;
    await renderCategoryList();
  } else if (action === 'cancel') {
    editingId = null;
    await renderCategoryList();
  } else if (action === 'save') {
    const en = row.querySelector('[data-field="en"]').value.trim();
    const ar = row.querySelector('[data-field="ar"]').value.trim();
    if (!en || !ar) { showCatError('Both labels are required.'); return; }
    try {
      await updateCategory(id, { label_en: en, label_ar: ar });
      editingId = null;
      await refreshTagLabelMaps();
      await renderCategoryList();
      if (activeType) renderPanel(activeType);
    } catch (err) {
      showCatError(err.message || 'Update failed.');
    }
  } else if (action === 'delete') {
    const cats = await getCategories(activeCatType);
    const cat = cats.find(c => c.id === id);
    if (!cat) return;
    const count = await countItemsUsingCategory(activeCatType, cat.slug);
    pendingDelete = { kind: 'category', id, type: activeCatType, slug: cat.slug };
    if (delMsgEl) {
      delMsgEl.textContent = count > 0
        ? `${count} item${count !== 1 ? 's' : ''} use this category. Deleting will leave them with an unrecognized tag. Proceed?`
        : DEFAULT_DEL_MSG;
    }
    delModal.hidden = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

async function initCategoriesSection() {
  if (!catTabs) return;
  catTabs.querySelectorAll('.cat-tabs__btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      activeCatType = btn.dataset.catType;
      editingId = null;
      catTabs.querySelectorAll('.cat-tabs__btn').forEach(b => b.classList.remove('cat-tabs__btn--active'));
      btn.classList.add('cat-tabs__btn--active');
      clearCatError();
      await renderCategoryList();
    });
  });
  if (catAddForm) {
    catAddForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearCatError();
      const slug = catAddSlug.value.trim();
      const en = catAddEn.value.trim();
      const ar = catAddAr.value.trim();
      try {
        await createCategory(activeCatType, { slug, label_en: en, label_ar: ar });
        catAddSlug.value = '';
        catAddEn.value = '';
        catAddAr.value = '';
        await refreshTagLabelMaps();
        await renderCategoryList();
      } catch (err) {
        showCatError(err.message || 'Failed to create category.');
      }
    });
  }
  await renderCategoryList();
}

/* ---------- COVER PHOTOS SECTION ---------- */

const COVER_PLACEHOLDERS = {
  cover_image:   '/assets/images/placeholders/image_thumnail.jpg',
  cover_video:   '/assets/images/placeholders/video_thumnail.jpg',
  cover_systems: '/assets/images/placeholders/system_thumnail.jpg',
};
const COVER_FIELDS = ['cover_image', 'cover_video', 'cover_systems'];
const coverToast = document.getElementById('coverToast');
let coverToastTimer = null;

function showCoverToast(msg, type) {
  if (!coverToast) return;
  coverToast.textContent = msg;
  coverToast.className = `cover-toast cover-toast--${type}`;
  coverToast.hidden = false;
  clearTimeout(coverToastTimer);
  coverToastTimer = setTimeout(() => { coverToast.hidden = true; }, 3000);
}

async function initCoverPhotosSection() {
  const settings = await getHomeSettings({ forceRefresh: true });
  COVER_FIELDS.forEach(field => {
    const key = field.replace('cover_', '');
    const previewEl = document.getElementById(`coverPreview_${key}`);
    const inputEl = document.getElementById(`coverInput_${key}`);
    const btnEl = document.querySelector(`.cover-card__btn[data-target="${field}"]`);
    if (!previewEl || !inputEl || !btnEl) return;

    previewEl.src = settings[field] || COVER_PLACEHOLDERS[field];

    btnEl.addEventListener('click', () => inputEl.click());
    inputEl.addEventListener('change', async () => {
      const file = inputEl.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        showCoverToast('Image exceeds 10 MB.', 'error');
        inputEl.value = '';
        return;
      }
      const prevSrc = previewEl.src;
      const previewUrl = URL.createObjectURL(file);
      previewEl.src = previewUrl;
      const origLabel = btnEl.innerHTML;
      btnEl.disabled = true;
      btnEl.textContent = 'Uploading…';
      try {
        const url = await uploadMedia(file, 'image');
        await setHomeCover(field, url);
        previewEl.src = url;
        showCoverToast('Saved!', 'success');
      } catch (err) {
        console.error('Cover upload failed', err);
        previewEl.src = prevSrc;
        showCoverToast('Upload failed. Try again.', 'error');
      } finally {
        btnEl.disabled = false;
        btnEl.innerHTML = origLabel;
        inputEl.value = '';
      }
    });
  });
}

/* ---------- AI BLOGS SECTION ---------- */

const aiBlogsGrid    = document.getElementById('aiBlogsGrid');
const aiBlogsEmpty   = document.getElementById('aiBlogsEmpty');
const aiBlogsStatus  = document.getElementById('aiBlogsStatus');
const aiGenerateNow  = document.getElementById('aiGenerateNow');
const aiBlogsRefresh = document.getElementById('aiBlogsRefresh');

let aiPending = [];

function showAiStatus(msg, type = 'info') {
  if (!aiBlogsStatus) return;
  aiBlogsStatus.textContent = msg;
  aiBlogsStatus.className = `ai-blogs__status ai-blogs__status--${type}`;
  aiBlogsStatus.hidden = false;
  if (type === 'success' || type === 'error') {
    setTimeout(() => { aiBlogsStatus.hidden = true; }, 5000);
  }
}

async function loadAiPending() {
  const q = query(collection(db, 'blogs'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  aiPending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function buildAiCard(item) {
  const tagLabel = tagLabelMap.blogs?.get(item.tag) || item.tag || '';
  const model = item.aiMeta?.model || 'AI';
  const headlines = (item.aiMeta?.sourceHeadlines || []).slice(0, 3);
  const sourceChips = headlines.length
    ? `<div class="ai-card__sources">${headlines.map(h => `<span class="ai-card__chip">${escapeHtml(h)}</span>`).join('')}</div>`
    : '';
  return `<div class="ai-card" data-id="${item.id}">
    <div class="ai-card__body">
      <div class="ai-card__meta">
        <span class="ai-card__tag">${escapeHtml(tagLabel)}</span>
        <span class="ai-card__model">${escapeHtml(model)}</span>
      </div>
      <p class="ai-card__title">${escapeHtml(item.title || '')}</p>
      <p class="ai-card__summary">${escapeHtml(item.summary || '')}</p>
      ${sourceChips}
    </div>
    <div class="ai-card__actions">
      <button class="btn btn--primary ai-card__btn" data-action="approve" data-id="${item.id}">Approve</button>
      <button class="btn btn--ghost ai-card__btn" data-action="regenerate" data-id="${item.id}">Regenerate</button>
      <button class="btn btn--danger ai-card__btn" data-action="reject" data-id="${item.id}">Reject</button>
    </div>
  </div>`;
}

function renderAiBlogs() {
  if (!aiBlogsGrid) return;
  if (aiPending.length === 0) {
    aiBlogsGrid.innerHTML = '';
    if (aiBlogsEmpty) aiBlogsEmpty.hidden = false;
    return;
  }
  if (aiBlogsEmpty) aiBlogsEmpty.hidden = true;
  aiBlogsGrid.innerHTML = aiPending.map(buildAiCard).join('');

  // Open full preview when the card body is clicked.
  aiBlogsGrid.querySelectorAll('.ai-card__body').forEach((el, i) => {
    el.addEventListener('click', () => openDetailModal('blogs', aiPending[i]));
  });

  aiBlogsGrid.querySelectorAll('.ai-card__btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleAiAction(btn.dataset.action, btn.dataset.id);
    });
  });
}

async function approveAiPost(id) {
  await updateDoc(doc(db, 'blogs', id), { status: 'published', createdAt: serverTimestamp() });
  const approved = aiPending.find(p => p.id === id);
  aiPending = aiPending.filter(p => p.id !== id);
  // Reflect it in the published Blog Posts panel/stat immediately.
  if (approved) {
    data.blogs.unshift({ ...approved, status: 'published' });
    updateStats();
    if (activeType === 'blogs') renderPanel('blogs');
  }
  renderAiBlogs();
  showAiStatus('Post approved and published.', 'success');
}

async function enqueueGeneration(action, docId) {
  const user = auth.currentUser;
  await addDoc(collection(db, 'generationRequests'), {
    action,
    docId: docId || null,
    requestedBy: user?.email || 'unknown',
    processed: false,
    createdAt: serverTimestamp(),
  });
}

async function handleAiAction(action, id) {
  if (action === 'approve') {
    try {
      await approveAiPost(id);
    } catch (err) {
      console.error('Approve failed', err);
      showAiStatus('Could not publish the post.', 'error');
    }
  } else if (action === 'reject') {
    // Reuse the shared confirm-delete modal.
    pendingDelete = { kind: 'aiPending', id };
    if (delMsgEl) delMsgEl.textContent = 'Reject and delete this AI draft? This cannot be undone.';
    delModal.hidden = false;
  } else if (action === 'regenerate') {
    try {
      await enqueueGeneration('regenerate', id);
      // Optimistically drop the old draft from view; the poller deletes it server-side.
      aiPending = aiPending.filter(p => p.id !== id);
      renderAiBlogs();
      showAiStatus('Regeneration requested — a new draft appears in ~1-5 min. Use Refresh.', 'info');
    } catch (err) {
      console.error('Regenerate failed', err);
      showAiStatus('Could not request regeneration.', 'error');
    }
  }
}

async function initAiBlogsSection() {
  if (!aiBlogsGrid) return;
  try {
    await loadAiPending();
    renderAiBlogs();
  } catch (err) {
    console.error('Failed to load AI drafts', err);
    showAiStatus('Could not load AI drafts (a Firestore index may still be building).', 'error');
  }

  if (aiGenerateNow) {
    aiGenerateNow.addEventListener('click', async () => {
      aiGenerateNow.disabled = true;
      const orig = aiGenerateNow.innerHTML;
      aiGenerateNow.textContent = 'Requesting…';
      try {
        await enqueueGeneration('generate');
        showAiStatus('Generation started — a new draft appears in ~1-5 min. Use Refresh.', 'info');
      } catch (err) {
        console.error('Generate request failed', err);
        showAiStatus('Could not start generation.', 'error');
      } finally {
        aiGenerateNow.disabled = false;
        aiGenerateNow.innerHTML = orig;
      }
    });
  }

  if (aiBlogsRefresh) {
    aiBlogsRefresh.addEventListener('click', async () => {
      aiBlogsRefresh.disabled = true;
      try {
        await loadAiPending();
        renderAiBlogs();
        showAiStatus(`${aiPending.length} draft${aiPending.length !== 1 ? 's' : ''} awaiting review.`, 'info');
      } catch (err) {
        console.error('Refresh failed', err);
        showAiStatus('Refresh failed.', 'error');
      } finally {
        aiBlogsRefresh.disabled = false;
      }
    });
  }
}

document.getElementById('signOutBtn').addEventListener('click', signOut);
requireAuth(() => loadAll());
