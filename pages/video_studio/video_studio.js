import { db } from '../../shared/js/firebase-config.js';
import { collection, getDocs, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getCategories, renderFilterButtons, labelOf } from '../../shared/js/categories.js';

const videoGrid     = document.getElementById('videoGrid');
const filtersEl     = document.querySelector('.video-filters');
const modal         = document.getElementById('videoModal');
const modalTitle    = document.getElementById('modalTitle');
const modalTag      = document.getElementById('modalTag');
const modalDesc     = document.getElementById('modalDesc');
const modalPlayer   = document.getElementById('modalPlayer');
const modalClose    = document.getElementById('modalClose');
const modalBackdrop = document.getElementById('modalBackdrop');

let activeFilter = 'all';
let items = [];
let tagToLabel = new Map();

function tagLabel(slug) {
  return tagToLabel.get(slug) || slug || '';
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

function pickThumb(item) {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  const url = item.videoUrl || '';
  const ytId = extractYouTubeId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  const cloudFrame = cloudinaryFirstFrame(url);
  if (cloudFrame) return cloudFrame;
  return FALLBACK_VIDEO_THUMB;
}

function buildCard(item) {
  const orient = item.orientation === 'portrait' ? 'portrait' : 'landscape';
  return `<div class="video-card video-card--${orient}" data-category="${item.tag}" style="cursor:pointer;">
    <div class="video-card__thumb">
      <img src="${pickThumb(item)}" alt="${item.title}" loading="lazy" />
      <button class="video-card__play-btn" tabindex="-1" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
    </div>
    <div class="video-card__info">
      <span class="video-card__tag">${tagLabel(item.tag)}</span>
      <h3 class="video-card__title">${item.title}</h3>
      <p class="video-card__meta">${item.description || ''}</p>
    </div>
  </div>`;
}

function applyFilter(filter) {
  activeFilter = filter;
  videoGrid.querySelectorAll('.video-card').forEach(el => {
    el.classList.toggle('hidden', filter !== 'all' && el.dataset.category !== filter);
  });
}

async function refreshTagToLabel() {
  const cats = await getCategories('videos');
  tagToLabel = new Map(cats.map(c => [c.slug, labelOf(c)]));
}

function openModal(item) {
  modalTitle.textContent = item.title;
  modalTag.textContent   = tagLabel(item.tag);
  modalDesc.textContent  = item.description || '';
  const orient = item.orientation === 'portrait' ? 'portrait' : 'landscape';
  modalPlayer.className = `modal__player modal__player--${orient}`;
  const videoUrl = item.videoUrl || '';
  if (videoUrl) {
    const ytId = extractYouTubeId(videoUrl);
    if (ytId) {
      modalPlayer.innerHTML = `<iframe
        src="https://www.youtube.com/embed/${ytId}?autoplay=1"
        allow="autoplay; encrypted-media; fullscreen"
        allowfullscreen
      ></iframe>`;
    } else {
      modalPlayer.innerHTML = `<video src="${videoUrl}" controls autoplay controlsList="nodownload" oncontextmenu="return false"></video>`;
    }
  } else {
    modalPlayer.innerHTML = `<p class="modal__player-label">No video source available.</p>`;
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  modalPlayer.innerHTML = '';
}

function bindCards() {
  videoGrid.querySelectorAll('.video-card').forEach((el, i) => {
    el.addEventListener('click', () => openModal(items[i]));
  });
}

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.addEventListener('langchange', async () => {
  await refreshTagToLabel();
  if (items.length) {
    videoGrid.innerHTML = items.map(buildCard).join('');
    applyFilter(activeFilter);
    bindCards();
  }
});

async function loadVideos() {
  await refreshTagToLabel();
  await renderFilterButtons(filtersEl, 'videos', { onChange: applyFilter, allKey: 'video.filter.all' });
  const snap = await getDocs(query(collection(db, 'videos'), orderBy('createdAt', 'desc')));
  if (snap.empty) {
    videoGrid.innerHTML = '<p class="gallery-empty">No videos yet.</p>';
    return;
  }
  items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  videoGrid.innerHTML = items.map(buildCard).join('');
  applyFilter(activeFilter);
  bindCards();
}

loadVideos();
