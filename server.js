const http = require('http');
const fs = require('fs');
const path = require('path');

const SHORT_TERM_DIR = path.join(process.env.HOME, '.claude', 'plans');
const LONG_TERM_DIR = path.join(process.env.HOME, '.claude', 'longterm-plans');
const PORT = 3333;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: List plans
  if (req.method === 'GET' && url.pathname === '/api/plans') {
    const getPlansFromDir = (dir, type) => {
      try {
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
          .filter(f => f.endsWith('.md'))
          .map(f => {
            const stats = fs.statSync(path.join(dir, f));
            return {
              name: f.replace('.md', ''),
              filename: f,
              modified: stats.mtime,
              type
            };
          })
          .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      } catch { return []; }
    };

    const result = {
      longTerm: getPlansFromDir(LONG_TERM_DIR, 'long-term'),
      shortTerm: getPlansFromDir(SHORT_TERM_DIR, 'short-term')
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: Search plans by title and content
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();

    const searchDir = (dir, type) => {
      if (!q || !fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const filepath = path.join(dir, f);
          const name = f.replace('.md', '');
          const titleMatch = name.toLowerCase().includes(q);
          let content = '';
          try { content = fs.readFileSync(filepath, 'utf8'); } catch { return null; }
          const idx = content.toLowerCase().indexOf(q);
          const contentMatch = idx !== -1;
          if (!titleMatch && !contentMatch) return null;

          let snippet = null;
          if (contentMatch) {
            const lineStart = content.lastIndexOf('\n', idx) + 1;
            let lineEnd = content.indexOf('\n', idx);
            if (lineEnd === -1) lineEnd = content.length;
            const line = content.slice(lineStart, lineEnd);
            const rel = idx - lineStart;
            const start = Math.max(0, rel - 50);
            const end = Math.min(line.length, rel + q.length + 70);
            snippet = (start > 0 ? '…' : '') + line.slice(start, end).trim() + (end < line.length ? '…' : '');
          }

          const stats = fs.statSync(filepath);
          return { name, filename: f, type, modified: stats.mtime, titleMatch, contentMatch, snippet };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      longTerm: searchDir(LONG_TERM_DIR, 'long-term'),
      shortTerm: searchDir(SHORT_TERM_DIR, 'short-term')
    }));
    return;
  }

  // API: Move plans between short-term and long-term
  if (req.method === 'POST' && url.pathname === '/api/plans/move') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { plans } = JSON.parse(body);
        const results = plans.map(({ filename, type }) => {
          const fromDir = type === 'long-term' ? LONG_TERM_DIR : SHORT_TERM_DIR;
          const toDir = type === 'long-term' ? SHORT_TERM_DIR : LONG_TERM_DIR;
          const fromPath = path.join(fromDir, filename);
          const toPath = path.join(toDir, filename);
          if (!fromPath.startsWith(fromDir) || !toPath.startsWith(toDir)) {
            return { filename, error: 'Forbidden' };
          }
          try {
            if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
            if (fs.existsSync(toPath)) return { filename, error: 'Destination already exists' };
            try {
              fs.renameSync(fromPath, toPath);
            } catch (err) {
              if (err.code === 'EXDEV') {
                fs.copyFileSync(fromPath, toPath);
                fs.unlinkSync(fromPath);
              } else {
                throw err;
              }
            }
            return { filename, moved: true, newType: type === 'long-term' ? 'short-term' : 'long-term' };
          } catch (err) {
            return { filename, error: err.message };
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // API: Delete plans
  if (req.method === 'DELETE' && url.pathname === '/api/plans') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { plans } = JSON.parse(body);
        const results = plans.map(({ filename, type }) => {
          const dir = type === 'long-term' ? LONG_TERM_DIR : SHORT_TERM_DIR;
          const filepath = path.join(dir, filename);
          if (!filepath.startsWith(dir)) return { filename, error: 'Forbidden' };
          try {
            fs.unlinkSync(filepath);
            return { filename, deleted: true };
          } catch (err) {
            return { filename, error: err.message };
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // API: Get single plan
  if (url.pathname.startsWith('/api/plans/')) {
    const type = url.searchParams.get('type') || 'short-term';
    const dir = type === 'long-term' ? LONG_TERM_DIR : SHORT_TERM_DIR;
    const filename = decodeURIComponent(url.pathname.replace('/api/plans/', ''));
    const filepath = path.join(dir, filename);

    if (!filepath.startsWith(dir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filepath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Plan not found' }));
      }
      res.writeHead(200, { 'Content-Type': 'text/markdown' });
      res.end(content);
    });
    return;
  }

  // Serve static files
  let filepath = url.pathname === '/' ? '/index.html' : url.pathname;
  filepath = path.join(__dirname, filepath);

  const ext = path.extname(filepath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filepath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Plan viewer running at http://localhost:${PORT}`);
});
