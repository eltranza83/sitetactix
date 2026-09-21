import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function apiDevPlugin() {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/ask-brain' && req.method === 'POST') {
          try {
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const bodyBuffer = Buffer.concat(chunks);
            const { POST } = await import('./api/ask-brain.js');
            const webRequest = new Request('http://localhost:5173/api/ask-brain', {
              method: 'POST',
              headers: req.headers,
              body: bodyBuffer
            });
            const webResponse = await POST(webRequest);
            res.statusCode = webResponse.status;
            webResponse.headers.forEach((value, key) => {
              res.setHeader(key, value);
            });
            const responseText = await webResponse.text();
            res.end(responseText);
          } catch (err) {
            console.error('Error executing /api/ask-brain in dev server:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), apiDevPlugin()],
  build: {
    modulePreload: {
      resolveDependencies: (filename, deps) => {
        return deps.filter(dep => !dep.includes('vendor-jspdf') && !dep.includes('vendor-html2canvas'));
      }
    },
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@firebase/webchannel-wrapper')) {
            return 'vendor-firebase-webchannel';
          }
          if (id.includes('node_modules/@firebase/firestore') || id.includes('node_modules/firebase/firestore')) {
            return 'vendor-firebase-firestore';
          }
          if (id.includes('node_modules/@firebase') || id.includes('node_modules/firebase')) {
            return 'vendor-firebase-core';
          }
          if (id.includes('node_modules/@google/generative-ai')) {
            return 'vendor-gemini';
          }
          if (id.includes('node_modules/jspdf')) {
            return 'vendor-jspdf';
          }
          if (id.includes('node_modules/html2canvas')) {
            return 'vendor-html2canvas';
          }
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
    allowedHosts: true
  }
})
