import { app, BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ICON_PATH = path.join(REPO_ROOT, 'apps/web/dist/icon-512.png');
const TOKEN_FILE = path.join(process.env.HOME || '/home/kaua', '.dsh/last-token.txt');
const PORT = 3080;

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function ensureServerRunning() {
  const open = await isPortOpen(PORT);
  if (open) {
    let token = '';
    if (existsSync(TOKEN_FILE)) {
      token = readFileSync(TOKEN_FILE, 'utf8').trim();
    }
    return `http://127.0.0.1:${PORT}/${token ? `?token=${token}` : ''}`;
  }

  // Start server
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/pnpm', ['dsh', 'web', '--no-open'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.unref();

    let resolved = false;
    let accumulated = '';

    const onData = (data) => {
      accumulated += data.toString();
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(accumulated);
      if (match && !resolved) {
        resolved = true;
        const fullUrl = match[1];
        const tokenMatch = /token=([^&\s]+)/.exec(fullUrl);
        if (tokenMatch) {
          writeFileSync(TOKEN_FILE, tokenMatch[1], 'utf8');
        }
        resolve(fullUrl);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    setTimeout(() => {
      if (!resolved) {
        resolve(`http://127.0.0.1:${PORT}/`);
      }
    }, 12000);
  });
}

app.whenReady().then(async () => {
  const targetUrl = await ensureServerRunning();

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in user's default browser
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.loadURL(targetUrl);
});

app.on('window-all-closed', () => {
  app.quit();
});
