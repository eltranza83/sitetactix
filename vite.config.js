import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

function getCommitSha() {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

function apiDevPlugin() {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const devRoutes = { '/api/jarvis': './api/jarvis.js', '/api/extract-document': './api/extract-document.js' };
        if (devRoutes[req.url] && req.method === 'POST') {
          try {
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(chunk);
            }
            const bodyBuffer = Buffer.concat(chunks);
            const routePath = devRoutes[req.url];
            // Resolve from the project folder (the config itself runs from a temp folder)
            const { POST } = await import(pathToFileURL(resolve(process.cwd(), routePath)).href);
            const webRequest = new Request(`http://localhost:5173${req.url}`, {
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
            console.error(`Error executing ${req.url} in dev server:`, err);
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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  const commitSha = getCommitSha();
  const buildLabel = commitSha ? `v${pkg.version} · ${commitSha}` : `v${pkg.version}`;
  const releaseName = pkg.releaseName || 'Security rules & sync reliability';
  process.env.VITE_APP_VERSION = pkg.version;
  process.env.VITE_APP_BUILD_LABEL = buildLabel;
  process.env.VITE_APP_RELEASE_NAME = releaseName;

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.VITE_APP_BUILD_LABEL': JSON.stringify(buildLabel),
      'import.meta.env.VITE_APP_RELEASE_NAME': JSON.stringify(releaseName)
    },
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
};
});
