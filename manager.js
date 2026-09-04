const STORAGE_KEY = 'yt_video_bookmarks';
const PROFILE_KEY = 'yt_profile';
const SYNC_META_KEY = 'yt_sync_meta';
const SYNC_CHUNK_PREFIX = 'yt_sync_chunk_';
const UNCATEGORIZED = 'Uncategorized';
const NEW_CATEGORY = '__ytbm_new_category__';

const state = {
  bookmarks: [],
  profile: null,
  search: '',
  category: 'all',
  tag: 'all',
  importExportMessage: '',
  importExportTone: ''
};

const els = {
  bookmarkCount: document.getElementById('bookmarkCount'),
  importExportMessage: document.getElementById('importExportMessage'),
  importButton: document.getElementById('importButton'),
  exportButton: document.getElementById('exportButton'),
  deleteAllButton: document.getElementById('deleteAllButton'),
  importFileInput: document.getElementById('importFileInput'),
  searchInput: document.getElementById('searchInput'),
  categoryFilter: document.getElementById('categoryFilter'),
  tagFilter: document.getElementById('tagFilter'),
  clearFilters: document.getElementById('clearFilters'),
  categoryChips: document.getElementById('categoryChips'),
  tagChips: document.getElementById('tagChips'),
  emptyState: document.getElementById('emptyState'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyCopy: document.getElementById('emptyCopy'),
  list: document.getElementById('list'),
  editModal: document.getElementById('editModal'),
  editForm: document.getElementById('editForm'),
  modalTitle: document.getElementById('modalTitle'),
  bookmarkId: document.getElementById('bookmarkId'),
  titleInput: document.getElementById('titleInput'),
  categorySelect: document.getElementById('categorySelect'),
  newCategoryField: document.getElementById('newCategoryField'),
  newCategoryInput: document.getElementById('newCategoryInput'),
  notesInput: document.getElementById('notesInput'),
  tagsInput: document.getElementById('tagsInput'),
  closeModal: document.getElementById('closeModal'),
  cancelEdit: document.getElementById('cancelEdit'),
  deleteBookmark: document.getElementById('deleteBookmark')
};

async function loadProfile() {
  const data = await chrome.storage.local.get(PROFILE_KEY);
  const stored = data[PROFILE_KEY] || {};

  state.profile = {
    id: stored.id || crypto.randomUUID(),
    name: String(stored.name || '').trim() || 'Default profile',
    createdAt: stored.createdAt || new Date().toISOString()
  };

  if (!stored.id || !stored.name || !stored.createdAt) {
    await chrome.storage.local.set({ [PROFILE_KEY]: state.profile });
  }
}

async function readSyncBackup() {
  const meta = (await chrome.storage.sync.get(SYNC_META_KEY))[SYNC_META_KEY];
  const chunkCount = Number(meta?.chunks || 0);
  if (!chunkCount) return [];

  const keys = Array.from({ length: chunkCount }, (_, index) => `${SYNC_CHUNK_PREFIX}${index}`);
  const chunks = await chrome.storage.sync.get(keys);

  try {
    const serialized = keys.map((key) => chunks[key]).join('');
    const bookmarks = JSON.parse(serialized);
    return Array.isArray(bookmarks) ? bookmarks : [];
  } catch (error) {
    console.warn('YouTube Bookmark Manager: sync backup is unreadable', error);
    return [];
  }
}

async function load() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  state.bookmarks = normalizeBookmarks(data[STORAGE_KEY] || []);

  if (!state.bookmarks.length) {
    const backup = normalizeBookmarks(await readSyncBackup());
    if (backup.length) {
      state.bookmarks = backup;
      await chrome.storage.local.set({ [STORAGE_KEY]: backup });
      setImportExportMessage(`Restored ${backup.length} bookmark${backup.length === 1 ? '' : 's'} from backup.`, 'success');
    }
  }

  await loadProfile();
  render();
}

function normalizeBookmarks(bookmarks) {
  return (Array.isArray(bookmarks) ? bookmarks : []).map(normalizeBookmark);
}

