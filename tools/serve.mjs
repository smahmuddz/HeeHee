import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { resolveLibrary } from './library.mjs';

const ROOT = resolve(process.argv[3] || process.cwd());
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.lrc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const candidate = normalize(join(root, decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

function sendJson(res, payload, method) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(method === 'HEAD' ? undefined : body);
}

/**
 * Serve a file with byte-range support.
 *
 * Range support is not optional here: without it the browser cannot seek inside
 * a multi-megabyte mp3, so scrubbing a full-length track silently does nothing.
 */
function sendFile(req, res, path, size) {
  const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  const isMedia = /^(audio|video)\//.test(type);

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m) {
      const total = size;
      let start;
      let end;
      if (m[1] === '' && m[2] !== '') {
        // Suffix range: last N bytes.
        const n = Number(m[2]);
        start = Math.max(0, total - n);
        end = total - 1;
      } else {
        start = m[1] === '' ? 0 : Number(m[1]);
        end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.writeHead(416, { 'content-range': `bytes */${total}`, 'accept-ranges': 'bytes' }).end();
        return;
      }
      const length = end - start + 1;
      res.writeHead(206, {
        'content-type': type,
        'content-length': length,
        'content-range': `bytes ${start}-${end}/${total}`,
        'accept-ranges': 'bytes',
        'cache-control': isMedia ? 'public, max-age=3600' : 'no-cache'
      });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(path, { start, end }).pipe(res).on('error', () => res.destroy());
      return;
    }
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'accept-ranges': 'bytes',
    'cache-control': isMedia ? 'public, max-age=3600' : 'no-cache, no-store, must-revalidate'
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(path).pipe(res).on('error', () => res.destroy());
}

const server = createServer(async (req, res) => {
  try {
    const route = (req.url || '/').split('?')[0];

    // Live-resolved playable catalog: the knowledge base intersected with the
    // audio files on disk, so dropping in a new mp3 and reloading is enough.
    if (route === '/library.json') {
      sendJson(res, await resolveLibrary(ROOT), req.method);
      return;
    }

    let target = safeJoin(ROOT, req.url || '/');
    if (!target) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found');
      return;
    }

    sendFile(req, res, target, info.size);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('500 ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`HeeHee running at http://localhost:${PORT}/`);
});
