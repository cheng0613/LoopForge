# Desktop client — TODO

Work not yet done on the desktop shell, in rough priority order. Each item says
what it is for, so it can be judged rather than just executed.

The shell is deliberately thin: it loads the platform's own UI, so **changes to
`web/` reach desktop users without rebuilding this app.** Nothing below changes
that; they are all about distribution and desktop-native comfort.

## Before distributing to anyone

### 1. Code signing

Unsigned installers trigger SmartScreen ("Windows protected your PC") and macOS
Gatekeeper refuses to open the app at all. Users have to click through a warning
that looks exactly like malware.

- Windows: an OV/EV code-signing certificate, wired into `electron-builder.yml`
  (`win.certificateFile` / `certificatePassword`, or a cloud signing service).
- macOS: an Apple Developer ID plus notarisation (`mac.notarize`).

Until this is done, treat the installer as internal-only.

### 2. A proper `.ico` / `.icns` icon

`build/icon.png` is the 1254×1254 `web/images/loopforge-logo.png`. electron-builder
converts it, but a real multi-resolution `.ico` (16/32/48/256) looks noticeably
better in the taskbar, Start menu and Alt-Tab than a downscaled single image.

## Makes it usable day to day

### 3. Tray icon and background running

Today closing the window quits the app. Someone waiting on an approval gate has
to keep the window open, or reopen it to find out.

- Minimise to tray instead of quitting on close.
- Quit only from the tray menu.
- Needs a decision on whether the app should start with the OS.

### 4. Desktop notifications for approval gates

The platform already emits run state; the shell would need to notice a run
reaching a human gate and raise a native notification. Without it, the only
signal that work is waiting is the user looking at the window.

Open question: poll the API from the shell, or have the platform page post a
message? The second needs a preload bridge, which the main window deliberately
does not have today.

## Distribution

### 5. Auto-update

`electron-updater` is not wired up. Every new version means asking users to
reinstall. With signing in place this is mostly configuration plus a release
feed, but it should not ship before signing — an unsigned auto-updater is worse
than none.

### 6. Multi-environment builds

`LOOPFORGE_BUILD_URL` is baked at build time, so staging and production need two
builds. That is fine today. If they ever need to be built in parallel, note that
both would write the same `src/build-env.json` and race — it would need to be
per-target.

## Not planned

### Offline / local execution

The shell assumes the platform is reachable. Making it work offline means
bundling the platform, or restoring the runner-in-WSL path that was removed —
both are a different product direction, not a gap in this one.
