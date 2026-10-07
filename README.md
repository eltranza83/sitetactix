# SiteTactix by Adepec Homes

Jobsite Intelligence & Field Operations platform for interactive blueprint pinboarding, AI document extraction, punch list tracking, and cloud sync for custom home building.

## Local development

```powershell
npm.cmd install
npm.cmd run dev
```

## Verification

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

## Production secrets

Receipt reading (`/api/extract-document`) is an authenticated Vercel function in `api/`; `npm run dev` runs it locally. (The Jarvis assistant was retired in v1.7.0; it can be restored from the git tag `jarvis-final`.) Configure these server-only environment variables in Vercel for Production (and Preview when needed):

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (optional; defaults to `gemini-3.1-flash-lite`)

Do not prefix these variables with `VITE_`; that would expose them in the browser bundle. The legacy Firestore document `invites/CONFIG-GEMINI` is no longer read and should be deleted after the Vercel variable is configured.
