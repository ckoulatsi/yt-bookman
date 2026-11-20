const test = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../sync.js');

function bookmark(id, tags, overrides = {}) {
  return {
    id,
    videoId: id,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: '',
    title: `Video ${id}`,
    channelName: '',
    channelUrl: '',
    category: 'Uncategorized',
    tags,
    hasTimestamp: false,
    timestampSeconds: 0,
    notes: '',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '',
    ...overrides
  };
}

function snapshotMap(bookmarks) {
  const map = {};
  bookmarks.forEach((item) => {
    map[merge.identityKey(item)] = merge.snapshot(item);
  });
  return map;
}

test('renames a tag on every bookmark that uses it', () => {
  const bookmarks = [
    bookmark('a', ['devops', 'docker']),
    bookmark('b', ['devops']),
    bookmark('c', ['music'])
  ];

  const result = merge.applyTagRename(bookmarks, 'devops', 'infra', '2026-06-01T00:00:00.000Z');

  assert.equal(result.changed, 2);
  assert.equal(result.mergedInto, false);
  assert.deepEqual(result.bookmarks[0].tags, ['infra', 'docker']);
  assert.deepEqual(result.bookmarks[1].tags, ['infra']);
  assert.deepEqual(result.bookmarks[2].tags, ['music']);
  assert.equal(result.bookmarks[0].updatedAt, '2026-06-01T00:00:00.000Z');
});

test('renaming onto an existing tag merges and keeps one spelling', () => {
  const bookmarks = [
    bookmark('a', ['DevOps', 'ops']),
    bookmark('b', ['DevOps'])
  ];

  const result = merge.applyTagRename(bookmarks, 'ops', 'devops');

  assert.equal(result.mergedInto, true);
  assert.equal(result.target, 'DevOps');
  assert.deepEqual(result.bookmarks[0].tags, ['DevOps']);
});

test('renaming a tag on one bookmark does not duplicate it', () => {
  const result = merge.applyTagRename([bookmark('a', ['a', 'b'])], 'a', 'b');
  assert.deepEqual(result.bookmarks[0].tags, ['b']);
});

test('deleting a tag removes it everywhere and fills the empty case', () => {
  const bookmarks = [
    bookmark('a', ['devops', 'docker']),
    bookmark('b', ['devops'])
  ];

  const result = merge.applyTagRemoval(bookmarks, 'devops', 'generic topic');

  assert.equal(result.changed, 2);
  assert.equal(result.fallbackApplied, 1);
  assert.deepEqual(result.bookmarks[0].tags, ['docker']);
  assert.deepEqual(result.bookmarks[1].tags, ['generic topic']);
});

test('deleting a tag leaves bookmarks that still have other tags alone', () => {
  const result = merge.applyTagRemoval([bookmark('a', ['one', 'two'])], 'one', 'generic topic');
  assert.equal(result.fallbackApplied, 0);
  assert.deepEqual(result.bookmarks[0].tags, ['two']);
});

test('tag renames survive a three-way merge with an unchanged peer', () => {
  const base = [bookmark('a', ['foo', 'keep'])];
  const local = [bookmark('a', ['bar', 'keep'])];
  const remote = [bookmark('a', ['foo', 'keep'])];

  const plan = merge.planMerge({
    local,
    remote,
    baseBookmarks: snapshotMap(base),
    localTombstones: {},
    remoteTombstones: {},
    now: '2026-06-01T00:00:00.000Z'
  });

  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(merge.applyResolutions(plan).bookmarks[0].tags, ['bar', 'keep']);
});

test('tag deletes survive a three-way merge with an unchanged peer', () => {
  const base = [bookmark('a', ['foo', 'keep'])];
  const local = [bookmark('a', ['keep'])];
  const remote = [bookmark('a', ['foo', 'keep'])];

  const plan = merge.planMerge({
    local,
    remote,
    baseBookmarks: snapshotMap(base),
    localTombstones: {},
    remoteTombstones: {},
    now: '2026-06-01T00:00:00.000Z'
  });

  assert.deepEqual(merge.applyResolutions(plan).bookmarks[0].tags, ['keep']);
});

test('without a base, tags from both sides are kept', () => {
  const plan = merge.planMerge({
    local: [bookmark('a', ['mine'])],
    remote: [bookmark('a', ['theirs'])],
    baseBookmarks: null,
    localTombstones: {},
    remoteTombstones: {},
    now: '2026-06-01T00:00:00.000Z'
  });

  assert.deepEqual(merge.applyResolutions(plan).bookmarks[0].tags, ['mine', 'theirs']);
});
