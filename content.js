const STORAGE_KEY = 'yt_video_bookmarks';
const UNCATEGORIZED = 'Uncategorized';
const NEW_CATEGORY = '__ytbm_new_category__';

let currentVideoId = null;
let saveStateTimeoutId = null;

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

function getVideoTitle() {
  return document.title.replace(' - YouTube', '').trim();
}

function getAbsoluteYouTubeUrl(pathOrUrl) {
  if (!pathOrUrl) return '';

  try {
    return new URL(pathOrUrl, window.location.origin).href;
  } catch {
    return '';
  }
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
    const parsed = new URL(url, window.location.origin);
    return parseTimestampParam(parsed.searchParams.get('t') || parsed.searchParams.get('start'));
  } catch {
    return 0;
  }
}

function hasTimestampInUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url, window.location.origin);
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

function getCurrentTimestampSeconds() {
  return normalizeTimestampSeconds(document.querySelector('video')?.currentTime);
}

function parseTimestampInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return normalizeTimestampSeconds(raw);
  }

  const parts = raw.split(':').map((part) => part.trim());
  if (parts.length <= 3 && parts.every((part) => /^\d+$/.test(part))) {
    return parts.reduce((total, part) => (total * 60) + Number(part), 0);
  }

  return parseTimestampParam(raw);
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

function getChannelInfo() {
  const selectors = [
    'ytd-watch-metadata ytd-video-owner-renderer #channel-name a',
    'ytd-watch-metadata #owner #channel-name a',
    '#upload-info #channel-name a',
    'ytd-video-owner-renderer a.yt-simple-endpoint',
    'a.yt-simple-endpoint.yt-formatted-string[href^="/@"]',
    'a.yt-simple-endpoint.yt-formatted-string[href^="/channel/"]'
  ];

  for (const selector of selectors) {
    const link = document.querySelector(selector);
    const name = link?.textContent?.trim();
    const url = getAbsoluteYouTubeUrl(link?.getAttribute('href') || link?.href);

    if (name && url) {
      return { channelName: name, channelUrl: url };
    }
  }

  const authorName = document.querySelector('span[itemprop="author"] link[itemprop="name"]')?.getAttribute('content')?.trim();
  const authorUrl = getAbsoluteYouTubeUrl(
    document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href')
  );

  return {
    channelName: authorName || '',
    channelUrl: authorUrl || ''
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
    title: item.title || 'Untitled video',
    thumbnail: item.thumbnail || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : ''),
    channelName: item.channelName || '',
    channelUrl: item.channelUrl || '',
    category: normalizeCategory(item.category),
    tags: normalizeTags(item.tags),
    hasTimestamp,
    timestampSeconds,
    notes: String(item.notes || '').trim(),
    addedAt: item.addedAt || new Date().toISOString()
  };
}

function normalizeBookmarks(bookmarks) {
  return (Array.isArray(bookmarks) ? bookmarks : []).map(normalizeBookmark);
}

function createBookmark() {
  const videoId = getVideoId();
  if (!videoId) return null;

  const channel = getChannelInfo();
  const timestampSeconds = getCurrentTimestampSeconds();

  return {
    id: crypto.randomUUID(),
    videoId,
    youtubeUrl: buildYouTubeUrl(videoId),
    title: getVideoTitle(),
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    channelName: channel.channelName,
    channelUrl: channel.channelUrl,
    category: UNCATEGORIZED,
    tags: [],
    hasTimestamp: false,
    timestampSeconds,
    notes: '',
    addedAt: new Date().toISOString()
  };
}

async function getBookmarks() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeBookmarks(data[STORAGE_KEY]);
}

async function setBookmarks(bookmarks) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeBookmarks(bookmarks) });
  return true;
}

function getCategoryOptions(bookmarks, activeCategory) {
  const categories = new Set([UNCATEGORIZED]);
  if (activeCategory) categories.add(normalizeCategory(activeCategory));

  bookmarks.forEach((bookmark) => {
    categories.add(normalizeCategory(bookmark.category));
  });

  return [...categories].sort((a, b) => a.localeCompare(b));
}

function getTagOptions(bookmarks) {
  const tags = new Set();

  bookmarks.forEach((bookmark) => {
    normalizeTags(bookmark.tags).forEach((tag) => tags.add(tag));
  });

  return [...tags].sort((a, b) => a.localeCompare(b));
}

