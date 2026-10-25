// Minimal static server, no dependencies: `npm start`, then open http://localhost:8080
// (Opening index.html directly also works; a server is only needed for some browsers'
// file:// restrictions.)
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "../.."), port = Number(process.env.PORT) || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/markdown" };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "content-type": (types[path.extname(file)] || "application/octet-stream") + "; charset=utf-8" }).end(buf);
  });
}).listen(port, () => console.log(`Reorg Change Compiler at http://localhost:${port}`));
