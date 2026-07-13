const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const { spawn, exec } = require('child_process');
const armsConfig = require('./arms.config.js');

const CONFIG_PATH = path.join(app.getPath('userData'), 'apps.json');
const IS_STARTUP_RUN = process.argv.includes('--startup');

/* ------------------------------------------------------------------ */
/*  Auto-démarrage avec Windows (clé de registre Run)                 */
/*  On écrit directement la commande avec l'argument --startup afin   */
/*  de pouvoir distinguer un lancement automatique d'un lancement     */
/*  manuel par l'utilisateur.                                         */
/* ------------------------------------------------------------------ */

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_VALUE_NAME = 'StartupManager';

function setWindowsAutoLaunch(enabled) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      // Hors Windows (dev/test), on ne fait rien mais on ne bloque pas l'UI.
      resolve(true);
      return;
    }
    if (enabled) {
      const exePath = app.getPath('exe');
      const cmd = `reg add "${REG_KEY}" /v "${REG_VALUE_NAME}" /t REG_SZ /d "\\"${exePath}\\" --startup" /f`;
      exec(cmd, (err) => resolve(!err));
    } else {
      const cmd = `reg delete "${REG_KEY}" /v "${REG_VALUE_NAME}" /f`;
      exec(cmd, () => resolve(true)); // on résout aussi si la clé n'existait pas
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Configuration (liste des applications)                            */
/* ------------------------------------------------------------------ */

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { autoLaunch: false, apps: [] };
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.apps)) parsed.apps = [];
    return parsed;
  } catch (err) {
    console.error('Erreur de lecture de la config :', err);
    return { autoLaunch: false, apps: [] };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/* ------------------------------------------------------------------ */
/*  Mode "démarrage" : on lance les apps activées, dans l'ordre,      */
/*  avec le délai configuré, puis on quitte silencieusement.          */
/* ------------------------------------------------------------------ */

async function runStartupSequence() {
  const config = loadConfig();
  const list = config.apps
    .filter((a) => a.enabled)
    .sort((a, b) => a.order - b.order);

  for (const item of list) {
    await new Promise((resolve) => setTimeout(resolve, item.delay || 0));
    try {
      const child = spawn(item.execPath, item.args ? item.args.split(' ').filter(Boolean) : [], {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(item.execPath)
      });
      child.unref();
    } catch (err) {
      console.error(`Impossible de lancer ${item.name} :`, err);
    }
  }
  app.quit();
}

/* ------------------------------------------------------------------ */
/*  Fenêtre principale                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Icône de l'application (barre des tâches, Alt+Tab)                 */
/* ------------------------------------------------------------------ */

function getAppIconPath() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  return fs.existsSync(iconPath) ? iconPath : undefined; // undefined = icône par défaut d'Electron
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 400,
    minHeight: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Les liens target="_blank" (avatar, thearms.fr, dépôt GitHub) s'ouvrent
  // dans le navigateur par défaut au lieu d'une nouvelle fenêtre Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------------ */
/*  IPC                                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Pied de page : avatar + pseudo Gravatar, lien du dépôt GitHub     */
/* ------------------------------------------------------------------ */

function md5(text) {
  return crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex');
}

function fetchGravatarDisplayName(hash) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://www.gravatar.com/${hash}.json`,
      {
        headers: { 'User-Agent': 'startup-manager-app' },
        timeout: 8000,
        family: 4 // force IPv4 : évite les timeouts liés à une résolution IPv6 défaillante sous Windows
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const entry = data && data.entry && data.entry[0];
            resolve((entry && entry.displayName) || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/* ------------------------------------------------------------------ */
/*  Vérification des mises à jour via les releases GitHub             */
/* ------------------------------------------------------------------ */

function parseGithubRepo(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

// Compare deux versions "x.y.z" : renvoie 1 si a > b, -1 si a < b, 0 si égales.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      {
        headers: { 'User-Agent': 'startup-manager-app', Accept: 'application/vnd.github+json' },
        timeout: 10000,
        family: 4 // force IPv4 : évite les timeouts liés à une résolution IPv6 défaillante sous Windows
      },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolve(null); // pas de release publiée
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Délai dépassé en contactant GitHub')));
    req.on('error', reject);
  });
}

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  const repoInfo = parseGithubRepo(armsConfig.githubRepoUrl || '');

  if (!repoInfo) {
    return {
      status: 'error',
      currentVersion,
      message: "Aucun dépôt GitHub valide n'est configuré dans arms.config.js."
    };
  }

  try {
    const release = await fetchLatestRelease(repoInfo.owner, repoInfo.repo);
    if (!release) {
      return {
        status: 'error',
        currentVersion,
        message: 'Aucune release publiée sur ce dépôt pour le moment.'
      };
    }
    const tag = (release.tag_name || '').trim();
    const latestVersion = tag.replace(/^v/i, '');
    const cmp = compareVersions(latestVersion, currentVersion);

    return {
      status: cmp > 0 ? 'update-available' : 'up-to-date',
      currentVersion,
      latestVersion: tag || latestVersion,
      releaseUrl: release.html_url || armsConfig.githubRepoUrl
    };
  } catch (err) {
    console.error('Vérification des mises à jour impossible :', err.message);
    const isTimeout = /timeout/i.test(err.message || '');
    return {
      status: 'error',
      currentVersion,
      message: isTimeout
        ? "La connexion à GitHub a expiré. Vérifiez votre connexion internet (ou un pare-feu/antivirus qui bloquerait l'application) puis réessayez."
        : 'Impossible de contacter GitHub pour vérifier les mises à jour.'
    };
  }
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('get-footer-info', async () => {
  const email = (armsConfig.gravatarEmail || '').trim();
  let avatarUrl = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&s=64';
  let displayName = null;

  if (email) {
    const hash = md5(email);
    avatarUrl = `https://www.gravatar.com/avatar/${hash}?d=mp&s=64`;
    displayName = await fetchGravatarDisplayName(hash);
  }

  return {
    avatarUrl,
    displayName,
    githubRepoUrl: armsConfig.githubRepoUrl || 'https://github.com/'
  };
});

