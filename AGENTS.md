# Project notes

- Stack: Vite 8 + Three.js 0.187 (WebGLRenderer), plain JavaScript ES modules, no UI framework.
- Commands: `npm run dev`, `npm run build`, `npm run preview`. There is no test runner or linter;
  `npm run build` is the syntax/import check.
- Port 5173 may already be taken on this machine; Vite then picks the next free port.
- This machine has no bash: use PowerShell.
- All assets are procedural (canvas textures, shaders). Do not add image, video or network dependencies.
- State lives in `src/core/Store.js`; every setting must go through its schema.
- Shader rule: never call `pow()` with a base that can be negative (interpolants overshoot at
  MSAA edges and produce NaN that the bloom then spreads).
- Three.js `Color` has no `addScaledVector`; `LightingSystem.js` has a `mad()` helper.
- Debug handle in the browser console: `window.weatherSim` (`app`, `store`, `ui`, `perf`);
  `weatherSim.app.settle()` skips running time/weather transitions.
- Visual checks were done with headless Chrome (puppeteer-core kept outside the repo) by setting
  state through `weatherSim.store` and taking screenshots.
- Deployment: static build served by `nginx:1.27-alpine` via Docker Compose on the server, in `/opt/renderlab`
  (`deploy/docker-compose.yml`, `deploy/nginx.conf`, `site/` = contents of `dist/`, `certs/` = self-signed origin cert).
  `renderlab.top` is proxied by Cloudflare. To redeploy: `npm run build`, upload `dist/` to `/opt/renderlab/site`
  (no container restart needed). SSH uses a non-standard port and a dedicated key; ask the user for details.
