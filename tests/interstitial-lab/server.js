/**
 * LABORATÓRIO DO INTERSTICIAL (mede o código REAL do repositório, sem tocar produção)
 * Serve api/ads/go.js do repositório clonado com um shim Vercel-like, permitindo
 * forjar host/geo/UA — exatamente o que o visitante real envia.
 *
 * uso: node server.js <porta> <caminho-do-repo>
 */
const http = require('http');
const url = require('url');

const PORT = Number(process.argv[2] || 8080);
const REPO = process.argv[3] || '/tmp/eng';

const handler = require(REPO + '/api/ads/go.js');

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const shim = {
    headers: Object.assign({}, req.headers),
    query: u.query,
    url: req.url,
    method: req.method,
    body: undefined
  };
  const shimRes = {
    statusCode: 200,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    end(body) {
      for (const k in this._headers) res.setHeader(k, this._headers[k]);
      res.statusCode = this.statusCode;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(body === undefined ? '' : body);
      return this;
    },
    json(o) {
      for (const k in this._headers) res.setHeader(k, this._headers[k]);
      res.statusCode = this.statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(o));
      return this;
    }
  };
  try {
    await handler(shim, shimRes);
  } catch (e) {
    res.statusCode = 500;
    res.end('handler error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('laboratorio no ar em http://127.0.0.1:' + PORT + ' (repo=' + REPO + ')');
});