function normalizeBookmark(item) {
  item = item || {};
  const videoId = item.videoId || '';
  const inferredHasTimestamp = hasTimestampInUrl(item.youtubeUrl) || Number(item.timestampSeconds) > 0;
  const hasTimestamp = Boolean(item.hasTimestamp ?? inferredHasTimestamp);
  const timestampSeconds = normalizeTimestampSeconds(
    hasTimestamp ? (item.timestampSeconds ?? getTimestampFromUrl(item.youtubeUrl)) : 0
  );

  return {
    ...item,
    id: item.id || (videoId ? `${videoId}-${hasTimestamp ? timestampSeconds : 'video'}` : crypto.randomUUID()),
    videoId,
    youtubeUrl: videoId ? buildYouTubeUrl(videoId, timestampSeconds, hasTimestamp) : (item.youtubeUrl || '#'),
    thumbnail: item.thumbnail || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : ''),
    title: item.title || 'Untitled video',
    channelName: item.channelName || '',
    channelUrl: item.channelUrl || '',
    category: normalizeCategory(item.category),
    tags: normalizeTags(item.tags),
    hasTimestamp,
    timestampSeconds,
    notes: String(item.notes || '').trim(),
    addedAt: item.addedAt || ''
  };
}

function normalizeCategory(category) {
  const value = String(category || '').trim();
  return value || UNCATEGORIZED;
}

function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const unique = new Set();

  source.forEach((tag) => {
    const value = String(tag || '').trim();
    if (value) unique.add(value);
  });

  return [...unique];
}

function normalizeTimestampSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.floor(seconds);
}

function parseTimestampParam(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return normalizeTimestampSeconds(raw);

  let seconds = 0;
  let matched = false;

  raw.replace(/(\d+)(h|m|s)/g, (_, amount, unit) => {
    matched = true;
    const number = Number(amount);
    if (unit === 'h') seconds += number * 3600;
    if (unit === 'm') seconds += number * 60;
    if (unit === 's') seconds += number;
    return '';
  });

  return matched ? seconds : 0;
}

function getTimestampFromUrl(url) {
  if (!url) return 0;

  try {
    const parsed = new URL(url);
    return parseTimestampParam(parsed.searchParams.get('t') || parsed.searchParams.get('start'));
  } catch {
    return 0;
  }
}

function hasTimestampInUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.searchParams.has('t') || parsed.searchParams.has('start');
  } catch {
    return false;
  }
}

function buildYouTubeUrl(videoId, timestampSeconds = 0, hasTimestamp = false) {
  if (!videoId) return '#';

  const url = new URL('https://www.youtube.com/watch');
  const seconds = normalizeTimestampSeconds(timestampSeconds);
  url.searchParams.set('v', videoId);

  if (hasTimestamp) {
    url.searchParams.set('t', `${seconds}s`);
  }

  return url.href;
}

