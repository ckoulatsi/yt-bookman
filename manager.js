const STORAGE_KEY = 'yt_video_bookmarks';
const PROFILE_KEY = 'yt_profile';
const SYNC_META_KEY = 'yt_sync_meta';
const SYNC_CHUNK_PREFIX = 'yt_sync_chunk_';
const GIST_TOKEN_KEY = 'yt_gist_token';
const GIST_ID_KEY = 'yt_gist_id';
const GIST_USER_KEY = 'yt_gist_user';
const GIST_FILENAME = 'yt-bookmarks.json';
const GIST_DESCRIPTION = 'YouTube Bookmark Manager sync data';
const TOMBSTONE_KEY = 'yt_tombstones';
const SYNC_BASE_KEY = 'yt_sync_base';
const DEVICE_KEY = 'yt_device';
const MERGE_LOG_KEY = 'yt_last_merge_log';
const AUTO_SYNC_KEY = 'yt_auto_sync';
const AUTO_LOG_KEY = 'yt_auto_log';
const SYNC_PAYLOAD_VERSION = 2;
const UNCATEGORIZED = 'Uncategorized';
const NEW_CATEGORY = '__ytbm_new_category__';

const state = {
  bookmarks: [],
  profile: null,
  device: null,
  search: '',
  category: 'all',
  tag: 'all',
  importExportMessage: '',
  importExportTone: '',
  sync: {
    status: 'idle',
    message: '',
    detail: '',
    lastSyncedAt: ''
  },
  syncing: false,
  pendingMerge: null,
  lastLog: null,
  prefs: {
    autoSync: true,
    autoLog: true
  }
};

const els = {
  bookmarkCount: document.getElementById('bookmarkCount'),
  importExportMessage: document.getElementById('importExportMessage'),
  importButton: document.getElementById('importButton'),
  exportButton: document.getElementById('exportButton'),
  syncButton: document.getElementById('syncButton'),
  syncPanel: document.getElementById('syncPanel'),
  syncDot: document.getElementById('syncDot'),
  syncPanelStatus: document.getElementById('syncPanelStatus'),
  syncPanelDetail: document.getElementById('syncPanelDetail'),
  autoSyncToggle: document.getElementById('autoSyncToggle'),
  mergeLogButton: document.getElementById('mergeLogButton'),
  syncSettingsButton: document.getElementById('syncSettingsButton'),
  syncModal: document.getElementById('syncModal'),
  closeSyncModal: document.getElementById('closeSyncModal'),
  syncConnectSection: document.getElementById('syncConnectSection'),
  syncConnectedSection: document.getElementById('syncConnectedSection'),
  syncTokenInput: document.getElementById('syncTokenInput'),
  syncConnectButton: document.getElementById('syncConnectButton'),
  syncStatus: document.getElementById('syncStatus'),
  syncDisconnectButton: document.getElementById('syncDisconnectButton'),
  syncSettingsNowButton: document.getElementById('syncSettingsNowButton'),
  deviceNameInput: document.getElementById('deviceNameInput'),
  autoLogToggle: document.getElementById('autoLogToggle'),
  syncMessage: document.getElementById('syncMessage'),
  conflictModal: document.getElementById('conflictModal'),
  closeConflictModal: document.getElementById('closeConflictModal'),
  conflictTitle: document.getElementById('conflictTitle'),
  conflictMessage: document.getElementById('conflictMessage'),
  conflictList: document.getElementById('conflictList'),
  conflictUseMine: document.getElementById('conflictUseMine'),
  conflictUseTheirs: document.getElementById('conflictUseTheirs'),
  cancelConflict: document.getElementById('cancelConflict'),
  applyConflict: document.getElementById('applyConflict'),
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

async function loadDevice() {
  const data = await chrome.storage.local.get(DEVICE_KEY);
  const stored = data[DEVICE_KEY] || {};

  state.device = {
    id: stored.id || crypto.randomUUID(),
    name: String(stored.name || '').trim() || 'This device'
  };

  if (!stored.id || !stored.name) {
    await chrome.storage.local.set({ [DEVICE_KEY]: state.device });
  }
}

async function saveDeviceName(name) {
  const value = String(name || '').trim() || 'This device';
  state.device = { ...state.device, name: value };
  await chrome.storage.local.set({ [DEVICE_KEY]: state.device });
  renderSyncPanel().catch(() => {});
}

async function getSyncPrefs() {
  const data = await chrome.storage.local.get([AUTO_SYNC_KEY, AUTO_LOG_KEY]);
  return {
    autoSync: data[AUTO_SYNC_KEY] !== false,
    autoLog: data[AUTO_LOG_KEY] !== false
  };
}

async function saveSyncPrefs(partial) {
  state.prefs = { ...state.prefs, ...partial };
  const update = {};

  if ('autoSync' in partial) update[AUTO_SYNC_KEY] = Boolean(partial.autoSync);
  if ('autoLog' in partial) update[AUTO_LOG_KEY] = Boolean(partial.autoLog);

  await chrome.storage.local.set(update);
}

async function readTombstones() {
  const data = await chrome.storage.local.get(TOMBSTONE_KEY);
  return data[TOMBSTONE_KEY] && typeof data[TOMBSTONE_KEY] === 'object' ? data[TOMBSTONE_KEY] : {};
}

async function saveTombstones(tombstones) {
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: tombstones || {} });
}

