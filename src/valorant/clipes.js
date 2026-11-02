/**
 * Os clipes que o Outplayed grava das partidas DELE.
 *
 * Pedido dele, duas vezes: "o meu outplayed grava toda partida minha, já fiz várias
 * lineups, consegue usar esses vídeos?". Consegue — com uma ressalva que vale escrita,
 * porque muda o que dá pra construir.
 *
 * MEDIDO na pasta dele em 02/11: são 1.066 clipes somando 6,2 h em 16,8 GB, com mediana de
 * 14 s cada (de 5 s a 86 s). NÃO há vídeo de partida inteira do Valorant — pra League of
 * Legends e iRacing o Outplayed grava a partida toda (arquivos de 1,5 a 20 GB), pro
 * Valorant ele grava só destaque. Das quatro partidas da noite, o que está em vídeo é
 * entre 8% e 13% de cada uma, em 5 a 9 pedaços soltos. Então o que dá pra oferecer é
 * "seus clipes deste mapa", não "reveja a partida".
 *
 * O que o nome do arquivo diz e o que não diz: "VALORANT 11-02-2026 1-38-11-281_3.mp4"
 * traz a data e a hora do LOTE, e o `_N` é o número do destaque dentro dele (conferido:
 * quatro arquivos com o mesmo carimbo e durações diferentes, 13 a 29 s, gravados no mesmo
 * segundo). O que o nome não diz é o MAPA — e é aí que entra o diário de partidas
 * (`partidas.js`), que guarda mapa, agente e janela de cada partida desde a 2.28.284.
 *
 * Nada aqui abre, converte ou lê o conteúdo de vídeo nenhum: é nome de arquivo, tamanho e
 * a miniatura que o próprio Outplayed já gerou.
 */
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { partidasGuardadas } from './partidas.js';

/* O Outplayed guarda uma pasta por SESSÃO e, dentro dela, os clipes e um `Thumbnails/`
 * com uma miniatura por lote. A sessão pode durar horas e atravessar várias partidas. */
/* DOIS PADRÕES DE NOME, e isso é medido na pasta dele.
 *
 * O destaque antigo vem como "VALORANT 11-02-2026 1-38-11-281_3.mp4" — maiúscula, espaços,
 * e `_N` pro número do destaque dentro do lote. A gravação nova vem como
 * "Valorant_11-02-2026_5-28-10-133.mp4" — caixa mista, underscore, e SEM `_N`.
 *
 * Contado em 02/11: 1.066 arquivos no padrão velho e 10 no novo. Ou seja, se eu tivesse
 * soltado isto como estava no ramo, os 10 novos — inclusive a partida inteira que ele
 * gravou — não seriam lidos. */
/* Hora, minuto e segundo v\u00eam com UM ou dois d\u00edgitos no padr\u00e3o novo \u2014 "5-0-19-0" \u00e9 5h00m19s.
 * Com `{2}` cravado, cinco dos dez arquivos novos n\u00e3o casavam, e entre eles estavam quatro
 * destaques da mesma sess\u00e3o em que ele gravou a partida inteira. A data continua 2-2-4,
 * que essa n\u00e3o varia. Conferido depois: 1.076 de 1.076 arquivos do disco agora casam. */
const CLIPE = /^Valorant[ _](\d{2})-(\d{2})-(\d{4})[ _](\d{1,2})-(\d{1,2})-(\d{1,2})-(\d+?)(?:_(\d+))?\.mp4$/i;

/* O QUE É PARTIDA INTEIRA E O QUE É DESTAQUE.
 *
 * No padrão novo os dois vêm sem `_N`, então o nome não separa — quem separa é o tamanho.
 * Medido na pasta dele: a partida inteira tem **1.077 MB para 23,2 min** (uns 46 MB por
 * minuto) e o maior destaque de todos os 1.076 arquivos tem **66 MB / 86 s**. Qualquer
 * corte entre 70 e 1.000 MB separa os dois; 150 MB dá mais de 3 minutos de folga pros
 * dois lados, que é margem pra bitrate diferente sem confundir destaque com partida. */
const LIMITE_PARTIDA = 150 * 1024 * 1024;

/** Onde procurar sem ele configurar nada. A pasta dele é D:, mas isso não é regra. */
function candidatos() {
  const fora = [];
  const lar = process.env.USERPROFILE || process.env.HOME || '';
  for (const letra of 'DEFCGH') fora.push(`${letra}:${sep}Outplayed${sep}VALORANT`);
  if (lar) {
    fora.push(join(lar, 'Documents', 'Outplayed', 'VALORANT'));
    fora.push(join(lar, 'Videos', 'Outplayed', 'VALORANT'));
  }
  return fora;
}

/**
 * A pasta dos clipes: a do config se ele disser, senão a primeira que existir.
 * Devolve null quando não há nenhuma — e aí a tela diz isso em vez de ficar vazia.
 */
export function pastaDosClipes(config = {}) {
  const dito = config?.valorant?.clipes;
  if (dito) return existsSync(dito) ? dito : null;
  return candidatos().find((p) => { try { return existsSync(p); } catch { return false; } }) ?? null;
}

/** O carimbo de hora que está no nome do arquivo, em ms. */
function horaDoNome(m) {
  const [, mes, dia, ano, h, mi, s, ms] = m;
  // o campo dos milissegundos vem com 1 a 3 dígitos; "281" é 281 ms, "66" é 66 ms
  return new Date(+ano, +mes - 1, +dia, +h, +mi, +s, Number(String(ms).slice(0, 3))).getTime();
}

