/**
 * Simple static file server for calendar prototype
 * Usage: node serve.js
 * Serves files from current directory on port 3000
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const DIRECTORY = __dirname;

// MIME types for common file extensions
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  // Parse URL and get pathname
  let pathname = req.url.split('?')[0];

  // Default to index.html
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Resolve file path (prevent directory traversal)
  const filePath = path.join(DIRECTORY, pathname);
  const resolvedPath = path.resolve(filePath);

  // Security check: ensure path is within DIRECTORY
  if (!resolvedPath.startsWith(DIRECTORY)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Get file extension and MIME type
  const ext = path.extname(resolvedPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  // Read and serve file
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Calendar prototype server running at http://localhost:${PORT}`);
  console.log(`Serving files from: ${DIRECTORY}`);
  console.log('Press Ctrl+C to stop');
});
