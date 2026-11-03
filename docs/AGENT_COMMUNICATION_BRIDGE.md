# Guia de Comunicação Inter-Agentes e Automação (DSH Agent Bridge)

Este documento descreve a arquitetura e os métodos padronizados no DeepSeek Harness para permitir que **IAs externas, scripts de teste ou agentes autônomos** interajam programaticamente com a interface do usuário do DSH.

---

## 1. Por que CDP (Chrome DevTools Protocol)?

Ao invés de emular eventos de teclado no nível do sistema operacional (como xdotool, PyAutoGUI) que dependem de foco na janela, quebram em Wayland/X11 e são frágeis:
- O **CDP opera direto no motor de renderização Chromium do Electron**.
- **Funciona em segundo plano:** A janela pode estar minimizada ou sem foco.
- **Suporte ao Slate.js / React:** `Input.insertText` aciona os eventos nativos do navegador (`beforeinput`, `input`), atualizando os estados de DOM virtual sem corromper nós de texto.
- **Leitura estruturada de elementos:** Permite extrair o estado reativo diretamente do DOM (ferramentas ativas, blocos `<think>` colapsados, tokens consumidos).

---

## 2. Inicialização e Porta

O Electron inicia com o switch:
```bash
--remote-debugging-port=9223
```
Configurado automaticamente em [`linux-desktop/run.mjs`](file:///home/kaua/deepseek-harness/linux-desktop/run.mjs).

A porta `9223` expõe:
- `http://127.0.0.1:9223/json/list` (Metadados das páginas/janelas ativas).
- `ws://127.0.0.1:9223/devtools/page/<PAGE_ID>` (Canal WebSocket bidirecional).

---

## 3. Comandos Rápidos Disponíveis

No repositório `/home/kaua/deepseek-harness`:

| Comando | Descrição |
| :--- | :--- |
| `pnpm dsh:bridge status` | Exibe se o modelo está gerando, passos concluídos, métricas de tokens e ferramentas em execução. |
| `pnpm dsh:bridge read --limit 10` | Lê os últimos 10 itens do fluxo (separando mensagens de usuário, blocos `Pense` e ferramentas). |
| `pnpm dsh:bridge send "<texto>"` | Digita e envia uma mensagem para o chat ativo. |
| `pnpm dsh:bridge screenshot [path.png]` | Captura a imagem completa da janela do app. |
| `pnpm dsh:bridge wait --timeout 300` | Bloqueia a execução até que o modelo e as tarefas terminem. |
| `pnpm dsh:bridge monitor --duration 60` | Acompanha a execução em tempo real pelo terminal. |

---

## 4. Estrutura do Código

- **SDK:** [`scripts/cdp/dsh-agent-bridge.mjs`](file:///home/kaua/deepseek-harness/scripts/cdp/dsh-agent-bridge.mjs)
- **CLI:** [`scripts/cdp/cli.mjs`](file:///home/kaua/deepseek-harness/scripts/cdp/cli.mjs)
- **Instruções e Exemplos:** [`scripts/cdp/README.md`](file:///home/kaua/deepseek-harness/scripts/cdp/README.md)
