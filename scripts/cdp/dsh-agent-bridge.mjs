/**
 * DshAgentBridge - Biblioteca e SDK para comunicação inter-agentes com o DeepSeek Harness via CDP.
 *
 * Permite que qualquer IA, script ou processo externo:
 * - Inspecione mensagens e estado do chat em tempo real
 * - Envie mensagens e comandos para o agente ativo
 * - Aguarde a conclusão de raciocínio profundo e execução de ferramentas
 * - Capture screenshots visuais da interface
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

export class DshAgentBridge {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9223;
    this.ws = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
  }

  /**
   * Conecta ao DevTools Protocol da janela do Electron/DSH.
   */
  async connect() {
    const listUrl = `http://${this.host}:${this.port}/json/list`;
    let targets;
    try {
      const res = await fetch(listUrl);
      targets = await res.json();
    } catch (err) {
      throw new Error(`Não foi possível conectar ao CDP em ${listUrl}. Verifique se o DSH está rodando com --remote-debugging-port=${this.port}. Detalhes: ${err.message}`);
    }

    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error(`Nenhum alvo de página encontrado em ${listUrl}. Alvos disponíveis: ${JSON.stringify(targets)}`);
    }

    this.targetInfo = pageTarget;
    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.pendingRequests.has(data.id)) {
          const { resolve, reject } = this.pendingRequests.get(data.id);
          this.pendingRequests.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      } catch (e) {
        // Ignora frames não-JSON
      }
    };

    return this.targetInfo;
  }

  /**
   * Envia comando JSON-RPC nativo do CDP.
   */
  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket não está conectado. Chame connect() primeiro.');
    }
    const msgId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  /**
   * Executa expressão JavaScript no contexto do renderer.
   */
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result ? res.result.value : undefined;
  }

  /**
   * Obtém status detalhado da execução atual (streaming, modelo, tokens, ferramentas).
   */
  async getStatus() {
    return await this.evaluate(`
      (() => {
        const stopBtn = document.querySelector('button[aria-label*="Parar"], button[aria-label*="Interromper"], button[aria-label*="Cancelar"]');
        const isStreaming = !!stopBtn;

        // Indicador de raciocínio / status
        const statusEl = document.querySelector('[class*="reasoning"], [class*="thinking"]');
        const statusText = statusEl ? statusEl.innerText.trim() : null;

        // Métricas e pills inferiores
        const pills = Array.from(document.querySelectorAll('button[class*="pill"], [class*="pill"]'))
          .map(el => el.innerText.trim())
          .filter(Boolean);

        // Barra superior (tarefas em segundo plano)
        const topBarText = document.querySelector('header, [role="banner"], [class*="header"]')?.innerText || '';
        const bgTasksMatch = topBarText.match(/Tarefas em segundo plano em execução:\\s*(\\d+)/i);
        const backgroundTasks = bgTasksMatch ? parseInt(bgTasksMatch[1], 10) : 0;

        // Última ferramenta ou ação
        const runningToolEl = document.querySelector('[class*="tool-running"], [class*="running"]');
        const runningTool = runningToolEl ? runningToolEl.innerText.trim() : null;

        return {
          isStreaming,
          statusText,
          backgroundTasks,
          runningTool,
          pills,
          title: document.title,
        };
      })()
    `);
  }

  /**
   * Lê as mensagens do chat, blocos de raciocínio e ferramentas executadas.
   */
  async getMessages(options = {}) {
    const limit = options.limit || 20;
    return await this.evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll('[class*="flowItem"]'));
        const parsed = [];

        for (const item of items) {
          const text = item.innerText.trim();
          if (!text) continue;

          let type = 'message';
          let role = 'assistant';

          if (text.startsWith('Pense\\n') || text === 'Pense') {
            type = 'thought';
            role = 'assistant';
          } else if (/^(Bash|Leia|Escreva|Editar|Buscar|Listar|Ler saída do trabalho|Correndo)/i.test(text)) {
            type = 'tool';
            role = 'assistant';
          } else if (item.querySelector('[class*="user"], [class*="right"]') || /\\n\\d{2}:\\d{2}$/.test(text)) {
            type = 'user-message';
            role = 'user';
          }

          parsed.push({
            type,
            role,
            text,
            summary: text.split('\\n')[0],
            snippet: text.slice(0, 300)
          });
        }

        return parsed.slice(-${limit});
      })()
    `);
  }

  /**
   * Envia uma mensagem para o chat do DSH simulando entrada de usuário segura.
   */
  async sendMessage(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('O texto da mensagem é obrigatório.');
    }

    // Foca na caixa de texto
    const focusRes = await this.evaluate(`
      (() => {
        const input = document.querySelector('div[contenteditable="true"][role="textbox"], textarea[placeholder*="mensagem"], textarea');
        if (!input) return { found: false };
        input.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        sel.removeAllRanges();
        sel.addRange(range);
        return { found: true };
      })()
    `);

    if (!focusRes || !focusRes.found) {
      throw new Error('Não foi possível encontrar o campo de digitação do chat.');
    }

    // Limpa texto anterior se houver
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });

    // Insere o texto completo via CDP (compatível com Slate / ProseMirror / React state)
    await this.send('Input.insertText', { text });

    // Pequena pausa para sincronização do estado reativo
    await new Promise(r => setTimeout(r, 400));

    // Clica no botão Enviar
    const clickRes = await this.evaluate(`
      (() => {
        const sendBtn = document.querySelector('button[aria-label*="Enviar"], button[title*="Enviar"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return { sent: true };
        }
        return { sent: false, disabled: sendBtn?.disabled };
      })()
    `);

    if (!clickRes || !clickRes.sent) {
      throw new Error(`Falha ao acionar botão Enviar: ${JSON.stringify(clickRes)}`);
    }

    return { sent: true, textLength: text.length };
  }

  /**
   * Aguarda o término da geração / execução autônoma atual.
   */
  async waitForCompletion(options = {}) {
    const timeoutMs = options.timeoutMs || 300_000; // 5 minutos padrão
    const pollIntervalMs = options.pollIntervalMs || 2_500;
    const onProgress = options.onProgress || null;

    const startTime = Date.now();
    // Aguarda início
    await new Promise(r => setTimeout(r, 1000));

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getStatus();
      if (onProgress) {
        onProgress({
          elapsedSec: Math.round((Date.now() - startTime) / 1000),
          ...status
        });
      }

      if (!status.isStreaming && status.backgroundTasks === 0) {
        return { completed: true, durationSec: Math.round((Date.now() - startTime) / 1000), status };
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`Timeout atingido (${timeoutMs}ms) aguardando conclusão.`);
  }

  /**
   * Captura screenshot visual da janela atual do DSH.
   */
  async captureScreenshot(outputPath) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(result.data, 'base64');
    const resolvedPath = path.resolve(outputPath || `screenshot-${Date.now()}.png`);
    writeFileSync(resolvedPath, buffer);
    return resolvedPath;
  }

  /**
   * Encerra a conexão WebSocket com o CDP.
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