async function readSyncBase() {
  const data = await chrome.storage.local.get(SYNC_BASE_KEY);
  const base = data[SYNC_BASE_KEY];

  if (!base || typeof base !== 'object') return null;

  return {
    syncedAt: base.syncedAt || '',
    checkedAt: base.checkedAt || '',
    revision: base.revision || '',
    fingerprint: base.fingerprint || '',
    remoteDevice: base.remoteDevice || '',
    bookmarks: base.bookmarks && typeof base.bookmarks === 'object' ? base.bookmarks : {},
    tombstones: base.tombstones && typeof base.tombstones === 'object' ? base.tombstones : {}
  };
}

async function writeSyncBase(value) {
  await chrome.storage.local.set({ [SYNC_BASE_KEY]: value });
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
  const data = await chrome.storage.local.get([STORAGE_KEY, MERGE_LOG_KEY]);
  state.bookmarks = normalizeBookmarks(data[STORAGE_KEY] || []);
  state.lastLog = data[MERGE_LOG_KEY] || null;

  if (!state.bookmarks.length) {
    const backup = normalizeBookmarks(await readSyncBackup());
    if (backup.length) {
      state.bookmarks = backup;
      await chrome.storage.local.set({ [STORAGE_KEY]: backup });
      setImportExportMessage(`Restored ${backup.length} bookmark${backup.length === 1 ? '' : 's'} from backup.`, 'success');
    }
  }

  await loadProfile();
  await loadDevice();
  state.prefs = await getSyncPrefs();

  const base = await readSyncBase();
  if (base && base.syncedAt) state.sync.lastSyncedAt = base.syncedAt;

  render();
  await renderSyncPanel();

  if (!state.prefs.autoSync) return;

  const settings = await getGistSettings();
  if (!settings.token || !settings.gistId) return;

  try {
    await syncNow({ trigger: 'auto' });
  } catch (error) {
    console.warn('YouTube Bookmark Manager: automatic sync failed', error);
  }
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
    addedAt: item.addedAt || '',
    updatedAt: item.updatedAt || ''
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
  const previous = state.bookmarks;
  const next = normalizeBookmarks(bookmarks);
  await recordDeletions(previous, next);
  state.bookmarks = next;
  await chrome.storage.local.set({ [STORAGE_KEY]: state.bookmarks });
  chrome.runtime.sendMessage({ type: 'ytbm-mirror' }).catch(() => {});
  render();
  scheduleSyncAfterChange();
}

let syncDebounceId = null;

// Push edits and deletes shortly after they happen so the other machine sees
// them without waiting for this manager to be reopened.
function scheduleSyncAfterChange() {
  if (!state.prefs.autoSync || state.syncing || state.pendingMerge) return;

  if (syncDebounceId) window.clearTimeout(syncDebounceId);
  syncDebounceId = window.setTimeout(runScheduledSync, 1500);
}

function runScheduledSync() {
  syncDebounceId = null;

  if (!state.prefs.autoSync || state.pendingMerge) return;

  // A sync is already running; try again once it settles.
  if (state.syncing) {
    syncDebounceId = window.setTimeout(runScheduledSync, 2000);
    return;
  }

  syncNow({ trigger: 'change' }).catch((error) => {
    console.warn('YouTube Bookmark Manager: automatic sync after change failed', error);
  });
}

