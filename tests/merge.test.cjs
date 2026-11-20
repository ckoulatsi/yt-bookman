const test = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../sync.js');

function bookmark(overrides = {}) {
  const item = {
    id: overrides.id || 'bm-1',
    videoId: 'abc123',
    youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
    thumbnail: '',
    title: 'Video',
    channelName: 'Channel',
    channelUrl: 'https://www.youtube.com/@channel',
    category: 'Uncategorized',
    tags: [],
    hasTimestamp: false,
    timestampSeconds: 0,
    notes: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };

  return item;
}

function offline(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseMap(bookmarks) {
  const map = {};
  bookmarks.forEach((item) => {
    map[merge.identityKey(item)] = merge.snapshot(item);
  });
  return map;
}

function plan(options) {
  return merge.planMerge({
    local: [],
    remote: [],
    baseBookmarks: null,
    localTombstones: {},
    remoteTombstones: {},
    ...options,
    now: '2026-06-01T12:00:00.000Z'
  });
}

test('adds bookmarks that only exist on the other machine', () => {
  const remote = bookmark({ id: 'remote-1' });
  const result = plan({ remote: [remote] });

  assert.equal(result.conflicts.length, 0);
  const applied = merge.applyResolutions(result);
  assert.equal(applied.bookmarks.length, 1);
  assert.equal(applied.bookmarks[0].id, 'remote-1');
});

test('takes the changed side when only one side changed since the base', () => {
  const base = bookmark({ title: 'Old title' });
  const local = bookmark({ title: 'Old title' });
  const remote = bookmark({ title: 'New title', updatedAt: '2026-05-01T00:00:00.000Z' });

  const result = plan({
    local: [local],
    remote: [remote],
    baseBookmarks: baseMap([base])
  });

  assert.equal(result.conflicts.length, 0);
  assert.equal(merge.applyResolutions(result).bookmarks[0].title, 'New title');
});

test('flags a field conflict when both sides changed it', () => {
  const base = bookmark({ title: 'Original' });
  const local = bookmark({ title: 'Local edit', updatedAt: '2026-05-02T00:00:00.000Z' });
  const remote = bookmark({ title: 'Remote edit', updatedAt: '2026-05-03T00:00:00.000Z' });

  const result = plan({
    local: [local],
    remote: [remote],
    baseBookmarks: baseMap([base])
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].conflicts.length, 1);
  assert.equal(result.conflicts[0].conflicts[0].field, 'title');

  const resolved = merge.applyResolutions(result, {
    [merge.identityKey(local)]: { fields: { title: 'remote' } }
  });
  assert.equal(resolved.bookmarks[0].title, 'Remote edit');
  assert.notEqual(resolved.bookmarks[0].updatedAt, '2026-05-03T00:00:00.000Z');
});

test('without a base, empty values lose to filled ones', () => {
  const local = bookmark({ notes: '' });
  const remote = bookmark({ notes: 'Watched this twice', updatedAt: '2026-05-03T00:00:00.000Z' });

  const result = plan({ local: [local], remote: [remote] });

  assert.equal(result.conflicts.length, 0);
  assert.equal(merge.applyResolutions(result).bookmarks[0].notes, 'Watched this twice');
});

test('without a base, two different non-empty values conflict', () => {
  const local = bookmark({ notes: 'Mine' });
  const remote = bookmark({ notes: 'Theirs' });

  assert.equal(plan({ local: [local], remote: [remote] }).conflicts.length, 1);
});

test('propagates tag removals and keeps tags added on either side', () => {
  const base = bookmark({ tags: ['kept', 'gone', 'revived'] });
  const local = bookmark({ tags: ['kept', 'revived'] });
  const remote = bookmark({ tags: ['kept', 'extra'] });

  const result = plan({
    local: [local],
    remote: [remote],
    baseBookmarks: baseMap([base])
  });

  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(merge.applyResolutions(result).bookmarks[0].tags, ['extra', 'kept']);
});

test('propagates a delete when the other side did not edit the bookmark', () => {
  const local = bookmark({ title: 'Keep me' });
  const key = merge.identityKey(local);
  const tombstone = { deletedAt: '2026-05-20T10:00:00.000Z', title: 'Keep me', videoId: 'abc123' };

  const result = plan({
    local: [local],
    baseBookmarks: baseMap([local]),
    remoteTombstones: { [key]: tombstone }
  });

  assert.equal(result.conflicts.length, 0);
  const applied = merge.applyResolutions(result);
  assert.equal(applied.bookmarks.length, 0);
  assert.equal(applied.tombstones[key].deletedAt, tombstone.deletedAt);
});

test('asks about a delete that races an edit', () => {
  const local = bookmark({ title: 'Edited here', updatedAt: '2026-05-21T10:00:00.000Z' });
  const key = merge.identityKey(local);
  const tombstone = { deletedAt: '2026-05-20T10:00:00.000Z', title: 'Edited here', videoId: 'abc123' };

  const result = plan({
    local: [local],
    baseBookmarks: baseMap([bookmark({ title: 'Original' })]),
    remoteTombstones: { [key]: tombstone }
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].type, 'delete-conflict');
  assert.equal(result.conflicts[0].deletedSide, 'remote');

  const kept = merge.applyResolutions(result, { [key]: { action: 'keep' } });
  assert.equal(kept.bookmarks.length, 1);
  assert.equal(kept.tombstones[key], undefined);

  const deleted = merge.applyResolutions(result, { [key]: { action: 'delete' } });
  assert.equal(deleted.bookmarks.length, 0);
  assert.equal(deleted.tombstones[key].deletedAt, tombstone.deletedAt);
});

test('a bookmark re-added after a delete survives and drops the tombstone', () => {
  const local = bookmark({ addedAt: '2026-05-25T10:00:00.000Z' });
  const key = merge.identityKey(local);
  const tombstone = { deletedAt: '2026-05-20T10:00:00.000Z', title: 'Video', videoId: 'abc123' };

  const result = plan({ local: [local], remoteTombstones: { [key]: tombstone } });

  assert.equal(result.conflicts.length, 0);
  const applied = merge.applyResolutions(result);
  assert.equal(applied.bookmarks.length, 1);
  assert.equal(applied.tombstones[key], undefined);
});

test('a resolved keep is honoured on the machine that deleted', () => {
  const tombstone = { deletedAt: '2026-05-20T10:00:00.000Z', title: 'Video', videoId: 'abc123' };
  const remote = bookmark({
    title: 'Kept by the other machine',
    updatedAt: '2026-06-02T10:00:00.000Z',
    resurrectedAt: '2026-06-02T10:00:00.000Z'
  });
  const key = merge.identityKey(remote);

  const result = plan({
    local: [],
    remote: [remote],
    localTombstones: { [key]: tombstone },
    baseBookmarks: baseMap([bookmark({ title: 'Original' })])
  });

  assert.equal(result.conflicts.length, 0);
  const applied = merge.applyResolutions(result);
  assert.equal(applied.bookmarks.length, 1);
  assert.equal(applied.tombstones[key], undefined);
});

test('keeping a delete conflict stamps resurrectedAt so it does not bounce back', () => {
  const local = bookmark({ title: 'Edited here', updatedAt: '2026-05-21T10:00:00.000Z' });
  const key = merge.identityKey(local);
  const tombstone = { deletedAt: '2026-05-20T10:00:00.000Z', title: 'Edited here', videoId: 'abc123' };

  const result = plan({
    local: [local],
    baseBookmarks: baseMap([bookmark({ title: 'Original' })]),
    remoteTombstones: { [key]: tombstone }
  });

  const kept = merge.applyResolutions(result, { [key]: { action: 'keep' } });
  assert.ok(kept.bookmarks[0].resurrectedAt);
  assert.equal(kept.tombstones[key], undefined);
});

test('absence in the remote copy never deletes a bookmark', () => {
  const local = bookmark();
  const result = plan({ local: [local], remote: [] });

  assert.equal(merge.applyResolutions(result).bookmarks.length, 1);
});

test('fingerprints are stable and change with the library', () => {
  const first = [bookmark({ tags: ['b', 'a'] })];
  const second = [bookmark({ tags: ['a', 'b'] })];

  assert.equal(merge.fingerprint(first, {}), merge.fingerprint(second, {}));
  assert.notEqual(merge.fingerprint(first, {}), merge.fingerprint([], {}));
});

test('logs additions, removals, edits and conflicts as markdown', () => {
  const local = bookmark({ title: 'Local title', tags: [] });
  const remote = bookmark({ title: 'Remote title' });
  const added = bookmark({ id: 'added', videoId: 'zzz', title: 'Brand new' });
  const key = merge.identityKey(local);

  const result = plan({
    local: [local],
    remote: [remote, added],
    baseBookmarks: baseMap([bookmark({ title: 'Original' })])
  });

  const applied = merge.applyResolutions(result, {
    [key]: { fields: { title: 'remote' } }
  });

  const log = merge.buildLog({
    plan: result,
    resolutions: { [key]: { fields: { title: 'remote' } } },
    beforeBookmarks: [local],
    afterBookmarks: applied.bookmarks,
    beforeTombstones: {},
    afterTombstones: applied.tombstones,
    remoteCount: 2,
    device: { name: 'Home' },
    remoteDevice: { name: 'Office' },
    pushed: true
  });

  assert.equal(log.summary.added, 1);
  assert.equal(log.summary.conflicts, 1);
  assert.equal(log.summary.merged, 2);

  const markdown = merge.toMarkdown(log);
  assert.match(markdown, /# YouTube Bookmark Manager/);
  assert.match(markdown, /Brand new/);
  assert.match(markdown, /Conflicts resolved/);
  assert.match(markdown, /Home/);
  assert.match(markdown, /Office/);
});