function formatTimestamp(seconds) {
  const value = normalizeTimestampSeconds(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

async function saveBookmarks(bookmarks = state.bookmarks) {
  state.bookmarks = normalizeBookmarks(bookmarks);
  await chrome.storage.local.set({ [STORAGE_KEY]: state.bookmarks });
  render();
}

function setImportExportMessage(message, tone = '') {
  state.importExportMessage = message;
  state.importExportTone = tone;
  els.importExportMessage.textContent = message;
  els.importExportMessage.dataset.tone = tone;
}

function render() {
  const categories = getCounts((bookmark) => bookmark.category);
  const tags = getTagCounts();
  syncActiveFilters(categories, tags);
  const filtered = getFilteredBookmarks();

  els.importExportMessage.textContent = state.importExportMessage;
  els.importExportMessage.dataset.tone = state.importExportTone;
  renderCount(filtered.length);
  renderSelect(els.categoryFilter, categories, state.category, 'All categories');
  renderSelect(els.tagFilter, tags, state.tag, 'All tags');
  renderEditCategorySelect(categories);
  renderChips(els.categoryChips, categories, state.category, 'category');
  renderChips(els.tagChips, tags, state.tag, 'tag');
  renderBookmarks(filtered);
}

function syncActiveFilters(categories, tags) {
  if (state.category !== 'all' && !categories.some(([name]) => name === state.category)) {
    state.category = 'all';
  }

  if (state.tag !== 'all' && !tags.some(([name]) => name === state.tag)) {
    state.tag = 'all';
  }
}

function renderCount(visibleCount) {
  const total = state.bookmarks.length;
  const label = total === 1 ? 'bookmark' : 'bookmarks';
  els.bookmarkCount.textContent = `${visibleCount} of ${total} ${label}`;
}

function getCounts(getValue) {
  const counts = new Map();

  state.bookmarks.forEach((bookmark) => {
    const value = getValue(bookmark);
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function getTagCounts() {
  const counts = new Map();

  state.bookmarks.forEach((bookmark) => {
    bookmark.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });

  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function getFilteredBookmarks() {
  const search = state.search.toLowerCase();

  return state.bookmarks.filter((bookmark) => {
    const matchesSearch = !search || [
      bookmark.title,
      bookmark.channelName,
      bookmark.channelUrl,
      bookmark.category,
      bookmark.youtubeUrl,
      bookmark.notes,
      bookmark.hasTimestamp ? formatTimestamp(bookmark.timestampSeconds) : '',
      ...bookmark.tags
    ].join(' ').toLowerCase().includes(search);

    const matchesCategory = state.category === 'all' || bookmark.category === state.category;
    const matchesTag = state.tag === 'all' || bookmark.tags.includes(state.tag);

    return matchesSearch && matchesCategory && matchesTag;
  });
}

function renderSelect(select, items, activeValue, defaultLabel) {
  select.replaceChildren(createOption('all', defaultLabel));

  items.forEach(([name, count]) => {
    select.appendChild(createOption(name, `${name} (${count})`));
  });

  select.value = items.some(([name]) => name === activeValue) ? activeValue : 'all';
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function renderEditCategorySelect(categories, activeCategory = els.categorySelect.value) {
  const activeValue = activeCategory === NEW_CATEGORY ? NEW_CATEGORY : normalizeCategory(activeCategory);
  const categoryNames = new Set([UNCATEGORIZED]);

  categories.forEach(([category]) => {
    categoryNames.add(category);
  });

  if (activeValue !== NEW_CATEGORY) {
    categoryNames.add(activeValue);
  }

  els.categorySelect.replaceChildren();
  [...categoryNames].sort((a, b) => a.localeCompare(b)).forEach((category) => {
    els.categorySelect.appendChild(createOption(category, category));
  });
  els.categorySelect.appendChild(createOption(NEW_CATEGORY, 'Create new category'));
  els.categorySelect.value = activeValue;
  syncEditNewCategoryField();
}

function renderChips(container, items, activeValue, type) {
  container.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = type === 'tag' ? 'No tags yet' : 'No categories yet';
    container.appendChild(empty);
    return;
  }

  items.forEach(([name, count]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = name;
    chip.dataset.type = type;
    chip.setAttribute('aria-pressed', String(activeValue === name));

    const label = document.createElement('span');
    label.textContent = name;

    const badge = document.createElement('strong');
    badge.textContent = count;

    chip.append(label, badge);
    container.appendChild(chip);
  });
}

function renderBookmarks(bookmarks) {
  els.list.replaceChildren();
  els.emptyState.hidden = bookmarks.length > 0;

  if (!bookmarks.length) {
    const hasBookmarks = state.bookmarks.length > 0;
    els.emptyTitle.textContent = hasBookmarks ? 'No matching bookmarks' : 'No bookmarks found';
    els.emptyCopy.textContent = hasBookmarks
      ? 'Adjust the search, category, or tag filters to widen the list.'
      : 'Save videos or timestamped moments from YouTube, then use categories, tags, and notes to organize them here.';
  }

  bookmarks.forEach((bookmark) => {
    els.list.appendChild(createBookmarkCard(bookmark));
  });
}

function createBookmarkCard(bookmark) {
  const article = document.createElement('article');
  article.className = 'bookmark-card';

  const imageWrap = document.createElement('a');
  imageWrap.className = 'thumbnail-link';
  imageWrap.href = bookmark.youtubeUrl;
  imageWrap.target = '_blank';
  imageWrap.rel = 'noreferrer';
  imageWrap.setAttribute('aria-label', `Open ${bookmark.title}`);

  const image = document.createElement('img');
  image.src = bookmark.thumbnail;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    if (bookmark.videoId) {
      image.src = `https://img.youtube.com/vi/${bookmark.videoId}/hqdefault.jpg`;
    }
  }, { once: true });
  imageWrap.appendChild(image);

  const body = document.createElement('div');
  body.className = 'bookmark-body';

  const category = document.createElement('button');
  category.type = 'button';
  category.className = 'category-pill';
  category.textContent = bookmark.category;
  category.addEventListener('click', () => {
    state.category = bookmark.category;
    els.categoryFilter.value = bookmark.category;
    render();
  });

  const title = document.createElement('h2');
  title.textContent = bookmark.title;

  const channel = createChannelLink(bookmark);

  const details = document.createElement('div');
  details.className = 'bookmark-details';

  if (bookmark.hasTimestamp) {
    const timestampLabel = formatTimestamp(bookmark.timestampSeconds);
    const timestamp = document.createElement('a');
    timestamp.className = 'timestamp-link';
    timestamp.href = bookmark.youtubeUrl;
    timestamp.target = '_blank';
    timestamp.rel = 'noreferrer';
    timestamp.textContent = timestampLabel;
    timestamp.setAttribute('aria-label', `Open ${bookmark.title} at ${timestampLabel}`);
    details.appendChild(timestamp);
  }

  const meta = document.createElement('p');
  meta.className = 'bookmark-meta';
  meta.textContent = bookmark.addedAt ? `Saved ${formatDate(bookmark.addedAt)}` : 'Saved bookmark';
  details.appendChild(meta);

  const notes = document.createElement('p');
  notes.className = 'bookmark-notes';
  notes.textContent = bookmark.notes;
  notes.hidden = !bookmark.notes;

  const tags = document.createElement('div');
  tags.className = 'tag-row';
  renderBookmarkTags(tags, bookmark.tags);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const open = document.createElement('a');
  open.href = bookmark.youtubeUrl;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.className = 'primary-button';
  open.textContent = bookmark.hasTimestamp ? `Open ${formatTimestamp(bookmark.timestampSeconds)}` : 'Open';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary-button';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => openEditModal(bookmark.id));

  actions.append(open, edit);
  body.append(category, title);
  if (channel) body.appendChild(channel);
  body.append(details, notes, tags, actions);
  article.append(imageWrap, body);

  return article;
}

function createChannelLink(bookmark) {
  if (!bookmark.channelName || !bookmark.channelUrl) return null;

  const channel = document.createElement('a');
  channel.className = 'channel-link';
  channel.href = bookmark.channelUrl;
  channel.target = '_blank';
  channel.rel = 'noreferrer';
  channel.textContent = bookmark.channelName;
  channel.setAttribute('aria-label', `Open ${bookmark.channelName} channel`);
  return channel;
}

function renderBookmarkTags(container, tags) {
  container.replaceChildren();

  if (!tags.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'No tags';
    container.appendChild(empty);
    return;
  }

  tags.forEach((tag) => {
    const tagButton = document.createElement('button');
    tagButton.type = 'button';
    tagButton.className = 'tag-pill';
    tagButton.textContent = tag;
    tagButton.addEventListener('click', () => {
      state.tag = tag;
      els.tagFilter.value = tag;
      render();
    });
    container.appendChild(tagButton);
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown date';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function createExportPayload() {
  return {
    app: 'yt-bookmark-manager',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    bookmarks: state.bookmarks
  };
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function getImportBookmarks(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.bookmarks)) return payload.bookmarks;
  throw new Error('The file must contain a bookmark array or a bookmarks field.');
}

function getBookmarkIdentityKey(bookmark) {
  if (bookmark.videoId) {
    return `${bookmark.videoId}|${bookmark.hasTimestamp ? bookmark.timestampSeconds : 'video'}`;
  }

  return `id:${bookmark.id}`;
}

function getBookmarkTime(bookmark, field) {
  const time = new Date(bookmark[field] || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function mergeBookmarkPair(current, incoming) {
  const currentUpdated = Math.max(getBookmarkTime(current, 'updatedAt'), getBookmarkTime(current, 'addedAt'));
  const incomingUpdated = Math.max(getBookmarkTime(incoming, 'updatedAt'), getBookmarkTime(incoming, 'addedAt'));
  const newer = incomingUpdated > currentUpdated ? incoming : current;
  const older = newer === incoming ? current : incoming;

  let addedAt = current.addedAt;
  if (!addedAt || (incoming.addedAt && getBookmarkTime(incoming, 'addedAt') < getBookmarkTime(current, 'addedAt'))) {
    addedAt = incoming.addedAt;
  }

  return {
    ...newer,
    id: current.id,
    tags: normalizeTags([...current.tags, ...incoming.tags]),
    notes: newer.notes || older.notes,
    addedAt,
    updatedAt: newer.updatedAt || older.updatedAt || ''
  };
}

function mergeBookmarks(existing, imported) {
  const merged = new Map();

  existing.forEach((bookmark) => {
    merged.set(getBookmarkIdentityKey(bookmark), bookmark);
  });

  imported.forEach((bookmark) => {
    const key = getBookmarkIdentityKey(bookmark);
    const current = merged.get(key);
    merged.set(key, current ? mergeBookmarkPair(current, bookmark) : bookmark);
  });

  return [...merged.values()].sort((a, b) => {
    const left = new Date(a.addedAt || 0).getTime();
    const right = new Date(b.addedAt || 0).getTime();
    return right - left;
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsText(file);
  });
}

function buildExportFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `yt-bookmarks-${date}.json`;
}

function handleExport() {
  const payload = createExportPayload();
  downloadTextFile(
    buildExportFilename(),
    JSON.stringify(payload, null, 2),
    'application/json'
  );

  setImportExportMessage(`Exported ${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}.`, 'success');
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  els.importFileInput.value = '';

  if (!file) return;

  try {
    const content = await readFileAsText(file);
    const payload = JSON.parse(content);
    const importedBookmarks = normalizeBookmarks(getImportBookmarks(payload));
    const beforeCount = state.bookmarks.length;
    const mergedBookmarks = mergeBookmarks(state.bookmarks, importedBookmarks);
    const addedCount = Math.max(mergedBookmarks.length - beforeCount, 0);
    const sourceProfile = payload && payload.profile;
    const foreignProfile = sourceProfile && sourceProfile.id !== state.profile.id ? sourceProfile : null;

    await saveBookmarks(mergedBookmarks);
    setImportExportMessage(
      `Imported ${importedBookmarks.length} bookmark${importedBookmarks.length === 1 ? '' : 's'}`
      + `${addedCount !== importedBookmarks.length ? `, added ${addedCount} new` : ''}`
      + `${foreignProfile?.name ? ` from ${foreignProfile.name}` : ''}.`,
      'success'
    );
  } catch (error) {
    setImportExportMessage(error instanceof Error ? error.message : 'Import failed.', 'error');
  }
}

let deleteAllArmTimeoutId = null;

function resetDeleteAllButton() {
  els.deleteAllButton.textContent = 'Delete all';
  els.deleteAllButton.dataset.armed = 'false';
}

async function deleteAllBookmarks() {
  const count = state.bookmarks.length;
  await saveBookmarks([]);
  resetDeleteAllButton();
  setImportExportMessage(`Deleted ${count} bookmark${count === 1 ? '' : 's'}. Import a file to bring them back.`, 'success');
}

function handleDeleteAll() {
  if (!state.bookmarks.length) {
    setImportExportMessage('Nothing to delete.', '');
    return;
  }

  if (els.deleteAllButton.dataset.armed === 'true') {
    window.clearTimeout(deleteAllArmTimeoutId);
    deleteAllBookmarks().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to delete bookmarks', error);
      setImportExportMessage('Could not delete bookmarks.', 'error');
    });
    return;
  }

  els.deleteAllButton.dataset.armed = 'true';
  els.deleteAllButton.textContent = 'Click again to confirm';
  setImportExportMessage(`Export first if you want a copy. About to delete ${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}.`, 'error');

  deleteAllArmTimeoutId = window.setTimeout(resetDeleteAllButton, 4000);
}

function openEditModal(id) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;

  els.bookmarkId.value = bookmark.id;
  els.titleInput.value = bookmark.title;
  renderEditCategorySelect(getCounts((item) => item.category), bookmark.category);
  els.newCategoryInput.value = '';
  els.notesInput.value = bookmark.notes;
  els.tagsInput.value = bookmark.tags.join(', ');
  els.modalTitle.textContent = bookmark.title;

  if (typeof els.editModal.showModal === 'function') {
    els.editModal.showModal();
  } else {
    els.editModal.setAttribute('open', '');
  }
}

function closeEditModal() {
  els.editForm.reset();
  syncEditNewCategoryField();

  if (typeof els.editModal.close === 'function') {
    els.editModal.close();
  } else {
    els.editModal.removeAttribute('open');
  }
}

async function handleEditSubmit(event) {
  event.preventDefault();

  const id = els.bookmarkId.value;
  const category = getSelectedEditCategory();
  const bookmarks = state.bookmarks.map((bookmark) => {
    if (bookmark.id !== id) return bookmark;

    return {
      ...bookmark,
      title: els.titleInput.value.trim() || bookmark.title,
      category,
      notes: els.notesInput.value.trim(),
      tags: normalizeTags(els.tagsInput.value)
    };
  });

  closeEditModal();
  await saveBookmarks(bookmarks);
}

async function deleteCurrentBookmark() {
  const id = els.bookmarkId.value;
  if (!id) return;

  const bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== id);
  closeEditModal();
  await saveBookmarks(bookmarks);
}

function handleChipClick(event) {
  const chip = event.target.closest('.chip');
  if (!chip) return;

  const value = chip.dataset.value;
  const type = chip.dataset.type;

  if (type === 'category') {
    state.category = state.category === value ? 'all' : value;
    els.categoryFilter.value = state.category;
  }

  if (type === 'tag') {
    state.tag = state.tag === value ? 'all' : value;
    els.tagFilter.value = state.tag;
  }

  render();
}

function syncEditNewCategoryField() {
  const isNewCategory = els.categorySelect.value === NEW_CATEGORY;
  els.newCategoryField.hidden = !isNewCategory;
  els.newCategoryInput.required = isNewCategory;

  if (!isNewCategory) {
    els.newCategoryInput.value = '';
  }
}

function getSelectedEditCategory() {
  if (els.categorySelect.value === NEW_CATEGORY) {
    return normalizeCategory(els.newCategoryInput.value);
  }

  return normalizeCategory(els.categorySelect.value);
}

function bindEvents() {
  els.importButton.addEventListener('click', () => {
    els.importFileInput.click();
  });

  els.exportButton.addEventListener('click', handleExport);
  els.deleteAllButton.addEventListener('click', handleDeleteAll);
  els.importFileInput.addEventListener('change', handleImportFile);

  els.searchInput.addEventListener('input', (event) => {
    state.search = event.target.value.trim();
    render();
  });

  els.categoryFilter.addEventListener('change', (event) => {
    state.category = event.target.value;
    render();
  });

  els.tagFilter.addEventListener('change', (event) => {
    state.tag = event.target.value;
    render();
  });

  els.clearFilters.addEventListener('click', () => {
    state.search = '';
    state.category = 'all';
    state.tag = 'all';
    els.searchInput.value = '';
    render();
  });

  els.categoryChips.addEventListener('click', handleChipClick);
  els.tagChips.addEventListener('click', handleChipClick);
  els.categorySelect.addEventListener('change', () => {
    syncEditNewCategoryField();
    if (els.categorySelect.value === NEW_CATEGORY) {
      els.newCategoryInput.focus();
    }
  });
  els.editForm.addEventListener('submit', handleEditSubmit);
  els.closeModal.addEventListener('click', closeEditModal);
  els.cancelEdit.addEventListener('click', closeEditModal);
  els.deleteBookmark.addEventListener('click', deleteCurrentBookmark);

  els.editModal.addEventListener('click', (event) => {
    if (event.target === els.editModal) closeEditModal();
  });
}

bindEvents();
load();