/* Varrer mil e tantos arquivos a cada clique seria desperdício: ele não grava um clipe
 * por segundo. Vinte segundos é curto o bastante pra um clipe novo aparecer enquanto ele
 * olha a tela, e longo o bastante pra não ler o disco à toa. */
let guardado = { pasta: null, em: 0, lotes: [] };
const VALE_POR = 20_000;

/** Os lotes de clipes da pasta, do mais novo pro mais velho. */
export async function lotesDeClipes({ pasta, agora = Date.now(), forcar = false } = {}) {
  if (!pasta) return [];
  if (!forcar && guardado.pasta === pasta && agora - guardado.em < VALE_POR) return guardado.lotes;

  const porLote = new Map();
  let sessoes = [];
  try { sessoes = await readdir(pasta, { withFileTypes: true }); } catch { return []; }

  for (const s of sessoes) {
    if (!s.isDirectory()) continue;
    const dentro = join(pasta, s.name);
    let arquivos = [];
    try { arquivos = await readdir(dentro); } catch { continue; }
    const miniaturas = new Set();
    try { for (const t of await readdir(join(dentro, 'Thumbnails'))) miniaturas.add(t); } catch { /* sessão sem miniatura */ }

    for (const nome of arquivos) {
      const m = CLIPE.exec(nome);
      if (!m) continue;
      const em = horaDoNome(m);
      if (!Number.isFinite(em)) continue;
      const base = nome.replace(/(_\d+)?\.mp4$/i, '');
      const chave = `${s.name}/${base}`;
      if (!porLote.has(chave)) {
        const mini = `${base}.jpg`;
        porLote.set(chave, {
          chave, em, sessao: s.name, inteira: false,
          miniatura: miniaturas.has(mini) ? `${s.name}/Thumbnails/${mini}` : null,
          partes: [],
        });
      }
      let tamanho = 0;
      try { tamanho = (await stat(join(dentro, nome))).size; } catch { /* sumiu no meio */ }
      const lote = porLote.get(chave);
      lote.partes.push({ arquivo: `${s.name}/${nome}`, parte: Number(m[8] ?? 0), tamanho });
      if (tamanho >= LIMITE_PARTIDA) lote.inteira = true;
    }
  }

  const lotes = [...porLote.values()]
    .map((l) => ({ ...l, partes: l.partes.sort((a, b) => a.parte - b.parte) }))
    .sort((a, b) => b.em - a.em);
  guardado = { pasta, em: agora, lotes };
  return lotes;
}

/** só pros testes e pro "atualizar": esquece a varredura guardada */
export function esquecerClipes() { guardado = { pasta: null, em: 0, lotes: [] }; }

/**
 * Os clipes dele de um mapa (e, se pedir, de um agente), pela ponte do diário.
 *
 * A `folga` existe porque o carimbo do nome é o começo do LOTE e o laço do app só olha o
 * estado de 6 em 6 segundos: dois minutos cobrem a diferença sem invadir a partida
 * seguinte. É a mesma folga do `partidaEm`, pelo mesmo motivo.
 */
export async function meusClipes({ pasta, mapa = null, agenteId = null, limite = 24, folga = 2 * 60 * 1000 } = {}) {
  if (!pasta) return { pasta: null, partidas: 0, clipes: [], porque: 'não achei a pasta do Outplayed' };
  const partidas = (await partidasGuardadas())
    .filter((p) => (!mapa || p.mapa === mapa) && (!agenteId || !p.agenteId || p.agenteId === agenteId));
  if (!partidas.length) {
    return {
      pasta, partidas: 0, clipes: [],
      porque: 'o diário ainda não tem partida sua neste mapa — ele começa a anotar quando você joga',
    };
  }
  const lotes = await lotesDeClipes({ pasta });
  const dentro = [];
  for (const l of lotes) {
    const p = partidas.find((x) => l.em >= x.em - folga && l.em <= x.fim + folga);
    if (!p) continue;
    dentro.push({ ...l, mapa: p.mapa, agenteId: p.agenteId ?? null, daPartidaEm: p.em });
    if (dentro.length >= limite) break;
  }
  return {
    pasta, partidas: partidas.length, clipes: dentro,
    porque: dentro.length ? null : 'você jogou neste mapa, mas o Outplayed não guardou clipe dessas partidas',
  };
}

/**
 * O caminho real de um arquivo que a tela pediu — e a cerca.
 *
 * A tela manda o caminho RELATIVO à pasta dos clipes, nunca o absoluto. Aqui ele é
 * resolvido e conferido: se sair da pasta, não existe. Sem isto, um `..` no endereço viraria
 * leitura de qualquer arquivo do PC dele pela porta 8770.
 */
export function arquivoDeClipe(pasta, relativo) {
  if (!pasta || !relativo || typeof relativo !== 'string') return null;
  if (relativo.includes('\0') || isAbsolute(relativo)) return null;
  const alvo = resolve(pasta, relativo);
  const dentro = relative(resolve(pasta), alvo);
  if (!dentro || dentro.startsWith('..') || isAbsolute(dentro)) return null;
  if (!/\.(mp4|jpg|jpeg|png)$/i.test(alvo)) return null;
  return existsSync(alvo) ? alvo : null;
}
