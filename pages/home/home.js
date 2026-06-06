import { db } from '../../shared/js/firebase-config.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getCategories, renderFilterButtons, labelOf, getLang } from '../../shared/js/categories.js';
import { getHomeSettings, getCachedHomeSettings } from '../../shared/js/settings.js';

function setCover(id, url) {
  const el = document.getElementById(id);
  if (!el) return;
  // Fall back to the placeholder only when no cover is configured.
  const next = url || el.dataset.fallback;
  if (!next) return;
  if (el.src.endsWith(next) || el.src === next) {
    if (el.complete) el.classList.add('is-loaded');
    return;
  }
  el.addEventListener('load', () => el.classList.add('is-loaded'), { once: true });
  el.src = next;
}

function applyServiceCovers(s) {
  s = s || {};
  setCover('serviceCoverImage', s.cover_image);
  setCover('serviceCoverVideo', s.cover_video);
  setCover('serviceCoverSystems', s.cover_systems);
}

// Apply the last-known covers from cache (the inline script in index.html may
// already have done this on first paint), then refresh from Firestore.
applyServiceCovers(getCachedHomeSettings());
getHomeSettings().then(applyServiceCovers);

const track   = document.getElementById('insightsTrack');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const insightsFilters = document.getElementById('insightsFilters');

const blogModal        = document.getElementById('blogModal');
const blogModalClose   = document.getElementById('blogModalClose');
const blogModalBdrop   = document.getElementById('blogModalBackdrop');
const blogModalCover   = document.getElementById('blogModalCover');
const blogModalTag     = document.getElementById('blogModalTag');
const blogModalTitle   = document.getElementById('blogModalTitle');
const blogModalSummary = document.getElementById('blogModalSummary');
const blogModalContent = document.getElementById('blogModalContent');

let currentIndex = 0;
let allInsights = [];
let insightItems = [];
let activeFilter = 'all';
let tagToLabel = new Map();

function tagLabel(slug) {
  return tagToLabel.get(slug) || slug || '';
}

function cloudinaryFirstFrame(url) {
  if (!url || !url.includes('cloudinary.com') || !url.includes('/video/upload/')) return null;
  return url.replace(/\.(mp4|mov|webm|m4v|avi|mkv|3gp|ogv|wmv|flv)(\?.*)?$/i, '.jpg');
}

function getVisibleCount() {
  return window.innerWidth <= 600 ? 1 : 2;
}

function getCardWidth() {
  const card = track.querySelector('.insight-card');
  if (!card) return 0;
  return card.offsetWidth + 24;
}

function getMaxIndex() {
  return Math.max(0, track.querySelectorAll('.insight-card').length - getVisibleCount());
}

function updateTrack() {
  track.style.transform = `translateX(-${currentIndex * getCardWidth()}px)`;
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex >= getMaxIndex();
  prevBtn.style.opacity = prevBtn.disabled ? '0.4' : '1';
  nextBtn.style.opacity = nextBtn.disabled ? '0.4' : '1';
}

prevBtn.addEventListener('click', () => { if (currentIndex > 0) { currentIndex--; updateTrack(); } });
nextBtn.addEventListener('click', () => { if (currentIndex < getMaxIndex()) { currentIndex++; updateTrack(); } });
window.addEventListener('resize', () => { currentIndex = Math.min(currentIndex, getMaxIndex()); updateTrack(); });

// Pick a blog field in the current language, falling back to English when the
// Arabic version is missing (e.g. older posts created before bilingual support).
function field(item, name) {
  return (getLang() === 'ar' && item[name + '_ar']) ? item[name + '_ar'] : item[name];
}

function openBlogModal(item) {
  blogModalCover.innerHTML = '';
  if (item.coverMediaType === 'video' && item.coverUrl) {
    blogModalCover.style.backgroundImage = '';
    blogModalCover.innerHTML = `<video src="${item.coverUrl}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover;border-radius:18px 18px 0 0;display:block;"></video>`;
  } else {
    blogModalCover.style.backgroundImage = item.coverUrl ? `url('${item.coverUrl}')` : '';
  }
  blogModalTag.textContent     = tagLabel(item.tag);
  blogModalTitle.textContent   = field(item, 'title');
  blogModalSummary.textContent = field(item, 'summary') || '';
  blogModalContent.innerHTML   = '';
  const paragraphs = (field(item, 'content') || '').split(/\n\n+/).filter(Boolean);
  paragraphs.forEach(pText => {
    const pEl = document.createElement('p');
    const lines = pText.split('\n');
    lines.forEach((line, idx) => {
      pEl.appendChild(document.createTextNode(line));
      if (idx < lines.length - 1) pEl.appendChild(document.createElement('br'));
    });
    blogModalContent.appendChild(pEl);
  });
  blogModal.classList.add('open');
  blogModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeBlogModal() {
  blogModal.classList.remove('open');
  blogModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  blogModalCover.innerHTML = '';
  blogModalCover.style.backgroundImage = '';
}

blogModalClose.addEventListener('click', closeBlogModal);
blogModalBdrop.addEventListener('click', closeBlogModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBlogModal(); });

function buildInsightCard(item) {
  let thumbUrl = item.coverUrl || '';
  if (item.coverMediaType === 'video' && thumbUrl) {
    thumbUrl = cloudinaryFirstFrame(thumbUrl) || thumbUrl;
  }
  const bgStyle = thumbUrl
    ? `style="background-image:url('${thumbUrl}');background-size:cover;background-position:center;"`
    : '';
  return `<article class="insight-card" style="cursor:pointer;">
    <div class="insight-card__image" ${bgStyle}></div>
    <div class="insight-card__body">
      <span class="insight-card__tag">${tagLabel(item.tag)}</span>
      <h3 class="insight-card__title">${field(item, 'title')}</h3>
      <p class="insight-card__text">${field(item, 'summary') || ''}</p>
    </div>
  </article>`;
}

function renderTrack() {
  insightItems = activeFilter === 'all' ? allInsights : allInsights.filter(i => i.tag === activeFilter);
  track.innerHTML = insightItems.map(buildInsightCard).join('');
  track.querySelectorAll('.insight-card').forEach((el, i) => {
    el.addEventListener('click', () => openBlogModal(insightItems[i]));
  });
  currentIndex = 0;
  updateTrack();
}

function applyInsightFilter(slug) {
  activeFilter = slug;
  renderTrack();
}

async function refreshTagToLabel() {
  const cats = await getCategories('blogs');
  tagToLabel = new Map(cats.map(c => [c.slug, labelOf(c)]));
}

document.addEventListener('langchange', async () => {
  await refreshTagToLabel();
  renderTrack();
});

async function loadInsights() {
  await refreshTagToLabel();
  if (insightsFilters) {
    await renderFilterButtons(insightsFilters, 'blogs', { onChange: applyInsightFilter, allKey: 'blogs.filter.all' });
  }
  // Only published posts. Firestore rejects a list query that could return docs
  // the rules forbid (pending drafts), so we must filter in the query itself — a
  // client-side filter would fail the whole query for logged-out visitors.
  // Requires every post to have status:'published' (legacy posts are backfilled).
  const snap = await getDocs(query(
    collection(db, 'blogs'),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(24),
  ));
  if (!snap.empty) {
    allInsights = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTrack();
  } else {
    updateTrack();
  }
}

loadInsights();
