# DSH Agent Bridge (Comunicação Inter-Agentes via CDP)

O **DSH Agent Bridge** é o módulo oficial do projeto para permitir que **outras IAs, agentes autônomos ou scripts externos** se comuniquem diretamente com o DeepSeek Harness (DSH) em tempo real, sem necessidade de servidores extras ou hacks de teclado.

---

## 🛠️ Como Funciona Sob o Capô

O DeepSeek Harness desktop roda sobre o Electron/Chromium com a porta de depuração remota ativada:
```
--remote-debugging-port=9223
```
*(Configurado automaticamente em [`linux-desktop/run.mjs`](file:///home/kaua/deepseek-harness/linux-desktop/run.mjs)).*

Isso expõe a API padrão do **Chrome DevTools Protocol (CDP)**:
1. **Descoberta:** `GET http://127.0.0.1:9223/json/list` retorna os metadados da janela e o endereço `webSocketDebuggerUrl`.
2. **WebSocket Nativo:** O bridge conecta ao WebSocket e executa chamadas RPC bidirecionais com o motor V8 do Chromium.
3. **Injeção de Texto Segura:** Usa `Input.insertText` e `Input.dispatchKeyEvent`, simulando digitação real e respeitando os manipuladores do Slate.js / React (evitando perda de foco e dessincronização de estado).
4. **Leitura Estruturada:** Consulta elementos do fluxo (`[class*="flowItem"]`), separando com precisão blocos de raciocínio profundo (`Pense`), chamadas de ferramentas (`Bash`, `Leia`, etc.) e respostas finais.
5. **Captura Visual:** Utiliza `Page.captureScreenshot` para gerar imagens PNG da janela do assistente.

---

## 🚀 Uso Rápido via CLI (Terminal ou Scripts)

Você pode usar o comando rápido adicionado no repositório:

```bash
# Ver status do modelo, tokens, turnos, etapas e se está raciocinando
pnpm dsh:bridge status

# Ler o fluxo recente (mensagens, pensamentos e ferramentas)
pnpm dsh:bridge read --limit 10

# Enviar uma mensagem / instrução para o chat ativo
pnpm dsh:bridge send "Execute os testes da suite e me envie o relatório"

# Tirar um print da tela da janela do app
pnpm dsh:bridge screenshot evidencia.png

# Aguardar o modelo terminar de raciocinar e rodar comandos
pnpm dsh:bridge wait --timeout 180

# Monitorar a execução ao vivo segundo a segundo
pnpm dsh:bridge monitor --duration 60
```

---

## 💻 Uso como Módulo / SDK (Node.js / TypeScript)

Qualquer agente pode importar a classe [`DshAgentBridge`](file:///home/kaua/deepseek-harness/scripts/cdp/dsh-agent-bridge.mjs):

```javascript
import { DshAgentBridge } from './scripts/cdp/dsh-agent-bridge.mjs';

const bridge = new DshAgentBridge({ port: 9223 });
await bridge.connect();

// 1. Inspeciona o estado
const status = await bridge.getStatus();
console.log('Está gerando:', status.isStreaming);

// 2. Lê histórico estruturado
const items = await bridge.getMessages({ limit: 5 });
for (const item of items) {
  console.log(`[${item.type}] ${item.snippet}`);
}

// 3. Envia uma instrução
await bridge.sendMessage('Por favor, gere a documentação da API');

// 4. Aguarda a conclusão autônoma
await bridge.waitForCompletion({
  timeoutMs: 120_000,
  onProgress: (p) => console.log(`[T+${p.elapsedSec}s] ${p.statusText}`)
});

// 5. Salva screenshot visual
await bridge.captureScreenshot('./resultado.png');

bridge.disconnect();
```

---

## 🐍 Exemplo de Integração em Python

Se outra IA ou script estiver em Python:

```python
import json
import urllib.request
import asyncio
import websockets

async def talk_to_dsh(message_text: str):
    # 1. Obtém a URL do WebSocket
    res = urllib.request.urlopen("http://127.0.0.1:9223/json/list")
    targets = json.loads(res.read())
    page = next(t for t in targets if t.get("type") == "page")
    ws_url = page["webSocketDebuggerUrl"]

    # 2. Conecta ao CDP
    async with websockets.connect(ws_url) as ws:
        # Foca no input
        await ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": "document.querySelector('div[contenteditable=\"true\"]').focus()"}
        }))
        await ws.recv()

        # Insere texto
        await ws.send(json.dumps({
            "id": 2,
            "method": "Input.insertText",
            "params": {"text": message_text}
        }))
        await ws.recv()

        # Clica no botão Enviar
        await ws.send(json.dumps({
            "id": 3,
            "method": "Runtime.evaluate",
            "params": {"expression": "document.querySelector('button[aria-label*=\"Enviar\"]').click()"}
        }))
        await ws.recv()
        print("Mensagem transmitida com sucesso para o DSH!")

asyncio.run(talk_to_dsh("Olá do Python!"))
```

---

## 📂 Arquivos no Projeto

- [`scripts/cdp/dsh-agent-bridge.mjs`](file:///home/kaua/deepseek-harness/scripts/cdp/dsh-agent-bridge.mjs): Biblioteca núcleo / SDK CDP.
- [`scripts/cdp/cli.mjs`](file:///home/kaua/deepseek-harness/scripts/cdp/cli.mjs): Interface CLI completa para terminal.
- [`linux-desktop/run.mjs`](file:///home/kaua/deepseek-harness/linux-desktop/run.mjs): Configuração da porta CDP `9223` por padrão.
- [`package.json`](file:///home/kaua/deepseek-harness/package.json): Atalho `pnpm dsh:bridge`.
