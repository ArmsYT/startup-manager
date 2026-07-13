## ⚠️ Antivirus / SmartScreen false positives

> [!WARNING]
> Electron itself is not a virus — it's the framework used by VS Code, Discord, Slack, or Figma.
> But **this specific project** combines several behaviors that Windows Defender and SmartScreen
> watch closely to detect malware:
>
> - it writes an entry to the auto-start registry key (`HKCU\...\Run`);
> - it can launch other executables automatically;
> - it can run **with no visible window at all** (`--startup` mode).
>
> On top of that, an `.exe` built with `electron-builder` is, by default, **not digitally signed**:
> it has no certificate and no reputation known to Microsoft, which is often enough to trigger the
> SmartScreen *"Windows protected your PC"* screen on first launch, or even quarantine by Windows
> Defender (more common with the portable exe, a single unknown binary, than with the NSIS
> installer).
>
> This is a **common false positive** for this type of tool, not evidence of malicious behavior.

## How it works

- Configuration (app list, order, delays, enabled/disabled state) is stored in `apps.json` in the
  app's user data folder (`app.getPath('userData')`).
- When you enable **"Start with Windows"**, the app writes an entry to the registry key
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` pointing to the executable with the
  `--startup` argument.
- On the next Windows boot, the app is automatically relaunched with `--startup`: it shows **no
  window**, reads `apps.json`, launches each enabled application in the configured order (respecting
  any delay between them), then quits.
- A normal launch (double-click, shortcut) without the `--startup` argument shows the regular
  management interface.

## Interface

- **Add** (+ icon): opens a file picker to choose an `.exe`, suggests a name and automatically
  extracts its icon (`app.getFileIcon`), then lets you set launch arguments and a delay (in
  milliseconds) before the app starts.
- **Edit** (pencil icon, on each card): change the name, executable, arguments, or delay of an
  already-added application.
- **Toggle** on each card: enable/disable the application without removing it from the list.
- **Trash icon**: permanently removes an application from the list (with confirmation).
- **"Edit order"** (top button, pencil icon): switches to reorder mode. Cards become draggable
  **only** in this mode (like a Spotify playlist) — outside of it, the order is locked and cards
  cannot be moved. A banner and a "Done" button let you exit the mode.

## Launch arguments

| Argument      | Effect |
| ------------- | ------ |
| *(none)*      | Normal launch (double-click, shortcut): shows the regular management interface. |
| `--startup`   | Automatic launch driven by Windows via the `Run` registry key. No window is shown: the app reads `apps.json`, launches each enabled application in the configured order (respecting any delay), then quits by itself. |

This is the argument written to the registry when you enable **"Start with Windows"**
(registered command: `"path\to\StartupManager.exe" --startup`) — see `setWindowsAutoLaunch` in
`main.js`. There are no other custom arguments; Electron/Chromium accepts its own standard flags
(`--disable-gpu`, etc.) but the app doesn't interpret them itself.

## Footer (Arms signature + updates)

The footer shows, centered, your Gravatar avatar and display name (fetched via `arms.config.js`)
along with a link to your GitHub repository. On the right, the app's version number
(`package.json`) and an update-check button.

- On launch, the app **silently** checks whether a newer release exists on GitHub; a popup only
  appears if an update is actually available.
- The refresh button next to the version number triggers a manual check and always shows a result
  (up to date, update available, or error).
- The comparison is based on the name (tag) of the **latest published release** on the repo
  configured in `arms.config.js` (`githubRepoUrl`) — the tag must be in `v1.0.1` format (the `v` is
  ignored in the comparison).

## Installation (development)

```bash
npm install
npm start
```

## Building the Windows installer

```bash
npm run dist
```

Generates two files in `dist/` via `electron-builder`:

- **`Startup Manager Setup <version>.exe`** — the installer (NSIS), with a choice of install folder.
- **`Startup Manager-<version>-portable.exe`** — a single, standalone executable, no installation.

In both cases, all the code (`main.js`, `preload.js`, `src/`, `arms.config.js`) is packed into an
`app.asar` archive inside the binary: someone installing the app only sees an `.exe` (and possibly a
`resources\` folder), not plain-text `.js` files next to it that they could open and edit with
Notepad. `arms.config.js` (Gravatar avatar/name, repo link) is therefore no longer editable by a
regular user after installation — only the person building the app can change it, before
`npm run dist`.

> [!CAUTION]
> This protection prevents *accidental or casual* tampering, not a deliberate, advanced extraction
> (tools like `asar extract` can still read the archive — this is not encryption). For stronger
> protection, you'd need to digitally sign the executable (code-signing certificate): Windows then
> refuses to run a binary modified after signing, on top of avoiding the antivirus/SmartScreen false
> positives mentioned above.

## Project structure

```
startup-manager/
├── main.js          # Electron main process (window, registry, sequential launch)
├── preload.js        # Secure bridge (contextBridge) between the renderer and the main process
├── package.json
├── src/
│   ├── index.html    # Interface (custom title bar, list, modals)
│   ├── style.css      # App background rgba(0,0,0,0.75), cards rgba(60,60,60,0.5)
│   └── renderer.js    # UI logic: add/edit/remove, enable toggle, drag-and-drop
└── assets/            # App icons (icon.ico must be provided before building)
```

## Notes

- Drag-and-drop is done with native HTML5 (no external dependency), for guaranteed offline
  operation.
- Icon extraction (`app.getFileIcon`) is provided by Electron; if it fails, a badge with the app's
  initial letter is used instead.
- Make sure to provide an `assets/icon.ico` file before running `npm run dist`.
- If accented characters look garbled (`V├®rification` instead of `Vérification`) in the `cmd.exe`
  terminal when running `npm start`, that's a Windows console encoding issue, not the app: run
  `chcp 65001` before `npm start`, or use Windows Terminal / PowerShell, which handle UTF-8 natively.