// Deletions travel between machines as tombstones, otherwise the other
// machine would simply re-add every bookmark it still remembers.
async function recordDeletions(previous, next) {
  const tombstones = await readTombstones();
  const current = new Map();
  const nextKeys = new Set();

  next.forEach((bookmark) => {
    nextKeys.add(YTBMerge.identityKey(bookmark));
  });

  previous.forEach((bookmark) => {
    current.set(YTBMerge.identityKey(bookmark), bookmark);
  });

  let changed = false;
  const stamp = new Date().toISOString();

  current.forEach((bookmark, key) => {
    if (nextKeys.has(key) || tombstones[key]) return;
    tombstones[key] = YTBMerge.tombstoneFor(bookmark, stamp);
    changed = true;
  });

  next.forEach((bookmark) => {
    const key = YTBMerge.identityKey(bookmark);
    if (!tombstones[key]) return;

    // Restored or re-added after a delete: mark it so the other machine drops
    // its tombstone instead of deleting the bookmark again.
    if (YTBMerge.activityTime(bookmark) <= YTBMerge.toTime(tombstones[key].deletedAt)) {
      bookmark.resurrectedAt = stamp;
      bookmark.updatedAt = stamp;
    }

    delete tombstones[key];
    changed = true;
  });

  if (changed) await saveTombstones(YTBMerge.pruneTombstones(tombstones));
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
  return YTBMerge.identityKey(bookmark);
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

  const merged = {
    ...newer,
    id: current.id,
    tags: normalizeTags([...current.tags, ...incoming.tags]),
    notes: newer.notes || older.notes,
    addedAt,
    updatedAt: newer.updatedAt || older.updatedAt || ''
  };

  if (YTBMerge.diffBookmarks(current, merged).length) {
    merged.updatedAt = new Date().toISOString();
  } else {
    merged.updatedAt = newer.updatedAt || older.updatedAt || '';
  }

  return merged;
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

function setSyncMessage(message, tone = '') {
  els.syncMessage.textContent = message;
  els.syncMessage.dataset.tone = tone;
}

function setSyncBusy(busy) {
  [els.syncConnectButton, els.syncDisconnectButton, els.syncSettingsNowButton, els.syncButton].forEach((button) => {
    if (button) button.disabled = busy;
  });
}

async function getGistSettings() {
  const data = await chrome.storage.local.get([GIST_TOKEN_KEY, GIST_ID_KEY, GIST_USER_KEY]);
  return {
    token: data[GIST_TOKEN_KEY] || '',
    gistId: data[GIST_ID_KEY] || '',
    user: data[GIST_USER_KEY] || ''
  };
}

async function saveGistSettings(settings) {
  await chrome.storage.local.set({
    [GIST_TOKEN_KEY]: settings.token || '',
    [GIST_ID_KEY]: settings.gistId || '',
    [GIST_USER_KEY]: settings.user || ''
  });
}

async function githubApi(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });

  if (!response.ok) {
    const messages = {
      401: 'GitHub rejected the token. Reconnect with a valid gist-scoped token.',
      403: 'GitHub refused the request (rate limit or missing scope).',
      404: 'Gist not found. It may have been deleted.',
      422: 'GitHub rejected the payload.'
    };
    throw new Error(messages[response.status] || `GitHub request failed (${response.status}).`);
  }

  return response.status === 204 ? null : response.json();
}

function findSyncGist(gists) {
  return (Array.isArray(gists) ? gists : []).find((gist) => (
    gist.description === GIST_DESCRIPTION && gist.files && gist.files[GIST_FILENAME]
  )) || null;
}

function gistRevision(gist) {
  if (!gist) return '';
  const history = Array.isArray(gist.history) ? gist.history : [];
  return (history[0] && history[0].version) || gist.updated_at || '';
}

function snapshotMap(bookmarks) {
  const map = {};
  (Array.isArray(bookmarks) ? bookmarks : []).forEach((bookmark) => {
    map[YTBMerge.identityKey(bookmark)] = YTBMerge.snapshot(bookmark);
  });
  return map;
}

function buildSyncPayload(bookmarks, tombstones) {
  return {
    app: 'yt-bookmark-manager-sync',
    version: SYNC_PAYLOAD_VERSION,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    device: state.device,
    bookmarks,
    tombstones
  };
}

function parseSyncPayload(gist) {
  const file = gist && gist.files ? gist.files[GIST_FILENAME] : null;
  if (!file || typeof file.content !== 'string') {
    if (file && file.truncated) {
      throw new Error('The sync gist file is over 1 MB, which the GitHub API will not return. Use Export instead.');
    }
    throw new Error('The sync gist does not contain the bookmark file.');
  }

  let payload;
  try {
    payload = JSON.parse(file.content);
  } catch {
    throw new Error('The sync gist contains invalid JSON.');
  }

  const tombstones = {};
  const rawTombstones = payload && payload.tombstones;

  if (rawTombstones && typeof rawTombstones === 'object') {
    Object.entries(rawTombstones).forEach(([key, value]) => {
      const tombstone = YTBMerge.normalizeTombstone(value, key);
      if (tombstone) tombstones[key] = tombstone;
    });
  }

  return {
    bookmarks: normalizeBookmarks(getImportBookmarks(payload)),
    tombstones,
    device: payload && payload.device && payload.device.name ? payload.device : null,
    profile: payload ? payload.profile : null,
    version: payload ? payload.version : 1
  };
}

