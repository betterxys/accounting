# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Pure frontend asset management app (HTML/CSS/JS) for GitHub Pages. Zero npm dependencies — Chart.js is loaded via CDN. Data lives in browser `localStorage`.

### Running the app

```bash
python3 -m http.server 3000
# or: npx serve . -p 3000
```

Open `http://localhost:3000`. See `README.md` for details.

### Testing with sample data

In the browser console run `loadTestData()` to populate sample records, `clearTestData()` to reset.

### Gotchas

- `script.js` uses `let app` which does NOT attach to `window`. The line `window.app = app` is required for `test-data.js` helper functions (`loadTestData` / `clearTestData`) to work.
- There is no linter, test framework, or build step — the project is vanilla HTML/CSS/JS served as static files.
- The only external runtime dependency is Chart.js loaded from `cdn.jsdelivr.net`; an internet connection (or CDN cache) is needed for charts to render.