async function openSaveModal() {
  const draft = createBookmark();
  if (!draft) return;

  const bookmarks = await getBookmarks();
  const existing = bookmarks.find((bookmark) => bookmark.videoId === draft.videoId && !bookmark.hasTimestamp);
  const bookmark = existing || draft;
  const root = ensureModal();

  root.dataset.videoId = draft.videoId;
  root.querySelector('#ytbm-video-title').textContent = draft.title;
  root.querySelector('#ytbm-save-timestamp-checkbox').checked = false;
  root.querySelector('#ytbm-timestamp-input').value = formatTimestamp(draft.timestampSeconds);
  root.querySelector('#ytbm-notes-input').value = bookmark.notes || '';
  root.querySelector('#ytbm-tags-input').value = normalizeTags(bookmark.tags).join(', ');
  root.querySelector('#ytbm-new-category-input').value = '';
  root.querySelector('#ytbm-message').textContent = '';

  renderCategorySelect(bookmarks, bookmark.category);
  renderTagSuggestions(bookmarks);
  syncNewCategoryField();
  syncTimestampField();
  syncSaveActionCopy(bookmarks);
  syncTagSuggestionStates();

  root.hidden = false;
  root.querySelector('#ytbm-notes-input').focus();
}

function closeSaveModal() {
  const root = document.querySelector('#ytbm-modal-root');
  if (root) root.hidden = true;
}

function handleEscape(event) {
  if (event.key !== 'Escape') return;

  const root = document.querySelector('#ytbm-modal-root');
  if (root && !root.hidden) closeSaveModal();
}

function createElement(tagName, attributes = {}, textContent = '') {
  const element = document.createElement(tagName);

  Object.entries(attributes).forEach(([name, value]) => {
    if (value === false || value === null || value === undefined) return;

    if (name === 'className') {
      element.className = value;
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, value);
    }
  });

  if (textContent) element.textContent = textContent;
  return element;
}

function createLabel(text, control) {
  const label = createElement('label', { className: 'ytbm-field' });
  label.append(createElement('span', {}, text), control);
  return label;
}

function createCheckboxLabel(text, control) {
  const label = createElement('label', { className: 'ytbm-toggle-field' });
  label.append(control, createElement('span', {}, text));
  return label;
}

function ensureModal() {
  const existing = document.querySelector('#ytbm-modal-root');
  if (existing) return existing;

  const root = createElement('div', {
    id: 'ytbm-modal-root',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'ytbm-modal-title',
    hidden: true
  });
  const backdrop = createElement('button', {
    type: 'button',
    className: 'ytbm-backdrop',
    'aria-label': 'Close bookmark dialog'
  });
  const dialog = createElement('div', { className: 'ytbm-dialog' });
  const form = createElement('form', { id: 'ytbm-form' });

  const header = createElement('div', { className: 'ytbm-modal-header' });
  const titleGroup = createElement('div');
  titleGroup.append(
    createElement('p', { className: 'ytbm-eyebrow' }, 'YouTube bookmark'),
    createElement('h2', { id: 'ytbm-modal-title' }, 'Save bookmark')
  );
  const closeButton = createElement('button', {
    type: 'button',
    className: 'ytbm-icon-button',
    'aria-label': 'Close bookmark dialog'
  }, 'x');
  header.append(titleGroup, closeButton);

  const videoTitle = createElement('p', { id: 'ytbm-video-title' });
  const categorySelect = createElement('select', { id: 'ytbm-category-select', required: true });
  const newCategoryInput = createElement('input', {
    id: 'ytbm-new-category-input',
    type: 'text',
    placeholder: 'Category name'
  });
  const newCategoryField = createLabel('New category', newCategoryInput);
  newCategoryField.id = 'ytbm-new-category-field';
  newCategoryField.hidden = true;

  const timestampInput = createElement('input', {
    id: 'ytbm-timestamp-input',
    type: 'text',
    inputmode: 'numeric',
    placeholder: '1:23'
  });
  const timestampCheckbox = createElement('input', {
    id: 'ytbm-save-timestamp-checkbox',
    type: 'checkbox'
  });
  const timestampField = createLabel('Timestamp', timestampInput);
  timestampField.id = 'ytbm-timestamp-field';
  timestampField.hidden = true;
  const notesInput = createElement('textarea', {
    id: 'ytbm-notes-input',
    rows: '4',
    placeholder: 'Notes about this bookmark'
  });
  const tagsInput = createElement('input', {
    id: 'ytbm-tags-input',
    type: 'text',
    placeholder: 'research, music, watch later'
  });
  const tagSuggestions = createElement('div', { id: 'ytbm-tag-suggestions' });
  const help = createElement('p', { className: 'ytbm-help' }, 'Separate tags with commas.');
  const message = createElement('p', { id: 'ytbm-message', 'aria-live': 'polite' });

  const actions = createElement('div', { className: 'ytbm-modal-actions' });
  const cancelButton = createElement('button', {
    type: 'button',
    className: 'ytbm-secondary-button'
  }, 'Cancel');
  const saveButton = createElement('button', {
    id: 'ytbm-save-submit',
    type: 'submit',
    className: 'ytbm-primary-button'
  }, 'Save bookmark');
  actions.append(cancelButton, saveButton);

  form.append(
    header,
    videoTitle,
    createCheckboxLabel('Save timestamp', timestampCheckbox),
    timestampField,
    createLabel('Notes', notesInput),
    createLabel('Category', categorySelect),
    newCategoryField,
    createLabel('Tags', tagsInput),
    tagSuggestions,
    help,
    message,
    actions
  );
  dialog.appendChild(form);
  root.append(backdrop, dialog);
  document.body.appendChild(root);

  backdrop.addEventListener('click', closeSaveModal);
  closeButton.addEventListener('click', closeSaveModal);
  cancelButton.addEventListener('click', closeSaveModal);
  categorySelect.addEventListener('change', syncNewCategoryField);
  timestampCheckbox.addEventListener('change', () => {
    syncTimestampField();
    syncSaveActionCopy().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to refresh save action label', error);
    });
  });
  timestampInput.addEventListener('input', () => {
    syncSaveActionCopy().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to refresh save action label', error);
    });
  });
  tagsInput.addEventListener('input', syncTagSuggestionStates);
  tagSuggestions.addEventListener('click', handleTagSuggestionClick);
  form.addEventListener('submit', (event) => {
    handleSaveSubmit(event).catch((error) => {
      message.textContent = 'Could not save bookmark. Check the extension console for details.';
      console.error('YouTube Bookmark Manager: failed to save bookmark', error);
    });
  });
  document.addEventListener('keydown', handleEscape);

  return root;
}

