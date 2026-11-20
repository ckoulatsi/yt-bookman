/**
 * Merge engine for YouTube Bookmark Manager.
 *
 * Pure functions only: no DOM, no chrome.* calls. manager.js feeds it the
 * local library, the copy from the gist and the last synced base snapshot,
 * then asks for a plan. A plan either merges cleanly or lists conflicts that
 * the dashboard resolves field by field.
 */
(function (root) {
  'use strict';

  const SCALAR_FIELDS = [
    'title',
    'category',
    'notes',
    'channelName',
    'channelUrl',
    'youtubeUrl',
    'thumbnail'
  ];

  const SNAPSHOT_FIELDS = [
    'videoId',
    'hasTimestamp',
    'timestampSeconds',
    'title',
    'category',
    'notes',
    'channelName',
    'channelUrl',
    'youtubeUrl',
    'thumbnail'
  ];

  const FIELD_LABELS = {
    title: 'Title',
    category: 'Category',
    notes: 'Notes',
    tags: 'Tags',
    channelName: 'Channel',
    channelUrl: 'Channel URL',
    youtubeUrl: 'URL',
    thumbnail: 'Thumbnail',
    videoId: 'Video ID',
    hasTimestamp: 'Timestamp',
    timestampSeconds: 'Timestamp seconds'
  };

  // A tombstone older than this is dropped; devices that were offline for a
  // year may resurrect a few deletes, which is preferable to unbounded growth.
  const TOMBSTONE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  function identityKey(bookmark) {
    const item = bookmark || {};
    if (item.videoId) {
      return `${item.videoId}|${item.hasTimestamp ? item.timestampSeconds : 'video'}`;
    }

    return `id:${item.id || ''}`;
  }

  function toTime(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function activityTime(bookmark) {
    return Math.max(toTime(bookmark && bookmark.updatedAt), toTime(bookmark && bookmark.addedAt));
  }

  function nowIso(now) {
    return new Date(now || Date.now()).toISOString();
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (left === undefined && right === '') return true;
    if (right === undefined && left === '') return true;
    return false;
  }

  function isEmptyValue(value) {
    return value === undefined || value === null || String(value).trim() === '';
  }

  function tagList(tags) {
    const source = Array.isArray(tags) ? tags : String(tags || '').split(',');
    const unique = new Set();

    source.forEach((tag) => {
      const value = String(tag || '').trim();
      if (value) unique.add(value);
    });

    return [...unique].sort((a, b) => a.localeCompare(b));
  }

  function sameTagSet(left, right) {
    const a = tagList(left);
    const b = tagList(right);
    return a.length === b.length && a.every((tag, index) => tag === b[index]);
  }

  function snapshot(bookmark) {
    const item = bookmark || {};
    const snap = {};

    SNAPSHOT_FIELDS.forEach((field) => {
      snap[field] = item[field];
    });

    snap.hasTimestamp = Boolean(item.hasTimestamp);
    snap.timestampSeconds = Number(item.timestampSeconds) || 0;
    snap.videoId = item.videoId || '';
    snap.tags = tagList(item.tags);
    snap.addedAt = item.addedAt || '';

    return snap;
  }

  function snapshotEquals(left, right) {
    if (!left || !right) return false;

    return SNAPSHOT_FIELDS.every((field) => sameValue(left[field], right[field]))
      && sameTagSet(left.tags, right.tags);
  }

  function earliestDate(values) {
    const times = values.map(toTime).filter((time) => time > 0);
    if (!times.length) return '';
    return new Date(Math.min(...times)).toISOString();
  }

  function mergeScalar(localValue, remoteValue, baseValue, hasBase) {
    if (sameValue(localValue, remoteValue)) {
      return { value: localValue, conflict: false };
    }

    if (hasBase) {
      const localChanged = !sameValue(localValue, baseValue);
      const remoteChanged = !sameValue(remoteValue, baseValue);

      if (localChanged && !remoteChanged) return { value: localValue, conflict: false };
      if (!localChanged && remoteChanged) return { value: remoteValue, conflict: false };

      return { value: localValue, conflict: true };
    }

    // First merge without a base snapshot: prefer the side that actually has
    // content, because an empty field usually means "never filled in".
    if (isEmptyValue(localValue) && !isEmptyValue(remoteValue)) {
      return { value: remoteValue, conflict: false };
    }

    if (isEmptyValue(remoteValue) && !isEmptyValue(localValue)) {
      return { value: localValue, conflict: false };
    }

    return { value: localValue, conflict: true };
  }

  function mergeTags(localTags, remoteTags, baseTags) {
    const local = new Set(tagList(localTags));
    const remote = new Set(tagList(remoteTags));
    const base = new Set(tagList(baseTags || []));
    const merged = new Set([...local, ...remote]);

    // A tag removed on both sides stays removed; a tag removed on one side
    // survives, which is the lossless choice and avoids tag-level conflicts.
    base.forEach((tag) => {
      if (!local.has(tag) && !remote.has(tag)) merged.delete(tag);
    });

    return [...merged].sort((a, b) => a.localeCompare(b));
  }

  function mergePair(local, remote, baseSnapshot, stamp) {
    const hasBase = Boolean(baseSnapshot);
    const merged = { ...local };
    const conflicts = [];

    SCALAR_FIELDS.forEach((field) => {
      const baseValue = hasBase ? baseSnapshot[field] : undefined;
      const result = mergeScalar(local[field], remote[field], baseValue, hasBase);
      merged[field] = result.value;

      if (result.conflict) {
        conflicts.push({
          field,
          label: FIELD_LABELS[field] || field,
          local: local[field],
          remote: remote[field],
          base: baseValue,
          hasBase
        });
      }
    });

    merged.tags = mergeTags(local.tags, remote.tags, hasBase ? baseSnapshot.tags : null);
    merged.videoId = local.videoId || remote.videoId || (hasBase ? baseSnapshot.videoId : '');
    merged.hasTimestamp = Boolean(local.hasTimestamp);
    merged.timestampSeconds = Number(local.timestampSeconds) || 0;
    merged.id = local.id || remote.id || (hasBase ? baseSnapshot.id : '') || identityKey(local);
    merged.addedAt = earliestDate([local.addedAt, remote.addedAt, hasBase ? baseSnapshot.addedAt : '']) || stamp;

    const changedFromLocal = !snapshotEquals(snapshot(merged), snapshot(local));
    if (changedFromLocal) {
      merged.updatedAt = stamp;
    } else {
      const newest = Math.max(toTime(local.updatedAt), toTime(remote.updatedAt), toTime(local.addedAt), toTime(remote.addedAt));
      merged.updatedAt = newest ? new Date(newest).toISOString() : stamp;
    }

    return { bookmark: merged, conflicts };
  }

  function normalizeTombstone(value, key) {
    if (!value) return null;

    const deletedAt = value.deletedAt || value.at || '';
    if (!toTime(deletedAt)) return null;

    return {
      key,
      deletedAt,
      title: value.title || '',
      videoId: value.videoId || '',
      hasTimestamp: Boolean(value.hasTimestamp),
      timestampSeconds: Number(value.timestampSeconds) || 0
    };
  }

  function tombstoneFor(bookmark, deletedAt) {
    return {
      deletedAt: deletedAt || nowIso(),
      title: bookmark.title || '',
      videoId: bookmark.videoId || '',
      hasTimestamp: Boolean(bookmark.hasTimestamp),
      timestampSeconds: Number(bookmark.timestampSeconds) || 0
    };
  }

  function mapByIdentity(bookmarks) {
    const map = new Map();
    (Array.isArray(bookmarks) ? bookmarks : []).forEach((bookmark) => {
      if (!bookmark) return;
      map.set(identityKey(bookmark), bookmark);
    });
    return map;
  }

  /**
   * Work out what the merged library should look like.
   *
   * options:
   *   local, remote        arrays of normalized bookmarks
   *   baseBookmarks        map of identityKey -> snapshot from the last sync (or null)
   *   baseTombstones       tombstones recorded at the last sync
   *   localTombstones      tombstones this device currently holds
   *   remoteTombstones     tombstones from the gist
   */
  function planMerge(options) {
    const local = Array.isArray(options.local) ? options.local : [];
    const remote = Array.isArray(options.remote) ? options.remote : [];
    const baseBookmarks = options.baseBookmarks || null;
    const localTombstones = options.localTombstones || {};
    const remoteTombstones = options.remoteTombstones || {};
    const baseTombstones = options.baseTombstones || {};
    const stamp = nowIso(options.now);

    const localMap = mapByIdentity(local);
    const remoteMap = mapByIdentity(remote);
    const baseMap = baseBookmarks || {};

    const keys = new Set([
      ...localMap.keys(),
      ...remoteMap.keys(),
      ...Object.keys(baseMap),
      ...Object.keys(localTombstones),
      ...Object.keys(remoteTombstones),
      ...Object.keys(baseTombstones)
    ]);

    const entries = [];
    const conflicts = [];
    const tombstones = {};

    keys.forEach((key) => {
      const localBookmark = localMap.get(key) || null;
      const remoteBookmark = remoteMap.get(key) || null;
      const baseSnapshot = baseMap[key] || null;

      let localTombstone = normalizeTombstone(localTombstones[key], key);
      let remoteTombstone = normalizeTombstone(remoteTombstones[key], key);

      // A bookmark that exists next to its own tombstone was re-added; the
      // tombstone is stale and must not delete it.
      if (localTombstone && localBookmark && activityTime(localBookmark) >= toTime(localTombstone.deletedAt)) {
        localTombstone = null;
      }
      if (remoteTombstone && remoteBookmark && activityTime(remoteBookmark) >= toTime(remoteTombstone.deletedAt)) {
        remoteTombstone = null;
      }

      if (localTombstone && remoteTombstone) {
        entries.push({ key, type: 'deleted', tombstone: newerTombstone(localTombstone, remoteTombstone) });
        tombstones[key] = newerTombstone(localTombstone, remoteTombstone);
        return;
      }

      if (localTombstone) {
        if (!remoteBookmark) {
          entries.push({ key, type: 'deleted', tombstone: localTombstone });
          tombstones[key] = localTombstone;
          return;
        }

        // The other machine already resolved this delete by keeping the
        // bookmark; honour that instead of asking again.
        if (isResurrected(remoteBookmark, localTombstone)) {
          entries.push({ key, type: 'bookmark', bookmark: remoteBookmark, conflicts: [], resurrected: true });
          return;
        }

        if (toTime(remoteBookmark.addedAt) > toTime(localTombstone.deletedAt)) {
          entries.push({ key, type: 'bookmark', bookmark: remoteBookmark, conflicts: [], resurrected: true });
          return;
        }

        if (remoteUnchanged(remoteBookmark, baseSnapshot) || activityTime(remoteBookmark) <= toTime(localTombstone.deletedAt)) {
          entries.push({ key, type: 'deleted', tombstone: localTombstone });
          tombstones[key] = localTombstone;
          return;
        }

        const conflict = {
          key,
          type: 'delete-conflict',
          deletedSide: 'local',
          bookmark: remoteBookmark,
          tombstone: localTombstone,
          editedAt: new Date(activityTime(remoteBookmark) || Date.now()).toISOString(),
          deletedAt: localTombstone.deletedAt
        };
        entries.push(conflict);
        conflicts.push(conflict);
        return;
      }

      if (remoteTombstone) {
        if (!localBookmark) {
          entries.push({ key, type: 'deleted', tombstone: remoteTombstone });
          tombstones[key] = remoteTombstone;
          return;
        }

        if (isResurrected(localBookmark, remoteTombstone)) {
          entries.push({ key, type: 'bookmark', bookmark: localBookmark, conflicts: [], resurrected: true });
          return;
        }

        if (toTime(localBookmark.addedAt) > toTime(remoteTombstone.deletedAt)) {
          entries.push({ key, type: 'bookmark', bookmark: localBookmark, conflicts: [], resurrected: true });
          return;
        }

        if (localUnchanged(localBookmark, baseSnapshot) || activityTime(localBookmark) <= toTime(remoteTombstone.deletedAt)) {
          entries.push({ key, type: 'deleted', tombstone: remoteTombstone });
          tombstones[key] = remoteTombstone;
          return;
        }

        const conflict = {
          key,
          type: 'delete-conflict',
          deletedSide: 'remote',
          bookmark: localBookmark,
          tombstone: remoteTombstone,
          editedAt: new Date(activityTime(localBookmark) || Date.now()).toISOString(),
          deletedAt: remoteTombstone.deletedAt
        };
        entries.push(conflict);
        conflicts.push(conflict);
        return;
      }

      if (localBookmark && remoteBookmark) {
        const merged = mergePair(localBookmark, remoteBookmark, baseSnapshot, stamp);

        if (merged.conflicts.length) {
          const conflict = {
            key,
            type: 'bookmark',
            bookmark: merged.bookmark,
            local: localBookmark,
            remote: remoteBookmark,
            base: baseSnapshot,
            conflicts: merged.conflicts
          };
          entries.push(conflict);
          conflicts.push(conflict);
          return;
        }

        entries.push({
          key,
          type: 'bookmark',
          bookmark: merged.bookmark,
          local: localBookmark,
          remote: remoteBookmark,
          base: baseSnapshot,
          conflicts: []
        });
        return;
      }

      if (localBookmark) {
        // No remote copy and no tombstone: absence is not a deletion signal.
        entries.push({ key, type: 'bookmark', bookmark: localBookmark, conflicts: [], localOnly: true });
        return;
      }

      if (remoteBookmark) {
        entries.push({ key, type: 'bookmark', bookmark: remoteBookmark, conflicts: [], remoteOnly: true });
        return;
      }

      // Only the base remembers it and neither side kept a tombstone, which
      // means an older client dropped it without recording the delete.
      if (baseSnapshot) {
        const tombstone = {
          key,
          deletedAt: stamp,
          title: baseSnapshot.title || '',
          videoId: baseSnapshot.videoId || '',
          hasTimestamp: Boolean(baseSnapshot.hasTimestamp),
          timestampSeconds: Number(baseSnapshot.timestampSeconds) || 0
        };
        entries.push({ key, type: 'deleted', tombstone });
        tombstones[key] = tombstone;
      }
    });

    return {
      entries,
      conflicts,
      tombstones: pruneTombstones(tombstones, options.now),
      stats: {
        localCount: local.length,
        remoteCount: remote.length,
        baseCount: Object.keys(baseMap).length
      }
    };
  }

  function newerTombstone(left, right) {
    return toTime(left.deletedAt) >= toTime(right.deletedAt) ? left : right;
  }

  function isResurrected(bookmark, tombstone) {
    return Boolean(
      bookmark
      && bookmark.resurrectedAt
      && tombstone
      && toTime(bookmark.resurrectedAt) > toTime(tombstone.deletedAt)
    );
  }

  function remoteUnchanged(bookmark, baseSnapshot) {
    return Boolean(baseSnapshot) && snapshotEquals(snapshot(bookmark), baseSnapshot);
  }

  function localUnchanged(bookmark, baseSnapshot) {
    return Boolean(baseSnapshot) && snapshotEquals(snapshot(bookmark), baseSnapshot);
  }

  /**
   * Turn a plan into the final library. Resolutions are keyed by bookmark:
   *   { [key]: { fields: { title: 'local' | 'remote' }, action: 'keep' | 'delete' } }
   * Missing field choices fall back to 'local'; missing delete actions keep
   * the bookmark, which is the non-destructive default.
   */
  function applyResolutions(plan, resolutions) {
    const stamp = nowIso();
    const bookmarks = [];
    const tombstones = { ...(plan.tombstones || {}) };
    const picked = resolutions || {};

    plan.entries.forEach((entry) => {
      if (entry.type === 'bookmark') {
        let bookmark = entry.bookmark;

        if (entry.conflicts && entry.conflicts.length) {
          const choices = (picked[entry.key] && picked[entry.key].fields) || {};
          const next = { ...bookmark };
          let changed = false;

          entry.conflicts.forEach((conflict) => {
            const value = choices[conflict.field] === 'remote' ? conflict.remote : conflict.local;
            if (!sameValue(next[conflict.field], value)) {
              next[conflict.field] = value;
              changed = true;
            }
          });

          if (changed) next.updatedAt = stamp;
          bookmark = next;
        }

        delete tombstones[entry.key];
        bookmarks.push(bookmark);
        return;
      }

      if (entry.type === 'deleted') {
        tombstones[entry.key] = entry.tombstone;
        return;
      }

      if (entry.type === 'delete-conflict') {
        const action = picked[entry.key] && picked[entry.key].action === 'delete' ? 'delete' : 'keep';

        if (action === 'delete') {
          tombstones[entry.key] = entry.tombstone;
          return;
        }

        delete tombstones[entry.key];
        bookmarks.push({ ...entry.bookmark, updatedAt: stamp, resurrectedAt: stamp });
      }
    });

    bookmarks.sort((left, right) => toTime(right.addedAt) - toTime(left.addedAt));

    return { bookmarks, tombstones };
  }

  function pruneTombstones(tombstones, now) {
    const limit = (now ? new Date(now).getTime() : Date.now()) - TOMBSTONE_MAX_AGE_MS;
    const kept = {};

    Object.entries(tombstones || {}).forEach(([key, value]) => {
      if (!value || !toTime(value.deletedAt)) return;
      if (toTime(value.deletedAt) >= limit) kept[key] = value;
    });

    return kept;
  }

  function diffBookmarks(before, after) {
    const changes = [];

    SCALAR_FIELDS.forEach((field) => {
      if (!sameValue(before[field], after[field])) {
        changes.push({
          field,
          label: FIELD_LABELS[field] || field,
          from: before[field],
          to: after[field]
        });
      }
    });

    if (!sameTagSet(before.tags, after.tags)) {
      changes.push({
        field: 'tags',
        label: FIELD_LABELS.tags,
        from: tagList(before.tags),
        to: tagList(after.tags)
      });
    }

    return changes;
  }

  function buildLog(options) {
    const beforeMap = mapByIdentity(options.beforeBookmarks);
    const afterMap = mapByIdentity(options.afterBookmarks);
    const beforeTombstones = options.beforeTombstones || {};
    const afterTombstones = options.afterTombstones || {};
    const plan = options.plan;
    const resolutions = options.resolutions || {};

    const added = [];
    const removed = [];
    const changed = [];

    afterMap.forEach((bookmark, key) => {
      if (!beforeMap.has(key)) {
        added.push({
          key,
          title: bookmark.title || 'Untitled video',
          category: bookmark.category || '',
          url: bookmark.youtubeUrl || '',
          addedAt: bookmark.addedAt || ''
        });
        return;
      }

      const diffs = diffBookmarks(beforeMap.get(key), bookmark);
      if (diffs.length) {
        changed.push({
          key,
          title: bookmark.title || 'Untitled video',
          url: bookmark.youtubeUrl || '',
          fields: diffs
        });
      }
    });

    beforeMap.forEach((bookmark, key) => {
      if (afterMap.has(key)) return;

      const tombstone = afterTombstones[key] || beforeTombstones[key] || {};
      removed.push({
        key,
        title: bookmark.title || tombstone.title || 'Untitled video',
        url: bookmark.youtubeUrl || '',
        deletedAt: tombstone.deletedAt || '',
        deletedHere: Boolean(beforeTombstones[key]),
        deletedElsewhere: Boolean(afterTombstones[key] && !beforeTombstones[key])
      });
    });

    const conflictLog = (plan.conflicts || []).map((conflict) => {
      if (conflict.type === 'delete-conflict') {
        const choice = (resolutions[conflict.key] && resolutions[conflict.key].action) || 'keep';
        return {
          key: conflict.key,
          kind: 'delete-vs-edit',
          title: conflict.bookmark.title || 'Untitled video',
          url: conflict.bookmark.youtubeUrl || '',
          deletedSide: conflict.deletedSide,
          deletedAt: conflict.deletedAt,
          editedAt: conflict.editedAt,
          action: choice
        };
      }

      return {
        key: conflict.key,
        kind: 'fields',
        title: conflict.bookmark.title || 'Untitled video',
        url: conflict.bookmark.youtubeUrl || '',
        fields: conflict.conflicts.map((field) => ({
          field: field.field,
          label: field.label,
          local: field.local,
          remote: field.remote,
          base: field.base,
          hasBase: field.hasBase,
          chosen: (resolutions[conflict.key] && resolutions[conflict.key].fields
            && resolutions[conflict.key].fields[field.field]) || 'local'
        }))
      };
    });

    const log = {
      kind: 'yt-bookmarks-merge-log',
      generatedAt: nowIso(),
      trigger: options.trigger || 'manual',
      device: options.device || { name: 'This device' },
      remoteDevice: options.remoteDevice || { name: 'Other device' },
      gist: options.gist || {},
      summary: {
        localBefore: beforeMap.size,
        remoteBefore: options.remoteCount || 0,
        merged: afterMap.size,
        added: added.length,
        removed: removed.length,
        changed: changed.length,
        conflicts: conflictLog.length,
        conflictsResolved: conflictLog.length,
        pushed: Boolean(options.pushed),
        pushFailed: Boolean(options.pushError)
      },
      added,
      removed,
      changed,
      conflicts: conflictLog,
      warnings: Array.isArray(options.warnings) ? options.warnings.slice() : []
    };

    if (options.pushError) log.warnings.push(`Push to the gist failed: ${options.pushError}`);

    return log;
  }

  function formatLogValue(value, field) {
    if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
    if (field === 'hasTimestamp') return value ? 'yes' : 'no';
    if (value === undefined || value === null || value === '') return '(empty)';
    return String(value);
  }

  function toMarkdown(log) {
    const lines = [];
    const when = new Date(log.generatedAt);
    const summary = log.summary;

    lines.push('# YouTube Bookmark Manager — merge log');
    lines.push('');
    lines.push(`Generated: ${when.toLocaleString()}`);
    lines.push(`Trigger: ${log.trigger === 'auto' ? 'automatic (manager opened)' : log.trigger === 'change' ? 'automatic (bookmark changed)' : 'manual'}`);
    lines.push(`This device: ${log.device && log.device.name ? log.device.name : 'This device'}`);
    lines.push(`Other device: ${log.remoteDevice && log.remoteDevice.name ? log.remoteDevice.name : 'Other device'}`);
    if (log.gist && log.gist.id) {
      lines.push(`Gist: ${log.gist.id}${log.gist.revision ? ` (revision ${log.gist.revision})` : ''}`);
    }
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Bookmarks here before: ${summary.localBefore}`);
    lines.push(`- Bookmarks in the gist: ${summary.remoteBefore}`);
    lines.push(`- Bookmarks after merge: ${summary.merged}`);
    lines.push(`- Added here: ${summary.added}`);
    lines.push(`- Removed here: ${summary.removed}`);
    lines.push(`- Updated here: ${summary.changed}`);
    lines.push(`- Conflicts: ${summary.conflicts}`);
    lines.push(`- Pushed to gist: ${summary.pushed ? 'yes' : summary.pushFailed ? 'failed' : 'not needed'}`);
    lines.push('');

    if (log.added.length) {
      lines.push('## Added on this device');
      lines.push('');
      log.added.forEach((item) => {
        lines.push(`- [${item.category || 'Uncategorized'}] ${item.title}${item.url ? ` — ${item.url}` : ''}`);
      });
      lines.push('');
    }

    if (log.removed.length) {
      lines.push('## Removed on this device');
      lines.push('');
      log.removed.forEach((item) => {
        const where = item.deletedHere ? 'deleted here' : 'deleted on the other device';
        const at = item.deletedAt ? ` at ${new Date(item.deletedAt).toLocaleString()}` : '';
        lines.push(`- ${item.title} — ${where}${at}`);
      });
      lines.push('');
    }

    if (log.changed.length) {
      lines.push('## Updated on this device');
      lines.push('');
      log.changed.forEach((item) => {
        lines.push(`- ${item.title}`);
        item.fields.forEach((field) => {
          lines.push(`  - ${field.label}: ${formatLogValue(field.from, field.field)} → ${formatLogValue(field.to, field.field)}`);
        });
      });
      lines.push('');
    }

    if (log.conflicts.length) {
      lines.push('## Conflicts resolved');
      lines.push('');
      log.conflicts.forEach((conflict) => {
        lines.push(`### ${conflict.title}`);
        lines.push('');

        if (conflict.kind === 'delete-vs-edit') {
          const deletedOn = conflict.deletedSide === 'local' ? 'this device' : 'the other device';
          const keptOn = conflict.deletedSide === 'local' ? 'the other device' : 'this device';
          lines.push(`- Deleted on ${deletedOn} ${conflict.deletedAt ? `at ${new Date(conflict.deletedAt).toLocaleString()}` : ''}`);
          lines.push(`- Edited on ${keptOn} ${conflict.editedAt ? `at ${new Date(conflict.editedAt).toLocaleString()}` : ''}`);
          lines.push(`- Kept: ${conflict.action === 'delete' ? 'deleted everywhere' : 'the edited bookmark'}`);
        } else {
          conflict.fields.forEach((field) => {
            lines.push(`- ${field.label}: kept ${field.chosen === 'remote' ? 'the other device' : 'this device'} value "${formatLogValue(field.chosen === 'remote' ? field.remote : field.local, field.field)}" (dropped "${formatLogValue(field.chosen === 'remote' ? field.local : field.remote, field.field)}")`);
          });
        }

        lines.push('');
      });
    }

    if (log.warnings && log.warnings.length) {
      lines.push('## Warnings');
      lines.push('');
      log.warnings.forEach((warning) => {
        lines.push(`- ${warning}`);
      });
      lines.push('');
    }

    if (!summary.added && !summary.removed && !summary.changed && !summary.conflicts) {
      lines.push(summary.pushed
        ? 'No local changes; the merged copy was pushed to the gist.'
        : 'No bookmark changes were needed for this sync.');
      lines.push('');
    }

    return lines.join('\n');
  }

  function hashString(input) {
    let hash = 2166136261;
    const text = String(input || '');

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  }

  function fingerprint(bookmarks, tombstones) {
    const items = (Array.isArray(bookmarks) ? bookmarks : []).map((bookmark) => {
      const snap = snapshot(bookmark);
      return `${identityKey(bookmark)}|${JSON.stringify(snap)}`;
    }).sort();

    const graves = Object.entries(tombstones || {}).map(([key, value]) => `${key}|${value.deletedAt || ''}`).sort();

    return hashString(items.join('\n') + '\n--\n' + graves.join('\n'));
  }

  const api = {
    FIELD_LABELS,
    SCALAR_FIELDS,
    identityKey,
    tagList,
    snapshot,
    snapshotEquals,
    planMerge,
    applyResolutions,
    pruneTombstones,
    tombstoneFor,
    normalizeTombstone,
    buildLog,
    toMarkdown,
    fingerprint,
    diffBookmarks,
    activityTime,
    toTime
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.YTBMerge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
