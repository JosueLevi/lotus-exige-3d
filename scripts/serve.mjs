import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('dist');
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.glb':'model/gltf-binary','.png':'image/png','.webp':'image/webp','.txt':'text/plain' };
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if (pathname === '/__qa/desktop') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync('scripts/desktop-preview.html')); return; }
  if (pathname === '/__qa/mobile') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync('scripts/desktop-preview.html','utf8').replaceAll('1440','352').replaceAll('1000','566')); return; }
  if (pathname === '/__qa/poster') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync('scripts/poster.html')); return; }
  if (pathname === '/__qa/lotus') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync('scripts/lotus-inspect.html')); return; }
  if (pathname === '/__qa/no-webgl') {
    const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/">').replace('<script type="module" src="app.js"></script>',`<script>const originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:originalContext.call(this,type,...args);};</script><script type="module" src="app.js"></script>`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
  }
  if (pathname === '/__qa/save-poster' && req.method === 'POST') {
    const chunks=[]; let size=0;
    req.on('data', chunk=>{size+=chunk.length;if(size>4000000) req.destroy();else chunks.push(chunk);});
    req.on('end',()=>{fs.writeFileSync(path.join(root,'assets/lotus-exige-poster.png'),Buffer.concat(chunks));res.writeHead(200);res.end('Poster saved');});return;
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  const sendFile = () => {
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length':fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  };
  // Optional local QA delay to inspect the actual loading state before GLB arrival.
  const delay = path.extname(file) === '.glb' ? Math.min(10000, Math.max(0, Number(process.env.LOTUS_QA_DELAY_MS) || 0)) : 0;
  if (delay) setTimeout(sendFile, delay); else sendFile();
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