async function pushGist(payload, settings) {
  const body = JSON.stringify({
    description: GIST_DESCRIPTION,
    public: false,
    files: {
      [GIST_FILENAME]: {
        content: JSON.stringify(payload, null, 2)
      }
    }
  });

  return settings.gistId
    ? githubApi(`/gists/${settings.gistId}`, settings.token, { method: 'PATCH', body })
    : githubApi('/gists', settings.token, { method: 'POST', body });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatRelativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';

  const diff = Date.now() - time;
  if (diff < 45 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))} min ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 3600000))} h ago`;
  return formatDateTime(time);
}

function setSyncState(status, message, detail = '') {
  state.sync = { ...state.sync, status, message, detail };
  renderSyncPanel().catch(() => {});
}

async function renderSyncPanel() {
  const [settings, prefs] = await Promise.all([getGistSettings(), getSyncPrefs()]);
  const connected = Boolean(settings.token && settings.user);

  els.autoSyncToggle.checked = prefs.autoSync;
  els.autoLogToggle.checked = prefs.autoLog;
  els.mergeLogButton.disabled = !state.lastLog;

  if (!connected) {
    els.syncDot.dataset.state = 'off';
    els.syncPanelStatus.textContent = 'Not connected. Add a private GitHub gist to merge bookmarks between machines.';
    els.syncPanelDetail.textContent = state.bookmarks.length
      ? `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'} on ${state.device ? state.device.name : 'this device'}.`
      : '';
    return;
  }

  els.syncDot.dataset.state = state.syncing ? 'busy' : state.sync.status;
  els.syncPanelStatus.textContent = state.sync.message
    || (settings.gistId ? `Connected as ${settings.user}` : 'Connected — the next sync creates the gist.');

  const bits = [];
  if (state.sync.detail) bits.push(state.sync.detail);
  if (state.sync.lastSyncedAt) bits.push(`Last sync ${formatRelativeTime(state.sync.lastSyncedAt)}`);
  if (state.lastLog && state.lastLog.generatedAt) bits.push(`Last log ${formatRelativeTime(state.lastLog.generatedAt)}`);
  els.syncPanelDetail.textContent = bits.join(' · ');
}

