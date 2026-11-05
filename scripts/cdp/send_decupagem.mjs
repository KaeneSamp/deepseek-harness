import { DshAgentBridge } from './dsh-agent-bridge.mjs';
import fs from 'fs';

const TICKS = 254016000000;
const PROJ_PATH = '/home/kaua/Videos/scrp/scrp_edit.fcproj';

async function main() {
  const proj = JSON.parse(fs.readFileSync(PROJ_PATH, 'utf-8'));
  const caps = proj.project.items['10'].kind.Sequence.caption_tracks[0].captions;

  const blocks = [];
  let cur = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    cur.push(c);
    let isEnd = false;
    const txt = c.text.trim();
    if (txt.endsWith('.') || txt.endsWith('?') || txt.endsWith('!') || txt.endsWith('...')) isEnd = true;
    if (i < caps.length - 1) {
      const next = caps[i + 1];
      const gap = (next.start - (c.start + c.duration)) / TICKS;
      if (gap > 0.5) isEnd = true;
    } else {
      isEnd = true;
    }
    if (isEnd && cur.length) {
      const st_s = cur[0].start / TICKS;
      const words = cur.map(x => x.text).join(' ');
      blocks.push({
        id: blocks.length + 1,
        st_s,
        text: words
      });
      cur = [];
    }
  }

  const lines = blocks.map(b => {
    const mm = String(Math.floor(b.st_s / 60)).padStart(2, '0');
    const ss = String(Math.floor(b.st_s % 60)).padStart(2, '0');
    const id = String(b.id).padStart(3, '0');
    return `[B${id}|${mm}:${ss}] ${b.text}`;
  });

  const prompt = `Você é um editor sênior de YouTube focado em gameplay, retenção máxima e humor de GTA RP / MTA.

SUA MISSÃO:
Decupar os 10 minutos brutos abaixo, reduzindo de 10 min para aproximadamente 5 a 6 minutos de vídeo ágil, dinâmico e engraçado (cerca de 40% a 50% de cortes).

REGRAS ESTRITAS DE FORMATO:
1. Toda palavra da transcrição original DEVE ser mantida (não reescreva nem invente palavras).
2. Para cada linha, decida:
   - Se MANTER: use \`- [x] [Bxxx|MM:SS] texto...\`
     (Se quiser cortar gagueiras ou palavras soltas dentro da linha mantida, risque APENAS essas palavras com \`~~palavra~~\`).
   - Se CORTAR: use \`- [ ] [Bxxx|MM:SS] [CORTE: motivo do corte] texto...\`
     (Ex: [CORTE: Menu de opções sem piada], [CORTE: Conversa técnica sem graça], [CORTE: Silêncio/tela preta], [CORTE: Repetição de assunto]).
3. Seja cirúrgico: priorize piadas, farpas, risadas e reações espontâneas. Elimine gorduras e enrolações.
4. Mantenha os identificadores [Bxxx|MM:SS] no início de cada linha.

TRANSCRIÇÃO BRUTA (191 BLOCOS):
${lines.join('\n')}

Retorne o roteiro decupado completo com o relatório do motivo em cada corte.`;

  console.log('Conectando ao DSH via CDP...');
  const bridge = new DshAgentBridge();
  await bridge.connect();

  console.log(`Enviando prompt (${prompt.length} caracteres, 191 blocos) para o DeepSeek R1 no DSH...`);
  const res = await bridge.sendMessage(prompt);
  console.log('Mensagem enviada com sucesso no DSH!', res);
}

main().catch(console.error);
