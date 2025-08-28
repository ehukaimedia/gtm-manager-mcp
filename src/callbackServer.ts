import { createServer } from 'http';
import { extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const PORT = Number(process.env.PORT || 3101);

function contentTypeFor(path: string) {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
}

const server = createServer((req: any, res: any) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Basic health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Redirect root to /callback for convenience
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/callback' });
    res.end();
    return;
  }

  // Serve inline OAuth callback page
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GTM OAuth Callback</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display:flex; align-items:center; justify-content:center; height: 100vh; margin:0; background:#f5f5f5; }
    .container { background:#fff; padding:2rem; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,.1); max-width:560px; width:100%; }
    .success { color:#22c55e; }
    .error { color:#ef4444; }
    .code { background:#f3f4f6; padding:1rem; border-radius:4px; font-family:monospace; word-break:break-all; margin:1rem 0; }
    .instructions { margin-top:1rem; padding:1rem; background:#f0f9ff; border-radius:4px; border-left:4px solid #3b82f6; }
  </style>
  </head>
<body>
  <div class="container">
    <h2>GTM OAuth Callback</h2>
    ${error ? `<p class="error">❌ Authentication Error: ${error}</p><p>Please retry the authentication process.</p>` : ''}
    ${code ? `<p class="success">✅ Authentication Successful!</p><p>Authorization code received:</p><div class="code">${code}</div><div class="instructions"><p><strong>Next steps:</strong></p><ol><li>Copy the authorization code above</li><li>In your terminal, exchange the code:<br /><code>gtm-mcp-auth auth:exchange \"${code}\"</code></li><li>You can close this window after copying the code</li></ol></div><p><small>Code expires in ~10 minutes</small></p>` : (!error ? `<p class="error">❌ No authorization code received</p><p>Please ensure you're following the correct authentication flow.</p>` : '')}
  </div>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local OAuth callback server running on http://127.0.0.1:${PORT}/callback`);
});
