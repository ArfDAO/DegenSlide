export default async function handler(req, res) {
  // req.url will be like /monad-api/api/v2/stats or /monad-api/api?module=...
  const stripped = req.url.replace(/^\/monad-api/, '') || '/';
  const target = `https://monadexplorer.com${stripped}`;

  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    const body = await upstream.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error', message: err.message });
  }
}