function renderCategorySelect(bookmarks, activeCategory) {
  const select = document.querySelector('#ytbm-category-select');
  const categories = getCategoryOptions(bookmarks, activeCategory);

  select.replaceChildren();

  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });

  const createOption = document.createElement('option');
  createOption.value = NEW_CATEGORY;
  createOption.textContent = 'Create new category';
  select.appendChild(createOption);
  select.value = categories.includes(activeCategory) ? activeCategory : UNCATEGORIZED;
}

function renderTagSuggestions(bookmarks) {
  const container = document.querySelector('#ytbm-tag-suggestions');
  const tags = getTagOptions(bookmarks);
  container.replaceChildren();

  tags.forEach((tag) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytbm-tag-suggestion';
    button.dataset.tag = tag;
    button.textContent = tag;
    container.appendChild(button);
  });
}

function syncNewCategoryField() {
  const select = document.querySelector('#ytbm-category-select');
  const field = document.querySelector('#ytbm-new-category-field');
  const input = document.querySelector('#ytbm-new-category-input');
  const isNewCategory = select.value === NEW_CATEGORY;

  field.hidden = !isNewCategory;
  input.required = isNewCategory;

  if (isNewCategory) input.focus();
}

function syncTimestampField() {
  const checkbox = document.querySelector('#ytbm-save-timestamp-checkbox');
  const field = document.querySelector('#ytbm-timestamp-field');
  const input = document.querySelector('#ytbm-timestamp-input');
  const hasTimestamp = Boolean(checkbox?.checked);

  if (!field || !input) return;

  field.hidden = !hasTimestamp;
  input.disabled = !hasTimestamp;

  if (hasTimestamp) input.focus();
}

function getModalSaveSelection() {
  const root = document.querySelector('#ytbm-modal-root');
  if (!root) return null;

  const hasTimestamp = Boolean(root.querySelector('#ytbm-save-timestamp-checkbox')?.checked);
  const timestampSeconds = hasTimestamp
    ? parseTimestampInput(root.querySelector('#ytbm-timestamp-input')?.value)
    : 0;

  return {
    hasTimestamp,
    root,
    timestampSeconds,
    videoId: root.dataset.videoId || ''
  };
}

function findMatchingBookmark(bookmarks, selection) {
  if (!selection) return null;

  return bookmarks.find((bookmark) => (
    bookmark.videoId === selection.videoId &&
    bookmark.hasTimestamp === selection.hasTimestamp &&
    (!selection.hasTimestamp || bookmark.timestampSeconds === selection.timestampSeconds)
  )) || null;
}

