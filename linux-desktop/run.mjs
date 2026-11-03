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
const CDP_PORT = 9223;

// Enable Chrome Remote Debugging Protocol (CDP) for automation and inter-agent bridging
if (!app.commandLine.hasSwitch('remote-debugging-port')) {
  app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));
}

let serverProcess = null;

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

function killServer() {
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
    } catch (_) {
      try {
        serverProcess.kill('SIGTERM');
      } catch (_) {}
    }
    serverProcess = null;
  }
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

  // Start fresh server
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/pnpm', ['dsh', 'web', '--no-open'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    serverProcess = child;

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
        let token = '';
        if (existsSync(TOKEN_FILE)) {
          token = readFileSync(TOKEN_FILE, 'utf8').trim();
        }
        resolve(`http://127.0.0.1:${PORT}/${token ? `?token=${token}` : ''}`);
      }
    }, 10000);
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
    backgroundColor: '#131418',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Self-healing: if renderer crashes or hangs, automatically reload
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('Renderer process gone:', details.reason, '- reloading...');
    setTimeout(() => {
      mainWindow.loadURL(targetUrl);
    }, 500);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Window became unresponsive, reloading...');
    mainWindow.reload();
  });

  // Keyboard shortcuts: Ctrl+R / F5 for reload, Ctrl+Shift+I for DevTools
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      mainWindow.reload();
    }
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.loadURL(targetUrl);
});

app.on('before-quit', () => {
  killServer();
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});
