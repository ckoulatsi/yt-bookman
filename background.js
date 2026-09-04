const STORAGE_KEY = 'yt_video_bookmarks';
const SYNC_META_KEY = 'yt_sync_meta';
const SYNC_CHUNK_PREFIX = 'yt_sync_chunk_';
const SYNC_CHUNK_SIZE = 6000;
const SYNC_TOTAL_LIMIT = 95000;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('manager.html')
  });
});

function getSyncChunkKeys(count) {
  return Array.from({ length: count }, (_, index) => `${SYNC_CHUNK_PREFIX}${index}`);
}

function splitIntoChunks(serialized) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = '';
  let currentBytes = 0;

  for (const char of serialized) {
    const charBytes = encoder.encode(char).length;

    if (currentBytes + charBytes > SYNC_CHUNK_SIZE) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function mirrorBookmarksToSync(bookmarks) {
  const serialized = JSON.stringify(Array.isArray(bookmarks) ? bookmarks : []);

  // Keep the existing backup intact when the collection no longer fits;
  // sync storage is a safety net, Export is the full copy.
  if (new TextEncoder().encode(serialized).length > SYNC_TOTAL_LIMIT) {
    console.warn('YouTube Bookmark Manager: collection too large for the sync backup. Use Export to keep a full copy.');
    return;
  }

  const chunks = splitIntoChunks(serialized);
  const data = await chrome.storage.sync.get(SYNC_META_KEY);
  const previousChunks = Number(data[SYNC_META_KEY]?.chunks || 0);

  const update = {
    [SYNC_META_KEY]: {
      chunks: chunks.length,
      updatedAt: new Date().toISOString()
    }
  };
  chunks.forEach((chunk, index) => {
    update[`${SYNC_CHUNK_PREFIX}${index}`] = chunk;
  });

  await chrome.storage.sync.set(update);

  const stale = getSyncChunkKeys(Math.max(previousChunks, chunks.length))
    .filter((key) => !(key in update));
  if (stale.length) {
    await chrome.storage.sync.remove(stale);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) return;

  mirrorBookmarksToSync(changes[STORAGE_KEY].newValue).catch((error) => {
    console.warn('YouTube Bookmark Manager: sync backup failed', error);
  });
});
