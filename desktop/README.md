# LoopForge Desktop

An Electron window onto a LoopForge deployment.

The platform is one server. This app connects to it and shows its UI; agents,
sandboxes and data all stay on the server. **There is nothing to configure** —
no address to type, no mode to choose, no token to paste.

## What the shell adds over a browser tab

- A real window with its own icon and taskbar entry
- A single instance: a second launch focuses the first window
- External links open in your browser, never inside the app
- No address bar or extensions, so the window stays on LoopForge

That is the whole feature set. The UI itself is the platform's, unchanged, so
platform updates never need a matching desktop change.

## Build

The platform address is baked in at build time:

```bash
cd desktop
npm install
LOOPFORGE_BUILD_URL=https://loopforge.example.com npm run dist
```

`scripts/bake-build-url.js` runs as a `beforePack`/`afterPack` pair:
`beforePack` writes `src/build-env.json` (gitignored) before the app files are
copied, and `afterPack` deletes it once they are on disk. `build-config.js`
reads that file at runtime.

No source file is edited during a build. Writing the address into
`build-config.js` instead would need a restore step, and a restore tied to
process exit is not reliable — electron-builder packs targets in parallel, and
a killed build would leave the checkout modified. If a build dies midway here,
the only leftover is a gitignored file that the next build overwrites.

A packaged app with no baked URL refuses to start and says the build was
misconfigured, instead of asking the user for an address they cannot know.

## Development

A source checkout defaults to `http://127.0.0.1:8090` — the compose stack from
`./start.sh` at the repository root.

```bash
./start.sh          # start the platform
cd desktop
npm run dev         # open the shell against it
```

Override the address for one run:

```bash
LOOPFORGE_DESKTOP_URL=https://loopforge.example.com npm run dev
```

## Checks

```bash
npm test              # health probe + URL resolution, no display needed
npm run check:launch  # launches Electron, asserts the UI rendered
```

`check:auth` logs in first, for checking the authenticated workbench:

```bash
LOOPFORGE_PROBE_LOGIN=demo LOOPFORGE_PROBE_PASSWORD=secret npm run check:auth
```

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOOPFORGE_BUILD_URL` | — | Baked into a packaged build; required for `npm run dist` |
| `LOOPFORGE_DESKTOP_URL` | build value / `http://127.0.0.1:8090` | Override for one run |
| `LOOPFORGE_DESKTOP_DEV` | — | Set by `npm run dev` |

## Layout

```
desktop/
  src/
    main.js           window lifecycle, link handling
    build-config.js   the baked-in platform address
    server-config.js  resolves the URL to load
    health.js         /api/health probe
  scripts/
    smoke.js          health, URL resolution, build baking — no display
    bake-build-url.js beforePack/afterPack hooks that bake the address
    launch-check.js   launches Electron, asserts a render
    auth-check.js     logs in, asserts the workbench
    dev.js            portable `npm run dev` launcher
  electron-builder.yml packaging
```

## Known limits

- **One deployment per build.** To point at a different server, rebuild with a
  different `LOOPFORGE_BUILD_URL`.
- **No auto-update.** `electron-updater` is not wired up yet.
- **No tray icon or background mode.** Closing the window quits on Windows and
  Linux; macOS keeps the app in the dock.
- **The window needs the platform to be reachable.** It shows a local loading
  page while the server answers `/api/health`, then loads the real UI.
- **Unsigned builds.** Windows shows a SmartScreen warning and macOS refuses to
  open the app until it is signed.

See [TODO.md](TODO.md) for the work behind these limits and what is planned.
