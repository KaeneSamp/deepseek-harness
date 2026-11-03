#!/usr/bin/env node
/**
 * DSH Agent Bridge CLI - Ferramenta de linha de comando para interagir com o DeepSeek Harness via CDP.
 *
 * Uso:
 *   node scripts/cdp/cli.mjs status
 *   node scripts/cdp/cli.mjs read [--limit 10]
 *   node scripts/cdp/cli.mjs send "Texto da mensagem"
 *   node scripts/cdp/cli.mjs screenshot [arquivo.png]
 *   node scripts/cdp/cli.mjs wait [--timeout 300]
 *   node scripts/cdp/cli.mjs monitor [--duration 60]
 */

import { DshAgentBridge } from './dsh-agent-bridge.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'help';

function printHelp() {
  console.log(`
DeepSeek Harness - Agent Bridge CLI (CDP)

Comandos disponíveis:
  status                   Exibe o status do modelo (streaming, passos, ferramentas rodando)
  read [--limit N]         Lê as últimas mensagens, blocos de pensamento e ferramentas chamadas
  send "<mensagem>"        Digita e envia uma mensagem para o chat do assistente
  screenshot [arquivo.png] Salva um screenshot visual da janela do app
  wait [--timeout N]       Aguarda até o agente terminar a geração e execução de comandos
  monitor [--duration N]   Monitora o fluxo em tempo real a cada 2.5s
  help                     Exibe esta ajuda

Exemplos:
  node scripts/cdp/cli.mjs status
  node scripts/cdp/cli.mjs send "Execute os testes unitários"
  node scripts/cdp/cli.mjs screenshot /tmp/evidencia.png
`);
}

async function main() {
  const bridge = new DshAgentBridge();

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      printHelp();
      return;
    }

    await bridge.connect();

    switch (command) {
      case 'status': {
        const status = await bridge.getStatus();
        console.log('\n=== Status do DeepSeek Harness ===');
        console.log(`Título da Janela:     ${status.title}`);
        console.log(`Streaming Ativo:      ${status.isStreaming ? 'Sim (Gerando / Raciocinando)' : 'Não (Ocioso / Concluído)'}`);
        if (status.statusText) console.log(`Indicador Atual:      ${status.statusText}`);
        if (status.runningTool) console.log(`Ferramenta em Exec.:  ${status.runningTool}`);
        console.log(`Tarefas em 2º Plano:  ${status.backgroundTasks}`);
        if (status.pills.length > 0) console.log(`Métricas / Pills:     ${status.pills.join(' | ')}`);
        console.log('===================================\n');
        break;
      }

      case 'read': {
        const limitArgIndex = args.indexOf('--limit');
        const limit = limitArgIndex !== -1 ? parseInt(args[limitArgIndex + 1], 10) : 10;
        const messages = await bridge.getMessages({ limit });
        console.log(`\n=== Itens do Fluxo do Chat (últimos ${messages.length}) ===`);
        for (const msg of messages) {
          if (msg.type === 'user-message') {
            console.log(`\n👤 USUÁRIO:`);
            console.log(`   ${msg.text}`);
          } else if (msg.type === 'thought') {
            console.log(`\n🧠 PENSE:`);
            const lines = msg.text.split('\n').filter(l => l !== 'Pense');
            console.log(`   ${lines.join('\n   ').slice(0, 400)}${msg.text.length > 400 ? '...' : ''}`);
          } else if (msg.type === 'tool') {
            console.log(`\n⚡ FERRAMENTA:`);
            console.log(`   ${msg.text.replace(/\n+/g, ' · ')}`);
          } else {
            console.log(`\n🤖 RESPOSTA:`);
            console.log(`   ${msg.text.slice(0, 500)}${msg.text.length > 500 ? '...' : ''}`);
          }
        }
        console.log('\n============================================\n');
        break;
      }

      case 'send': {
        const text = args[1];
        if (!text) {
          console.error('Erro: informe o texto da mensagem. Exemplo: node scripts/cdp/cli.mjs send "Olá"');
          process.exit(1);
        }
        console.log(`Enviando mensagem (${text.length} caracteres)...`);
        const res = await bridge.sendMessage(text);
        console.log('Mensagem enviada com sucesso no chat!', res);
        break;
      }

      case 'screenshot': {
        const outputPath = args[1] || `dsh-screenshot-${Date.now()}.png`;
        const savedPath = await bridge.captureScreenshot(outputPath);
        console.log(`Screenshot salvo com sucesso em: ${savedPath}`);
        break;
      }

      case 'wait': {
        const timeoutIdx = args.indexOf('--timeout');
        const timeoutSec = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 300;
        console.log(`Aguardando conclusão (timeout: ${timeoutSec}s)...`);
        const result = await bridge.waitForCompletion({
          timeoutMs: timeoutSec * 1000,
          onProgress: (p) => {
            process.stdout.write(`\r[T+${p.elapsedSec}s] Streaming: ${p.isStreaming} | Ferramenta: ${p.runningTool || 'nenhuma'} | Tarefas: ${p.backgroundTasks}`);
          }
        });
        console.log(`\nConcluído em ${result.durationSec}s!`);
        break;
      }

      case 'monitor': {
        const durationIdx = args.indexOf('--duration');
        const durationSec = durationIdx !== -1 ? parseInt(args[durationIdx + 1], 10) : 60;
        console.log(`Iniciando monitoramento ao vivo por ${durationSec}s...`);
        const start = Date.now();
        while (Date.now() - start < durationSec * 1000) {
          const status = await bridge.getStatus();
          const elapsed = Math.round((Date.now() - start) / 1000);
          console.log(`[T+${elapsed}s] Streaming: ${status.isStreaming} | Status: "${status.statusText || 'ok'}" | Ferramenta: "${status.runningTool || '-'}" | Tasks: ${status.backgroundTasks}`);
          await new Promise(r => setTimeout(r, 2500));
        }
        console.log('Monitoramento concluído.');
        break;
      }

      default:
        console.error(`Comando desconhecido: "${command}". Use "help" para ver os comandos.`);
        process.exit(1);
    }
  } catch (err) {
    console.error('Erro na execução do Agent Bridge:', err.message);
    process.exit(1);
  } finally {
    bridge.disconnect();
  }
}

main();