async function syncNow(options = {}) {
  const trigger = options.trigger || 'manual';

  if (state.syncing) return;

  if (state.pendingMerge) {
    setSyncState('conflict', 'Conflicts need a decision', 'Resolve the open conflict dialog first.');
    return;
  }

  const settings = await getGistSettings();
  if (!settings.token) {
    if (trigger === 'manual') {
      openSyncModal();
      setSyncMessage('Add a GitHub token to sync between machines.', 'error');
    }
    return;
  }

  if (!settings.gistId && !state.bookmarks.length) {
    setSyncState('idle', 'Nothing to sync yet', 'Save a bookmark first.');
    return;
  }

  state.syncing = true;
  setSyncBusy(true);
  setSyncState('syncing', 'Syncing…', 'Checking the gist for changes.');

  try {
    await runSync(settings, trigger, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed.';
    setSyncState('error', 'Sync failed', message);
    setSyncMessage(message, 'error');
    setImportExportMessage(`Sync failed: ${message}`, 'error');
  } finally {
    state.syncing = false;
    setSyncBusy(false);
    renderSyncPanel().catch(() => {});
  }
}

async function runSync(settings, trigger, attempt) {
  if (!settings.gistId) {
    return createGistFromLocal(settings);
  }

  const gist = await githubApi(`/gists/${settings.gistId}`, settings.token);
  const revision = gistRevision(gist);
  const remote = parseSyncPayload(gist);
  const base = await readSyncBase();
  const localTombstones = await readTombstones();
  const localFingerprint = YTBMerge.fingerprint(state.bookmarks, localTombstones);
  const remoteDevice = resolveRemoteDevice(remote, base);

  if (base && base.revision && base.revision === revision && base.fingerprint === localFingerprint) {
    const now = new Date().toISOString();
    state.sync.lastSyncedAt = base.syncedAt || now;
    setSyncState('clean', 'Up to date', `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'} · checked ${formatRelativeTime(now)}`);
    await writeSyncBase({ ...base, checkedAt: now });
    return { noop: true };
  }

  const plan = YTBMerge.planMerge({
    local: state.bookmarks,
    remote: remote.bookmarks,
    baseBookmarks: base ? base.bookmarks : null,
    baseTombstones: base ? base.tombstones : {},
    localTombstones,
    remoteTombstones: remote.tombstones
  });

  const context = {
    plan,
    settings,
    revision,
    remote,
    base,
    localTombstones,
    trigger,
    attempt,
    remoteDevice
  };

  if (plan.conflicts.length) {
    openConflictModal(context);
    setSyncState(
      'conflict',
      'Conflicts need a decision',
      `${plan.conflicts.length} bookmark${plan.conflicts.length === 1 ? '' : 's'} changed on both machines.`
    );
    return { pending: true };
  }

  await finalizeMerge(context, null);
  return { done: true };
}

function resolveRemoteDevice(remote, base) {
  const ownId = state.device ? state.device.id : '';
  const device = remote && remote.device;

  if (device && device.name && device.id !== ownId) return device;
  if (base && base.remoteDevice) return { name: base.remoteDevice };
  return { name: 'Other device' };
}

async function createGistFromLocal(settings) {
  const tombstones = YTBMerge.pruneTombstones(await readTombstones());
  const gist = await pushGist(buildSyncPayload(state.bookmarks, tombstones), settings);
  const now = new Date().toISOString();

  await saveGistSettings({ ...settings, gistId: gist.id });
  await writeSyncBase({
    syncedAt: now,
    checkedAt: now,
    revision: gistRevision(gist),
    fingerprint: YTBMerge.fingerprint(state.bookmarks, tombstones),
    remoteDevice: '',
    bookmarks: snapshotMap(state.bookmarks),
    tombstones
  });

  state.sync.lastSyncedAt = now;
  setSyncState('clean', 'Sync gist created', `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'} · ${state.device ? state.device.name : 'this device'}`);
  setSyncMessage(`Created a secret gist with ${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'}.`, 'success');
  await renderSyncStatus();
  return { created: true };
}

async function finalizeMerge(context, resolutions) {
  const { plan, settings, revision, remote, trigger, attempt } = context;

  // Someone may have pushed while the conflict dialog was open. Re-read the
  // revision before writing anything, then retry once with the fresh copy.
  const fresh = await githubApi(`/gists/${settings.gistId}`, settings.token);
  if (gistRevision(fresh) !== revision) {
    if (attempt < 1) {
      setSyncMessage('The gist changed while merging. Syncing again…', '');
      return runSync(settings, trigger, attempt + 1);
    }
    throw new Error('The gist changed while merging. Run sync again.');
  }

  const beforeBookmarks = state.bookmarks.slice();
  const beforeTombstones = context.localTombstones || {};
  const applied = YTBMerge.applyResolutions(plan, resolutions);
  const merged = normalizeBookmarks(applied.bookmarks);
  const tombstones = YTBMerge.pruneTombstones(applied.tombstones);

  await saveBookmarks(merged);
  await saveTombstones(tombstones);

  const localFingerprint = YTBMerge.fingerprint(state.bookmarks, tombstones);
  const remoteFingerprint = YTBMerge.fingerprint(remote.bookmarks, remote.tombstones);
  const needsPush = localFingerprint !== remoteFingerprint;
  const remoteDevice = context.remoteDevice || { name: 'Other device' };

  let pushed = false;
  let pushError = '';
  let nextRevision = revision;

  if (needsPush) {
    try {
      const gist = await pushGist(buildSyncPayload(state.bookmarks, tombstones), settings);
      pushed = true;
      nextRevision = gistRevision(gist) || nextRevision;
    } catch (error) {
      pushError = error instanceof Error ? error.message : 'Push failed.';
    }
  }

  const now = new Date().toISOString();
  const baseValid = !needsPush || pushed;
  await writeSyncBase({
    syncedAt: now,
    checkedAt: now,
    revision: baseValid ? nextRevision : '',
    fingerprint: baseValid ? localFingerprint : '',
    remoteDevice: remoteDevice.name === 'Other device'
      ? ((context.base && context.base.remoteDevice) || '')
      : remoteDevice.name,
    bookmarks: snapshotMap(state.bookmarks),
    tombstones
  });

  const log = YTBMerge.buildLog({
    plan,
    resolutions,
    beforeBookmarks,
    afterBookmarks: state.bookmarks,
    beforeTombstones,
    afterTombstones: tombstones,
    remoteCount: remote.bookmarks.length,
    trigger,
    device: state.device || { name: 'This device' },
    remoteDevice,
    gist: { id: settings.gistId, revision: nextRevision },
    pushed,
    pushError
  });

  state.sync.lastSyncedAt = now;
  state.lastLog = {
    generatedAt: log.generatedAt,
    markdown: YTBMerge.toMarkdown(log),
    summary: log.summary
  };
  await chrome.storage.local.set({ [MERGE_LOG_KEY]: state.lastLog });

  const summary = summarizeMerge(log);

  if (pushError) {
    setSyncState('error', 'Merged locally, push failed', `${pushError} · ${summary.detail}`);
    setImportExportMessage(`Merged locally, but the gist push failed: ${pushError}`, 'error');
  } else {
    setSyncState('clean', summary.title, summary.detail);
    setImportExportMessage(summary.title, 'success');
  }

  if (state.prefs.autoLog && trigger !== 'change' && (log.summary.added || log.summary.removed || log.summary.changed || log.summary.conflicts)) {
    downloadMergeLog(state.lastLog);
  }

  return log;
}

function summarizeMerge(log) {
  const summary = log.summary;
  const parts = [];

  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (summary.changed) parts.push(`${summary.changed} updated`);
  if (summary.conflicts) parts.push(`${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'} resolved`);

  const other = log.remoteDevice && log.remoteDevice.name ? log.remoteDevice.name : 'other device';
  const device = log.device && log.device.name ? log.device.name : 'this device';
  const detail = `${state.bookmarks.length} bookmark${state.bookmarks.length === 1 ? '' : 's'} · ${device} ↔ ${other}${summary.pushed ? ' · pushed' : ''}`;

  return {
    title: parts.length ? parts.join(', ') : (summary.pushed ? 'Synced' : 'Already up to date'),
    detail
  };
}

function buildMergeLogFilename(date) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (number) => String(number).padStart(2, '0');

  return `yt-bookmarks-merge-${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}.md`;
}

function downloadMergeLog(log) {
  if (!log || !log.markdown) return;
  downloadTextFile(buildMergeLogFilename(log.generatedAt), log.markdown, 'text/markdown');
}

function handleMergeLog() {
  if (!state.lastLog) {
    setImportExportMessage('No merge log yet. Run a sync first.', '');
    return;
  }

  downloadMergeLog(state.lastLog);
  setImportExportMessage('Merge log downloaded.', 'success');
}

