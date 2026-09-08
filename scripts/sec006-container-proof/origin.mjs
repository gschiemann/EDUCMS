/**
 * SEC-006 in-container proof — the ORIGIN the renderer is pointed at.
 *
 * Runs in its OWN container, on a docker network whose subnet
 * (198.51.99.0/24) is deliberately outside every range `isPrivateIp` rejects,
 * so the shipped SSRF guard admits it WITHOUT being weakened for the test and
 * WITHOUT needing internet. The renderer therefore drives a real page over a
 * real socket, exactly as it would in production.
 *
 * Routes:
 *   /            page whose visible DOM is written by JavaScript. If the
 *                snapshot contains the marker, Chromium executed script —
 *                a plain fetch could never produce it.
 *   /slow        headers immediately, body never ends. Chromium sits on it,
 *                which is the window the kill proofs need.
 *   /hog         page that allocates until the renderer dies (OOM shape).
 *   /health      liveness for the harness.
 */
import { createServer } from 'node:http';

const MARKER = 'SEC006-JS-EXECUTED-IN-CHILD';

const jsPage = `<!doctype html><html><head><title>sec006 origin</title></head>
<body><div id="root">static-only</div>
<script>
  document.getElementById('root').textContent = '${MARKER}';
  var d = document.createElement('div');
  d.id = 'late';
  d.textContent = 'injected-after-load';
  document.body.appendChild(d);
</script>
</body></html>`;

// Never closed, never ended — see the /slow handler.
const slowPage = `<!doctype html><html><head><title>slow</title></head><body>
<div id="root">waiting</div>`;

const hogPage = `<!doctype html><html><body><script>
  var keep = [];
  function grow(){ for (var i=0;i<400;i++) keep.push(new Uint8Array(1024*1024)); setTimeout(grow, 0); }
  grow();
</script></body></html>`;

const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (path === '/slow') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write(slowPage);
    // Dribble bytes so the socket stays open but the document never finishes:
    // `networkidle2` never fires, so the render is genuinely in flight for as
    // long as the harness needs.
    const t = setInterval(() => {
      try {
        res.write('<!-- tick -->');
      } catch {
        clearInterval(t);
      }
    }, 500);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (path === '/hang') {
    // Accepted, never answered. A sub-resource that keeps Chromium busy.
    return;
  }
  if (path === '/lag') {
    // A COMPLETE document that a plain fetch reads instantly, but whose
    // sub-resources never settle — so `networkidle2` never fires and the
    // Chromium render is genuinely in flight while the harness kills it,
    // while the `safeFetch` fallback still has something to serve.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><html><head><title>lag</title></head><body>
       <div id="root">SEC006-RAW-DOCUMENT</div>
       <img src="/hang" alt=""><script src="/hang"></script>
       <script>document.getElementById('root').textContent='${MARKER}';</script>
       </body></html>`,
    );
    return;
  }
  if (path === '/hog') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(hogPage);
    return;
  }
  if (path === '/hogload') {
    // The WORST production shape: allocate hard AND never let the page reach
    // `networkidle2`, so the render burns its whole navigation timeout while
    // the hostile page grows. This is what bounds a hostile render's memory,
    // and therefore what the concurrency cap has to be judged against.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<!doctype html><html><body><img src="/hang" alt="">
       <script>
         var keep = [];
         function grow(){
           try { for (var i=0;i<64;i++) keep.push(new Uint8Array(1024*1024).fill(1)); } catch (e) {}
           setTimeout(grow, 10);
         }
         grow();
       </script></body></html>`,
    );
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(jsPage);
});

server.listen(80, '0.0.0.0', () => {
  console.log('[origin] listening on :80');
});
