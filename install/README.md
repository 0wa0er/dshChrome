# Companion installer

This module never runs from npm postinstall. The authorized dsh activation flow may call `setupNativeHost` with a `createRegistrationPlan` using `await resolvedNodePath()` and the installed package’s `native/main.js`.

Explicit Windows commands, run from the installed package:

- `node install/cli.js setup`: write current-user bridge files and register `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.dsh_chrome`.
- `node install/cli.js status`: read registration; counterpart presence remains unknown until handshake.
- `node install/cli.js extension`: open the published store entry, or display truthful development loading instructions.
- `node install/cli.js unregister`: remove this current-user registration only; preserve projects, sessions, package files, and Chrome extension.
- Add `--dry-run` to setup/unregister to inspect without mutation.

Release metadata is package-owned. Production URLs are currently null. There is no published installer download and no claim of a silent Chrome-first install. For development, use the supported desktop CLI carrier to run `dsh plugin --profile desktop add <tarball>`, restart the desktop profile, run setup, and load the package’s `extension` folder through `chrome://extensions` → Developer mode → Load unpacked. Consult the repository runtime contract for the desktop CLI carrier: a generic CLI may reject this profile.

`InstallationCoordinator` accepts trusted dependencies `release`, `probe`, `installNativeHost`, `openEntry`, `onProgress`. `probe()` returns optional `nativeHost`, `host`, and `extension` entries containing `version`, `protocolVersion`, and `connected`. Extension readiness requires a real connected handshake. `status()` preserves unknown peers. `ensure({target, version?, operationId?, userInitiated:true})` emits `installing`, `ready`, `awaiting-user`, or `failed` with an operation ID. Duplicate IDs share one operation within a coordinator instance. Do not discard an instance while its installation is running. New explicit retries may use a new ID, and always probe current state first. No installation request accepts a URL, command, or path. `openEntry` uses only release metadata.

The launcher pins the resolved Node executable and installed native script paths. It uses a quoted `.cmd` with delayed expansion disabled and does not forward Chrome arguments. Paths containing percent expansion, quotes, or line breaks are rejected instead of interpreted. Registration uses `reg.exe` argument arrays, not a shell command. Windows Chrome launcher behavior still requires real browser validation; dry-run and coordinator tests do not establish that a host was launched by Chrome.

Reference: [Chrome native messaging registration](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

The release bootstrap ZIP can contain `windows-install.cmd`, `windows-install.ps1`, and `dsh-chrome-0.1.0.tgz` in one folder. After fully quitting the existing dsh desktop application, double-click the `.cmd` once. The script uses the installed desktop Electron CLI carrier, installs the tarball into the desktop profile, extracts matching companion runtime files into a stable per-user directory, and registers the native bridge. It does not stop dsh or install a second desktop application. `powershell.exe -NoProfile -File install/windows-install.ps1 -Tarball <absolute-tgz> -DryRun` prints the plan without extracting, installing, or changing the registry. `-DesktopDirectory` handles an existing nondefault desktop installation. The production bootstrap ZIP URL remains unpublished in `release.json`.

Electron desktop activation uses `process.execPath` as its runtime; the bridge launcher explicitly sets `ELECTRON_RUN_AS_NODE=1`, also harmless for normal Node. Registration status verifies the package version, protocol, exact origin allowlist, manifest, and launcher file; it does not treat a stale registry key as a working installation. Actual Chrome startup and native handshake remain separate integration checks.
