// An in-memory Google Drive that answers the same HTTP calls the app makes, so tests can run
// the app's REAL Drive code (googleDrive.js, invoiceUpload.js) instead of a pretend copy of it.

const FOLDER = 'application/vnd.google-apps.folder';

function unescapeQuery(value) {
  return value.replace(/\\(.)/g, '$1');
}

export function createFakeDrive() {
  const files = new Map();
  const calls = [];
  let nextId = 0;
  let mediaUploadsToFail = [];
  let mediaUploadCount = 0;
  const failingRequests = [];

  const add = (meta) => {
    const id = meta.id || `f${++nextId}`;
    const file = { id, trashed: false, parents: [], appProperties: {}, ...meta };
    files.set(id, file);
    return file;
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

  async function fetchImpl(url, options = {}) {
    const u = new URL(url);
    const method = options.method || 'GET';
    calls.push({ method, path: u.pathname, search: u.search });
    if (failingRequests.some(fails => fails({ method, path: u.pathname, body: options.body }))) {
      return new Response('Google is unavailable', { status: 503 });
    }

    if (u.pathname.startsWith('/upload/drive/v3/files/')) {
      mediaUploadCount++;
      const id = decodeURIComponent(u.pathname.split('/').pop());
      if (mediaUploadsToFail.includes(mediaUploadCount)) return new Response('upload failed', { status: 500 });
      const file = files.get(id);
      if (!file) return new Response('not found', { status: 404 });
      file.size = options.body?.size ?? String(options.body || '').length;
      file.contentVersion = (file.contentVersion || 0) + 1;
      return json({ id, name: file.name });
    }

    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      const name = q.match(/name='((?:[^'\\]|\\.)*)'/);
      const parent = q.match(/'((?:[^'\\]|\\.)*)' in parents/);
      const list = [...files.values()].filter(f => !f.trashed
        && (!name || f.name === unescapeQuery(name[1]))
        && (!parent || f.parents.includes(unescapeQuery(parent[1])))
        && (!q.includes(`mimeType='${FOLDER}'`) || f.mimeType === FOLDER)
        && (!q.includes("mimeType contains 'image/'") || String(f.mimeType).startsWith('image/')));
      // Pages like Google: up to pageSize files, then a nextPageToken for the rest
      const pageSize = Number(u.searchParams.get('pageSize')) || 100;
      const start = Number(u.searchParams.get('pageToken')) || 0;
      const page = list.slice(start, start + pageSize);
      const more = start + pageSize < list.length;
      return json({ files: page, ...(more ? { nextPageToken: String(start + pageSize) } : {}) });
    }

    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const file = add({ name: body.name, mimeType: body.mimeType, parents: body.parents || [], description: body.description });
      return json({ id: file.id, name: file.name });
    }

    const match = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (match) {
      const file = files.get(decodeURIComponent(match[1]));
      if (!file) return new Response('not found', { status: 404 });
      if (method === 'GET') return json(file);
      if (method === 'PATCH') {
        const removeParents = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
        const addParents = (u.searchParams.get('addParents') || '').split(',').filter(Boolean);
        file.parents = [...file.parents.filter(p => !removeParents.includes(p)), ...addParents];
        const body = options.body ? JSON.parse(options.body) : {};
        const { appProperties, ...rest } = body;
        Object.assign(file, rest);
        if (appProperties) file.appProperties = { ...file.appProperties, ...appProperties };
        return json(file);
      }
    }

    return new Response(`fake drive: unhandled ${method} ${u.pathname}`, { status: 400 });
  }

  return {
    fetch: fetchImpl,
    files,
    calls,
    add,
    /** Makes the Nth media upload from now fail (1 = the next one). */
    failMediaUpload(nth) {
      mediaUploadsToFail.push(mediaUploadCount + nth);
    },
    mediaUploads: () => mediaUploadCount,
    /** Requests matching fails({ method, path, body }) get a 503 until restore() (like no signal). */
    failRequests(fails) {
      failingRequests.push(fails);
    },
    restore() {
      failingRequests.length = 0;
    },
    /** Moving a file to the trash fails (bad signal) until restore(). */
    failTrash() {
      this.failRequests(({ method, body }) => method === 'PATCH' && String(body || '').includes('"trashed":true'));
    },
    folderPath(fileId) {
      const names = [];
      let current = files.get(fileId);
      while (current?.parents?.[0]) {
        const parent = files.get(current.parents[0]);
        names.unshift(parent ? parent.name : current.parents[0]);
        current = parent;
      }
      return names.join('/');
    },
    /** Live (not trashed) PDFs whose folder path ends with the given path. */
    livePdfsIn(pathSuffix) {
      return [...files.values()].filter(f => !f.trashed && f.mimeType === 'application/pdf'
        && this.folderPath(f.id).endsWith(pathSuffix));
    }
  };
}