function setConflictMessage(message, tone = '') {
  els.conflictMessage.textContent = message;
  els.conflictMessage.dataset.tone = tone;
}

function openConflictModal(context) {
  context.deviceLabel = state.device ? state.device.name : 'This device';
  context.remoteLabel = context.remoteDevice && context.remoteDevice.name
    ? context.remoteDevice.name
    : 'Other device';
  state.pendingMerge = context;

  els.conflictList.replaceChildren();
  context.plan.conflicts.forEach((conflict, index) => {
    els.conflictList.appendChild(createConflictCard(conflict, index, context));
  });

  els.conflictTitle.textContent = `${context.plan.conflicts.length} bookmark${context.plan.conflicts.length === 1 ? '' : 's'} to resolve`;
  setConflictMessage('Choose what to keep for each field. Nothing is saved until you apply.', '');
  els.applyConflict.disabled = false;

  if (typeof els.conflictModal.showModal === 'function') {
    els.conflictModal.showModal();
  } else {
    els.conflictModal.setAttribute('open', '');
  }
}

function closeConflictModal() {
  if (typeof els.conflictModal.close === 'function') {
    els.conflictModal.close();
  } else {
    els.conflictModal.removeAttribute('open');
  }
}

function handleCancelConflict() {
  if (!state.pendingMerge) return;
  state.pendingMerge = null;
  closeConflictModal();
  setSyncState('conflict', 'Sync paused', 'Conflicts were left untouched; no bookmarks changed.');
  setSyncMessage('Sync cancelled. No bookmarks were changed.', '');
}

async function handleApplyConflict() {
  const context = state.pendingMerge;
  if (!context) return;

  const resolutions = collectResolutions();
  if (!resolutions) return;

  state.pendingMerge = null;
  closeConflictModal();
  state.syncing = true;
  setSyncBusy(true);
  els.applyConflict.disabled = true;
  setSyncState('syncing', 'Applying merge…', 'Writing the merged library.');

  try {
    await finalizeMerge(context, resolutions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Merge failed.';
    setSyncState('error', 'Merge failed', message);
    setSyncMessage(message, 'error');
    setImportExportMessage(`Merge failed: ${message}`, 'error');
  } finally {
    state.syncing = false;
    setSyncBusy(false);
    els.applyConflict.disabled = false;
    renderSyncPanel().catch(() => {});
  }
}

function createConflictCard(conflict, index, context) {
  const card = document.createElement('article');
  card.className = 'conflict-card';
  card.dataset.conflictIndex = String(index);

  const header = document.createElement('div');
  header.className = 'conflict-header';

  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = `Conflict ${index + 1} of ${context.plan.conflicts.length}`;

  const title = document.createElement('h3');
  title.textContent = conflict.bookmark.title || 'Untitled video';
  heading.append(eyebrow, title);

  if (conflict.bookmark.channelName) {
    const channel = document.createElement('p');
    channel.className = 'muted';
    channel.textContent = conflict.bookmark.channelName;
    heading.appendChild(channel);
  }

  const quick = document.createElement('div');
  quick.className = 'conflict-quick';

  if (conflict.type === 'delete-conflict') {
    quick.append(
      createQuickButton('Keep it', () => setDeleteChoice(index, 'keep')),
      createQuickButton('Delete it', () => setDeleteChoice(index, 'delete'))
    );
  } else {
    quick.append(
      createQuickButton('Use mine', () => setCardChoice(index, conflict, 'local')),
      createQuickButton('Use theirs', () => setCardChoice(index, conflict, 'remote'))
    );
  }

  header.append(heading, quick);
  card.appendChild(header);

  if (conflict.type === 'delete-conflict') {
    card.appendChild(createDeleteConflictBody(conflict, index, context));
  } else {
    card.appendChild(createFieldConflictBody(conflict, index, context));
  }

  return card;
}

function createQuickButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createFieldConflictBody(conflict, index, context) {
  const grid = document.createElement('div');
  grid.className = 'conflict-grid';

  [
    'Field',
    `${context.deviceLabel} (this device)`,
    `${context.remoteLabel} (other device)`,
    'At last sync'
  ].forEach((text) => {
    const cell = document.createElement('div');
    cell.className = 'conflict-head';
    cell.textContent = text;
    grid.appendChild(cell);
  });

  conflict.conflicts.forEach((field) => {
    const name = `conflict-${index}-field-${field.field}`;

    const fieldName = document.createElement('div');
    fieldName.className = 'conflict-field';
    fieldName.textContent = field.label;
    grid.appendChild(fieldName);

    grid.appendChild(createChoiceLabel(name, 'local', formatConflictValue(field.local, field.field), field.field));
    grid.appendChild(createChoiceLabel(name, 'remote', formatConflictValue(field.remote, field.field), field.field));

    const base = document.createElement('div');
    base.className = 'conflict-base';
    base.dataset.label = 'At last sync: ';
    base.textContent = field.hasBase ? formatConflictValue(field.base, field.field) : 'no previous copy';
    grid.appendChild(base);
  });

  return grid;
}

function createDeleteConflictBody(conflict, index, context) {
  const body = document.createElement('div');
  body.className = 'conflict-delete';

  const deletedOn = conflict.deletedSide === 'local' ? 'this device' : 'the other device';
  const editedOn = conflict.deletedSide === 'local' ? 'the other device' : 'this device';

  const summary = document.createElement('p');
  summary.className = 'conflict-delete-summary';
  summary.textContent = `Deleted on ${deletedOn} (${formatDateTime(conflict.deletedAt)}), edited on ${editedOn} (${formatDateTime(conflict.editedAt)}).`;
  body.appendChild(summary);

  const name = `conflict-${index}-delete`;
  body.appendChild(createTextChoice(name, 'keep', `Keep the bookmark and sync it to both machines (${context.deviceLabel} has the edited copy)`));
  body.appendChild(createTextChoice(name, 'delete', 'Delete it everywhere (keeps the delete)'));

  return body;
}

function createChoiceLabel(name, value, text, field) {
  const label = document.createElement('label');
  label.className = 'conflict-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;

  const span = document.createElement('span');
  span.className = 'conflict-value';
  if (field === 'notes') span.classList.add('multiline');
  span.textContent = text;

  label.append(input, span);
  return label;
}

function createTextChoice(name, value, text) {
  const label = document.createElement('label');
  label.className = 'conflict-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;

  const span = document.createElement('span');
  span.className = 'conflict-value';
  span.textContent = text;

  label.append(input, span);
  return label;
}

function formatConflictValue(value, field) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
  if (field === 'hasTimestamp') return value ? 'yes' : 'no';
  if (value === undefined || value === null || String(value) === '') return '(empty)';
  return String(value);
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
}

