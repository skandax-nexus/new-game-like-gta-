/** Static server for the lookdev harness (docs/art/tools/lookdev). OWNER: Art Director. */
const http = require('http'), fs = require('fs'), path = require('path');
const LD = __dirname, REPO = require('path').resolve(__dirname, '../../../..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.exr': 'image/x-exr', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u.startsWith('/public/') ? path.join(REPO, u) : u === '/lookdev.js' ? path.join(REPO, '.asset-cache', 'lookdev.js') : path.join(LD, u === '/' ? 'index.html' : u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(8766, '127.0.0.1');
