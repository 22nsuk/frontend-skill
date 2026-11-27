'use strict';

// Evaluator-only helper for docs/evaluation.md. Never copy it into the workspace under test.
// Records every entry of a workspace regardless of Git ignore rules, then compares two records.
// Usage:
//   node scripts/eval-workspace-snapshot.js record <workspace> <snapshot.json>
//   node scripts/eval-workspace-snapshot.js compare <before.json> <after.json>
// Exit codes: 0 recorded or no differences, 1 differences listed, 2 error (nothing recorded or compared).
// Compares entry types, file bytes and link targets. Timestamps, permissions and writes that were
// undone before the after record are not observable here.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'eval-workspace-snapshot/1';
const USAGE = [
  'Usage:',
  '  node scripts/eval-workspace-snapshot.js record <workspace> <snapshot.json>',
  '  node scripts/eval-workspace-snapshot.js compare <before.json> <after.json>',
].join('\n');
const foldCase = process.platform === 'win32' || process.platform === 'darwin';

function fail(message, usage = false) {
  throw Object.assign(new Error(message), { usage });
}

function comparable(file) {
  return foldCase ? file.toLowerCase() : file;
}

function contains(root, file) {
  const base = comparable(root);
  const candidate = comparable(file);
  return candidate === base || candidate.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1 << 20);
  // O_NOFOLLOW exists only on POSIX; lstat has already ruled out links on every platform.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let size = 0;
  try {
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0; size += n) {
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { size, sha256: hash.digest('hex') };
}

function assertInPlace(full, rel) {
  // Symlinks and junctions are recorded, never followed. An entry that still resolves elsewhere is
  // some other redirecting reparse point, so stop rather than read content outside the workspace.
  const real = fs.realpathSync.native(full);
  if (comparable(real) !== comparable(full)) {
    fail(`Refusing to read ${JSON.stringify(rel)}: it resolves to ${real}`);
  }
}

function scan(root) {
  const entries = [];
  (function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir)) {
      // Git's own admin state; the evaluator's git add/diff changes it after the run.
      if (!prefix && name === '.git') continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        entries.push({ path: rel, type: 'symlink', target: fs.readlinkSync(full) });
      } else if (stat.isDirectory()) {
        assertInPlace(full, rel);
        entries.push({ path: rel, type: 'dir' });
        walk(full, rel);
      } else if (stat.isFile()) {
        assertInPlace(full, rel);
        entries.push({ path: rel, type: 'file', ...hashFile(full) });
      } else {
        entries.push({ path: rel, type: 'other' });
      }
    }
  })(root, '');
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function record(workspace, snapshotFile) {
  if (!workspace || !fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory()) {
    fail('Expected an existing workspace directory.', true);
  }
  const root = fs.realpathSync.native(workspace);
  const requested = path.resolve(snapshotFile);
  let parent;
  try {
    parent = fs.realpathSync.native(path.dirname(requested));
  } catch {
    fail(`The snapshot directory must already exist: ${path.dirname(requested)}`);
  }
  const target = path.join(parent, path.basename(requested));
  if (contains(root, target)) fail(`Record the snapshot outside the workspace: ${target} is inside ${root}`);
  if (fs.lstatSync(target, { throwIfNoEntry: false })) fail(`Snapshot already exists; choose a new file: ${target}`);

  const recordedAt = new Date().toISOString();
  const entries = scan(root);
  fs.writeFileSync(target, `${JSON.stringify({ format: FORMAT, root, recordedAt, entries }, null, 1)}\n`, { flag: 'wx' });
  console.log(`Recorded ${entries.length} entries from ${root} to ${target}`);
  return 0;
}

function load(file) {
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot read snapshot ${file}: ${error.message}`);
  }
  if (snapshot?.format !== FORMAT || typeof snapshot.root !== 'string' ||
      typeof snapshot.recordedAt !== 'string' || !Array.isArray(snapshot.entries)) {
    fail(`Not a workspace snapshot from this tool: ${file}`);
  }

  const entries = new Map();
  for (const entry of snapshot.entries) {
    if (typeof entry?.path !== 'string' || !entry.path) fail(`Missing entry path in ${file}`);
    if (entries.has(entry.path)) fail(`Duplicate entry path ${JSON.stringify(entry.path)} in ${file}`);
    switch (entry.type) {
      case 'file':
        if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
          fail(`Invalid SHA-256 for ${JSON.stringify(entry.path)} in ${file}`);
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
          fail(`Invalid file size for ${JSON.stringify(entry.path)} in ${file}`);
        }
        entry.sha256 = entry.sha256.toLowerCase();
        break;
      case 'symlink':
        if (typeof entry.target !== 'string') fail(`Missing link target for ${JSON.stringify(entry.path)} in ${file}`);
        break;
      case 'dir':
      case 'other':
        break;
      default:
        fail(`Unknown entry type for ${JSON.stringify(entry.path)} in ${file}`);
    }
    entries.set(entry.path, entry);
  }
  return { root: snapshot.root, recordedAt: snapshot.recordedAt, entries };
}

function compare(beforeFile, afterFile) {
  const before = load(beforeFile);
  const after = load(afterFile);
  if (comparable(before.root) !== comparable(after.root)) {
    fail(`Snapshots come from different workspaces: ${before.root} and ${after.root}`);
  }
  if (!(before.recordedAt < after.recordedAt)) {
    fail('The after snapshot must be a separate record made later than the before snapshot.');
  }

  const old = before.entries;
  const now = after.entries;
  const counts = { added: 0, removed: 0, changed: 0 };
  const report = (kind, entry, detail = '') => {
    counts[kind]++;
    console.log(`${kind} ${entry.type} ${JSON.stringify(entry.path)}${detail}`);
  };
  for (const file of [...new Set([...old.keys(), ...now.keys()])].sort()) {
    const was = old.get(file);
    const is = now.get(file);
    if (!was) report('added', is);
    else if (!is) report('removed', was);
    else if (was.type !== is.type) report('changed', is, ` (was ${was.type})`);
    else if (is.type === 'file' && (was.sha256 !== is.sha256 || was.size !== is.size)) {
      report('changed', is, ` (content, ${was.size} -> ${is.size} bytes)`);
    } else if (is.type === 'symlink' && was.target !== is.target) {
      report('changed', is, ` (target ${JSON.stringify(was.target)} -> ${JSON.stringify(is.target)})`);
    }
  }
  const total = counts.added + counts.removed + counts.changed;
  console.log(total
    ? `${counts.added} added, ${counts.removed} removed, ${counts.changed} changed`
    : 'No differences in entries, file contents or link targets (root .git excluded).');
  return total ? 1 : 0;
}

function main([command, ...args]) {
  if ((command === '--help' || command === '-h') && !args.length) {
    console.log(USAGE);
    return 0;
  }
  if (command === 'record' && args.length === 2) return record(...args);
  if (command === 'compare' && args.length === 2) return compare(...args);
  return fail('Expected record or compare with two paths.', true);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.usage ? `${error.message}\n${USAGE}` : error.message);
  process.exitCode = 2;
}