function setCardChoice(index, conflict, side) {
  conflict.conflicts.forEach((field) => {
    setRadio(`conflict-${index}-field-${field.field}`, side);
  });
  clearConflictIncomplete();
}

function setDeleteChoice(index, value) {
  setRadio(`conflict-${index}-delete`, value);
  clearConflictIncomplete();
}

function setAllConflictChoices(side) {
  const context = state.pendingMerge;
  if (!context) return;

  context.plan.conflicts.forEach((conflict, index) => {
    if (conflict.type === 'delete-conflict') {
      const keep = side === 'local' ? conflict.deletedSide === 'remote' : conflict.deletedSide === 'local';
      setDeleteChoice(index, keep ? 'keep' : 'delete');
      return;
    }

    setCardChoice(index, conflict, side);
  });

  clearConflictIncomplete();
}

function clearConflictIncomplete() {
  els.conflictList.querySelectorAll('.is-incomplete').forEach((card) => {
    card.classList.remove('is-incomplete');
  });
  setConflictMessage('', '');
}

function collectResolutions() {
  const context = state.pendingMerge;
  if (!context) return null;

  const resolutions = {};
  let firstMissing = null;

  context.plan.conflicts.forEach((conflict, index) => {
    const card = els.conflictList.querySelector(`[data-conflict-index="${index}"]`);
    if (card) card.classList.remove('is-incomplete');

    if (conflict.type === 'delete-conflict') {
      const checked = card && card.querySelector(`input[name="conflict-${index}-delete"]:checked`);
      if (!checked) {
        if (firstMissing === null) firstMissing = index;
        if (card) card.classList.add('is-incomplete');
        return;
      }

      resolutions[conflict.key] = { action: checked.value };
      return;
    }

    const fields = {};
    conflict.conflicts.forEach((field) => {
      const checked = card && card.querySelector(`input[name="conflict-${index}-field-${field.field}"]:checked`);
      if (!checked) {
        if (firstMissing === null) firstMissing = index;
        if (card) card.classList.add('is-incomplete');
        return;
      }

      fields[field.field] = checked.value;
    });

    resolutions[conflict.key] = { fields };
  });

  if (firstMissing !== null) {
    setConflictMessage('Choose an option for every conflict before applying.', 'error');
    const card = els.conflictList.querySelector(`[data-conflict-index="${firstMissing}"]`);
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'nearest' });
    }
    return null;
  }

  return resolutions;
}

async function renderSyncStatus() {
  const [settings, prefs] = await Promise.all([getGistSettings(), getSyncPrefs()]);
  const connected = Boolean(settings.token && settings.user);

  els.syncConnectSection.hidden = connected;
  els.syncConnectedSection.hidden = !connected;
  els.deviceNameInput.value = state.device ? state.device.name : '';
  els.autoLogToggle.checked = prefs.autoLog;

  if (connected) {
    const parts = [`Connected as ${settings.user}.`];
    parts.push(settings.gistId ? `Gist ${settings.gistId.slice(0, 8)}.` : 'No sync gist yet — the next sync creates one.');
    if (state.sync.lastSyncedAt) parts.push(`Last sync ${formatRelativeTime(state.sync.lastSyncedAt)}.`);
    els.syncStatus.textContent = parts.join(' ');
    els.syncStatus.dataset.tone = '';
  }
}