ipcMain.handle('save-apps', (_evt, apps) => {
  const config = loadConfig();
  config.apps = apps;
  saveConfig(config);
  return true;
});

ipcMain.handle('set-auto-launch', async (_evt, enabled) => {
  const config = loadConfig();
  const ok = await setWindowsAutoLaunch(enabled);
  if (ok) {
    config.autoLaunch = enabled;
    saveConfig(config);
  }
  return ok;
});

async function extractIconFromPath(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.exe') {
      const icon = await app.getFileIcon(filePath, { size: 'large' });
      if (icon && !icon.isEmpty()) return icon.toDataURL();
      return null;
    }
    // .ico, .png, .jpg... : nativeImage sait les lire directement
    const img = nativeImage.createFromPath(filePath);
    if (img && !img.isEmpty()) return img.toDataURL();
    // Filet de sécurité : certains .ico passent mieux par getFileIcon
    const icon = await app.getFileIcon(filePath, { size: 'large' });
    if (icon && !icon.isEmpty()) return icon.toDataURL();
    return null;
  } catch (err) {
    console.error('Extraction icône impossible :', err);
    return null;
  }
}

ipcMain.handle('pick-executable', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir une application',
    properties: ['openFile'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'Exécutables', extensions: ['exe'] }]
        : [{ name: 'Toutes les applications', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const execPath = result.filePaths[0];
  const baseName = path.basename(execPath, path.extname(execPath));
  const iconDataUrl = await extractIconFromPath(execPath);

  return { execPath, name: baseName, icon: iconDataUrl };
});

ipcMain.handle('pick-icon', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir une icône',
    properties: ['openFile'],
    filters: [
      { name: 'Icônes et images', extensions: ['ico', 'png', 'jpg', 'jpeg'] },
      { name: 'Extraire depuis un exécutable', extensions: ['exe'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const icon = await extractIconFromPath(result.filePaths[0]);
  return icon ? { icon } : null;
});

ipcMain.handle('extract-icon', async (_evt, execPath) => {
  if (!execPath || !fs.existsSync(execPath)) return null;
  const icon = await extractIconFromPath(execPath);
  return icon ? { icon } : null;
});

ipcMain.handle('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.handle('window-close', () => mainWindow && mainWindow.close());

/* ------------------------------------------------------------------ */
/*  Cycle de vie de l'app                                              */
/* ------------------------------------------------------------------ */

if (IS_STARTUP_RUN) {
  app.whenReady().then(runStartupSequence);
} else {
  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
