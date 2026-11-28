'use strict';

// Evaluator-only helper for docs/evaluation.md. Never copy it into the workspace under test.
// Serves a workspace on 127.0.0.1 and answers POST /api/bookings locally, so booking
// states can be observed without contacting any real service.
// Usage: node docs/eval-stub-server.js <workspace> [--status 201] [--delay 2000] [--port 47613]

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const workspace = args[0];
/**
 * @param {string} message
 * @returns {never}
 */
function usageError(message) {
  console.error(`${message}\nUsage: node docs/eval-stub-server.js <workspace> [--status N] [--delay MS] [--port N]`);
  process.exit(1);
}
if (!workspace?.trim() || workspace.startsWith('--') ||
    !fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory()) {
  usageError('Expected an existing workspace directory.');
}
const root = fs.realpathSync.native(workspace);
const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
/** @type {ReadonlyMap<string, readonly [number, number]>} */
const limits = new Map([
  ['--status', [200, 599]],
  ['--delay', [0, 2147483647]],
  ['--port', [0, 65535]],
]);
/** @type {Map<string, number>} */
const options = new Map();
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  const equals = arg.indexOf('=');
  const flag = equals === -1 ? arg : arg.slice(0, equals);
  const range = limits.get(flag);
  if (!range) usageError(`Unknown argument: ${arg}`);
  if (options.has(flag)) usageError(`Duplicate option: ${flag}`);
  const raw = equals === -1 ? args[++i] : arg.slice(equals + 1);
  const value = Number(raw);
  const [min, max] = range;
  if (!/^\d+$/.test(raw ?? '') || value < min || value > max) {
    usageError(`${flag} expects an integer from ${min} to ${max}.`);
  }
  options.set(flag, value);
}
const status = options.get('--status') ?? 201;
const delay = options.get('--delay') ?? 2000;
const port = options.get('--port') ?? 47613;

/** @type {Readonly<Partial<Record<string, string>>>} */
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};
let bookings = 0;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function handleBooking(req, res) {
  const n = ++bookings;
  console.log(`#${n} POST /api/bookings`);
  /** @type {NodeJS.Timeout | undefined} */
  let responseTimer;
  res.once('finish', () => console.log(`#${n} responded ${res.statusCode}`));
  res.once('close', () => {
    clearTimeout(responseTimer);
    if (!res.writableFinished) console.log(`#${n} disconnected`);
  });
  /**
   * @param {number} code
   * @param {{id: string} | {error: string}} payload
   */
  function respond(code, payload) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }

  const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    req.resume();
    respond(415, { error: 'Expected application/json' });
    return;
  }
  /** @type {Buffer[]} */
  const chunks = [];
  const limit = 64 * 1024;
  let bytes = 0;
  req.on('data', (/** @type {Buffer} */ chunk) => {
    bytes += chunk.length;
    if (bytes <= limit) chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.destroyed) return;
    if (bytes > limit) return respond(413, { error: 'Booking body too large' });
    /** @type {unknown} */
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }
    if (!isJsonObject(payload) || !['name', 'phone', 'date'].every((key) => {
      const value = payload[key];
      return typeof value === 'string' && value.length > 0;
    })) {
      return respond(400, { error: 'Expected name, phone and date as nonempty strings' });
    }
    responseTimer = setTimeout(() => {
      respond(status, status < 400 ? { id: `stub-${n}` } : { error: 'stub failure' });
    }, delay);
  });
}

const server = http.createServer(async (req, res) => {
  // Each run serves a different workspace, often at the same address. Never let the
  // browser reuse a response from an earlier workspace.
  res.setHeader('Cache-Control', 'no-store');
  let url;
  try {
    if (req.url === undefined) throw new Error('Missing request URL');
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    res.writeHead(400).end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    handleBooking(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    console.log(`unexpected ${req.method} ${url.pathname}`);
    res.writeHead(405).end();
    return;
  }

  let file;
  try {
    file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!file.startsWith(rootPrefix)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const target = await fs.promises.realpath(file);
    if (!target.startsWith(rootPrefix)) {
      res.writeHead(403).end();
      return;
    }
    const data = await fs.promises.readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end();
  }
});
server.on('error', (/** @type {NodeJS.ErrnoException} */ error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} on 127.0.0.1 is already in use. Stop the other server or choose another port with --port N (0 picks a free port).`);
  } else {
    console.error(`Cannot start the stub server: ${error.message}`);
  }
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  console.log(`serving ${root} at http://127.0.0.1:${address.port}/ (POST /api/bookings -> ${status} after ${delay} ms)`);
});