function openSyncModal() {
  setSyncMessage('', '');
  els.syncTokenInput.value = '';

  renderSyncStatus().catch((error) => {
    console.error('YouTube Bookmark Manager: failed to load sync state', error);
  });

  if (typeof els.syncModal.showModal === 'function') {
    els.syncModal.showModal();
  } else {
    els.syncModal.setAttribute('open', '');
  }
}

function closeSyncModalDialog() {
  if (typeof els.syncModal.close === 'function') {
    els.syncModal.close();
  } else {
    els.syncModal.removeAttribute('open');
  }
}

async function handleSyncConnect() {
  const token = els.syncTokenInput.value.trim();
  if (!token) {
    setSyncMessage('Paste a GitHub personal access token first.', 'error');
    return;
  }

  setSyncBusy(true);
  setSyncMessage('Connecting to GitHub...', '');

  try {
    const user = await githubApi('/user', token);
    const gists = await githubApi('/gists?per_page=100', token);
    const existing = findSyncGist(gists);

    await saveGistSettings({
      token,
      gistId: existing?.id || '',
      user: user.login || ''
    });

    els.syncTokenInput.value = '';
    await renderSyncStatus();
    await renderSyncPanel();

    setSyncMessage(existing
      ? `Connected as ${user.login}. Found your existing sync gist.`
      : `Connected as ${user.login}.`, 'success');

    if (existing || state.bookmarks.length) {
      closeSyncModalDialog();
      await syncNow({ trigger: 'manual' });
    }
  } catch (error) {
    setSyncMessage(error instanceof Error ? error.message : 'Could not connect.', 'error');
  } finally {
    setSyncBusy(false);
  }
}

async function handleSyncDisconnect() {
  await saveGistSettings({ token: '', gistId: '', user: '' });
  await renderSyncStatus();
  await renderSyncPanel();
  setSyncState('idle', 'Disconnected', 'The gist itself still exists on GitHub.');
  setSyncMessage('Disconnected. The gist itself still exists on GitHub.', 'success');
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
      tags: normalizeTags(els.tagsInput.value),
      updatedAt: new Date().toISOString()
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

  els.syncButton.addEventListener('click', () => {
    syncNow({ trigger: 'manual' }).catch((error) => {
      console.error('YouTube Bookmark Manager: sync failed', error);
    });
  });
  els.syncSettingsButton.addEventListener('click', openSyncModal);
  els.mergeLogButton.addEventListener('click', handleMergeLog);

  els.autoSyncToggle.addEventListener('change', () => {
    const autoSync = els.autoSyncToggle.checked;
    saveSyncPrefs({ autoSync }).then(() => {
      setImportExportMessage(autoSync ? 'Automatic sync enabled.' : 'Automatic sync disabled.', 'success');
    }).catch((error) => {
      console.error('YouTube Bookmark Manager: could not save sync preference', error);
    });
  });

  els.closeSyncModal.addEventListener('click', closeSyncModalDialog);
  els.syncConnectButton.addEventListener('click', () => {
    handleSyncConnect().catch((error) => {
      console.error('YouTube Bookmark Manager: sync connect failed', error);
    });
  });
  els.syncSettingsNowButton.addEventListener('click', () => {
    closeSyncModalDialog();
    syncNow({ trigger: 'manual' }).catch((error) => {
      console.error('YouTube Bookmark Manager: sync failed', error);
    });
  });
  els.syncDisconnectButton.addEventListener('click', () => {
    handleSyncDisconnect().catch((error) => {
      console.error('YouTube Bookmark Manager: sync disconnect failed', error);
    });
  });
  els.deviceNameInput.addEventListener('change', () => {
    saveDeviceName(els.deviceNameInput.value).catch((error) => {
      console.error('YouTube Bookmark Manager: could not save device name', error);
    });
  });
  els.autoLogToggle.addEventListener('change', () => {
    saveSyncPrefs({ autoLog: els.autoLogToggle.checked }).catch((error) => {
      console.error('YouTube Bookmark Manager: could not save log preference', error);
    });
  });
  els.syncModal.addEventListener('click', (event) => {
    if (event.target === els.syncModal) closeSyncModalDialog();
  });

  els.conflictUseMine.addEventListener('click', () => setAllConflictChoices('local'));
  els.conflictUseTheirs.addEventListener('click', () => setAllConflictChoices('remote'));
  els.applyConflict.addEventListener('click', () => {
    handleApplyConflict().catch((error) => {
      console.error('YouTube Bookmark Manager: merge apply failed', error);
    });
  });
  els.cancelConflict.addEventListener('click', handleCancelConflict);
  els.closeConflictModal.addEventListener('click', handleCancelConflict);
  els.conflictModal.addEventListener('cancel', (event) => {
    event.preventDefault();
    handleCancelConflict();
  });
  els.conflictModal.addEventListener('click', (event) => {
    if (event.target === els.conflictModal) handleCancelConflict();
  });

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