async function syncSaveActionCopy(bookmarks = null) {
  const selection = getModalSaveSelection();
  if (!selection) return;

  const source = bookmarks || await getBookmarks();
  const existing = findMatchingBookmark(source, selection);
  const label = existing ? 'Update bookmark' : 'Save bookmark';

  selection.root.querySelector('#ytbm-modal-title').textContent = label;
  selection.root.querySelector('#ytbm-save-submit').textContent = label;
}

function syncTagSuggestionStates() {
  const activeTags = normalizeTags(document.querySelector('#ytbm-tags-input')?.value || '');

  document.querySelectorAll('.ytbm-tag-suggestion').forEach((button) => {
    button.setAttribute('aria-pressed', String(activeTags.includes(button.dataset.tag)));
  });
}

function handleTagSuggestionClick(event) {
  const button = event.target.closest('.ytbm-tag-suggestion');
  if (!button) return;

  const input = document.querySelector('#ytbm-tags-input');
  const tags = normalizeTags(input.value);
  const tag = button.dataset.tag;
  const nextTags = tags.includes(tag)
    ? tags.filter((value) => value !== tag)
    : [...tags, tag];

  input.value = nextTags.join(', ');
  syncTagSuggestionStates();
}

function getSelectedCategory() {
  const select = document.querySelector('#ytbm-category-select');
  const newCategoryInput = document.querySelector('#ytbm-new-category-input');

  if (select.value === NEW_CATEGORY) {
    return normalizeCategory(newCategoryInput.value);
  }

  return normalizeCategory(select.value);
}

async function handleSaveSubmit(event) {
  event.preventDefault();

  const draft = createBookmark();
  if (!draft) return;

  const bookmarks = await getBookmarks();
  const selection = getModalSaveSelection();
  const hasTimestamp = Boolean(selection?.hasTimestamp);
  const timestampSeconds = selection?.timestampSeconds || 0;
  const matchingBookmark = findMatchingBookmark(bookmarks, selection);
  const index = matchingBookmark ? bookmarks.indexOf(matchingBookmark) : -1;

  const existing = index >= 0 ? bookmarks[index] : null;
  const category = getSelectedCategory();
  const tags = normalizeTags(document.querySelector('#ytbm-tags-input').value);
  const notes = document.querySelector('#ytbm-notes-input').value.trim();
  const now = new Date().toISOString();
  const bookmark = {
    ...(existing || draft),
    ...draft,
    id: existing?.id || draft.id,
    youtubeUrl: buildYouTubeUrl(draft.videoId, timestampSeconds, hasTimestamp),
    channelName: draft.channelName || existing?.channelName || '',
    channelUrl: draft.channelUrl || existing?.channelUrl || '',
    category,
    tags,
    hasTimestamp,
    timestampSeconds,
    notes,
    addedAt: existing?.addedAt || draft.addedAt,
    updatedAt: now
  };

  if (index >= 0) {
    bookmarks[index] = bookmark;
  } else {
    bookmarks.unshift(bookmark);
  }

  await setBookmarks(bookmarks);
  showSavedState();
  closeSaveModal();
}

function showSavedState() {
  const button = document.querySelector('#ytbm-btn');
  if (!button) return;

  button.textContent = 'Saved';
  button.dataset.saved = 'true';

  if (saveStateTimeoutId) {
    window.clearTimeout(saveStateTimeoutId);
  }

  saveStateTimeoutId = window.setTimeout(() => {
    if (!document.querySelector('#ytbm-btn')) return;
    updateSaveButtonState().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to refresh save button', error);
    });
  }, 3000);
}

async function updateSaveButtonState() {
  const button = document.querySelector('#ytbm-btn');
  const videoId = getVideoId();
  if (!button || !videoId) return;

  if (getVideoId() !== videoId) return;

  button.dataset.videoId = videoId;
  button.dataset.saved = 'false';
  button.textContent = '★ Save';
  button.title = 'Save this YouTube video';
}

function injectButton() {
  const videoId = getVideoId();
  let button = document.querySelector('#ytbm-btn');

  if (!videoId) {
    currentVideoId = null;
    if (button) button.remove();
    closeSaveModal();
    return;
  }

  if (!button) {
    button = document.createElement('button');
    button.id = 'ytbm-btn';
    button.type = 'button';
    button.textContent = '★ Save';
    button.title = 'Save this YouTube video';
    document.body.appendChild(button);
  }

  button.onclick = () => {
    openSaveModal().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to open save dialog', error);
    });
  };

  if (currentVideoId !== videoId) {
    currentVideoId = videoId;
    updateSaveButtonState().catch((error) => {
      console.error('YouTube Bookmark Manager: failed to refresh save button', error);
    });
  }
}

setInterval(injectButton, 1000);
