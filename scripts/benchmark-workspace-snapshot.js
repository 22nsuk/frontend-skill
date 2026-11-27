'use strict';

// Run from a quiet machine with a prebuilt release binary; preparation and checks are untimed.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

if (process.argv.length !== 3) {
  console.error('Usage: node scripts/benchmark-workspace-snapshot.js <Rust release executable>');
  process.exit(2);
}
const rust = path.resolve(process.argv[2]);
const warmups = 3;
const samples = 15;

function run(args) {
  const start = performance.now();
  const res = spawnSync(rust, args, { encoding: 'utf8' });
  const elapsed = performance.now() - start;
  if (res.error) throw res.error;
  assert.equal(res.status, 0, res.stderr);
  return { elapsed, stdout: res.stdout };
}

function readRecord(file) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(new Date(record.recordedAt).toISOString(), record.recordedAt);
  return record;
}

function measure(workspace, evidence) {
  const first = path.join(evidence, 'before.json');
  const last = path.join(evidence, 'after.json');
  run(['record', workspace, first]);
  const baseline = readRecord(first);
  // Both comparison inputs describe the same tree. Fix the second timestamp so even
  // sub-millisecond startup cannot produce the same v1 timestamp in this benchmark.
  const later = new Date(Date.parse(baseline.recordedAt) + 1).toISOString();
  fs.writeFileSync(last, JSON.stringify({ ...baseline, recordedAt: later }, null, 1) + '\n');
  const target = path.join(evidence, 'sample.json');
  const times = { record: [], compare: [] };
  for (let i = 0; i < warmups + samples; i++) {
    const record = run(['record', workspace, target]);
    const sample = readRecord(target);
    assert.deepEqual(sample, { ...baseline, recordedAt: sample.recordedAt });
    fs.unlinkSync(target);
    const compare = run(['compare', first, last]);
    assert.match(compare.stdout, /^No differences /);
    if (i >= warmups) {
      times.record.push(record.elapsed);
      times.compare.push(compare.elapsed);
    }
  }
  console.log(path.basename(workspace) + ' (' + baseline.entries.length + ' entries)');
  for (const [command, values] of Object.entries(times)) {
    const median = values.sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log('Rust ' + command + ': ' + median.toFixed(2) + ' ms');
  }
  fs.unlinkSync(first);
  fs.unlinkSync(last);
}

const tempRoot = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'snapshot-benchmark-'));
try {
  const fixture = path.join(temp, 'eval-fixture');
  fs.cpSync(path.join(__dirname, '../docs/eval-fixture'), fixture, { recursive: true });
  const generated = path.join(temp, 'generated');
  const block = Buffer.alloc(4096, 0x61);
  for (let dir = 0; dir < 10; dir++) {
    const group = path.join(generated, String(dir));
    fs.mkdirSync(group, { recursive: true });
    for (let n = 0; n < 100; n++) fs.writeFileSync(path.join(group, n + '.bin'), block);
  }
  fs.writeFileSync(path.join(generated, 'large.bin'), Buffer.alloc(16 * 1024 * 1024, 0x62));
  console.log(process.platform, process.arch, 'Node benchmark driver ' + process.version,
    samples + ' runs after ' + warmups + ' warmups');
  measure(fixture, temp);
  measure(generated, temp);
} finally {
  assert.equal(path.dirname(fs.realpathSync.native(temp)), tempRoot);
  fs.rmSync(temp, { recursive: true, force: true });
}
