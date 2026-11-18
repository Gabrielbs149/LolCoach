/**
 * Ler os arquivos do CS2 de dentro dos pacotes .vpk do jogo DELE.
 *
 * Por que daqui e não de um site: a arte dos mapas do Valorant vem de uma API pública e
 * oficial (valorant-api.com), mas no CS não existe equivalente — o radar de cada mapa mora
 * dentro do próprio jogo. Baixar de um espelho qualquer seria depender de um terceiro ficar
 * de pé e redistribuir arte da Valve num repositório público. Lendo do install dele, o
 * arquivo nunca sai da máquina e não há nada pra redistribuir.
 *
 * Nada aqui escreve no jogo: só leitura.
 *
 * O formato, conferido no CS2 dele (18/11/2026):
 *  - `pak01_dir.vpk` é o índice (v2, 6,6 MB de árvore, 145.189 arquivos). Cada entrada diz
 *    em qual `pak01_NNN.vpk` o conteúdo está, com deslocamento e tamanho.
 *  - o radar é `panorama/images/overheadmaps/<mapa>_radar_psd.vtex_c` e a geometria é
 *    `resource/overviews/<mapa>.txt`, em texto puro.
 *  - o .vtex_c é um "resource" do Source 2: cabeçalho com blocos (RED2, DATA) e, depois
 *    deles, os pixels. No radar do Mirage: 1024x1024, formato 28 (BGRA8888), 1 mip,
 *    175.249 bytes que descomprimem em LZ4 para os 4.194.304 exatos da imagem crua.
 *
 * Sem pacote de fora: o LZ4 são trinta linhas e o PNG é o zlib que já vem no Node. É a
 * mesma regra que o `jogo.js` aprendeu na marra — dependência não declarada some no app
 * empacotado, e o erro só aparece onde importa.
 */
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

/** Abre o índice do pacote e devolve um mapa caminho -> onde está o conteúdo. */
export async function abrirVpk(pastaCsgo) {
  const buf = await readFile(resolve(pastaCsgo, 'pak01_dir.vpk'));
  if (buf.readUInt32LE(0) !== 0x55aa1234) throw new Error('pak01_dir.vpk não parece um VPK');
  const versao = buf.readUInt32LE(4);
  const arvore = buf.readUInt32LE(8);
  let p = versao === 2 ? 28 : 12;
  const fim = p + arvore;

  const texto = () => { const i = buf.indexOf(0, p); const s = buf.toString('latin1', p, i); p = i + 1; return s; };
  const indice = new Map();

  fora: while (p < fim) {
    const ext = texto(); if (!ext) break;
    while (p < fim) {
      const dir = texto(); if (!dir) break;
      while (p < fim) {
        const nome = texto(); if (!nome) break;
        const preload = buf.readUInt16LE(p + 4);
        indice.set(`${dir}/${nome}.${ext}`, {
          arquivo: buf.readUInt16LE(p + 6),
          desloc: buf.readUInt32LE(p + 8),
          tam: buf.readUInt32LE(p + 12),
          preload,
          preDesloc: p + 18,
        });
        p += 18 + preload;
        if (p > fim) break fora;
      }
    }
  }
  return { indice, buf, pastaCsgo };
}

/** O conteúdo de um arquivo de dentro do pacote, ou null se não existir. */
export async function lerDoVpk(vpk, caminho) {
  const e = vpk.indice.get(caminho);
  if (!e) return null;
  const pre = e.preload ? vpk.buf.slice(e.preDesloc, e.preDesloc + e.preload) : Buffer.alloc(0);
  if (!e.tam) return pre;
  const pacote = resolve(vpk.pastaCsgo, `pak01_${String(e.arquivo).padStart(3, '0')}.vpk`);
  const dados = (await readFile(pacote)).slice(e.desloc, e.desloc + e.tam);
  return pre.length ? Buffer.concat([pre, dados]) : dados;
}

/**
 * LZ4 em bloco cru. Token: 4 bits de literais, 4 de cópia; comprimento 15 se estende por
 * bytes 255. É o formato que o Source 2 usa pros pixels da textura.
 */
export function lz4(origem, tamanhoFinal) {
  const destino = Buffer.alloc(tamanhoFinal);
  let s = 0, o = 0;
  while (s < origem.length && o < tamanhoFinal) {
    const token = origem[s++];
    let literais = token >> 4;
    if (literais === 15) { let x; do { x = origem[s++]; literais += x; } while (x === 255); }
    origem.copy(destino, o, s, s + literais);
    s += literais; o += literais;
    if (s >= origem.length) break;
    const desloc = origem[s] | (origem[s + 1] << 8); s += 2;
    if (!desloc) throw new Error('LZ4 com deslocamento zero — arquivo corrompido');
    let copia = token & 15;
    if (copia === 15) { let x; do { x = origem[s++]; copia += x; } while (x === 255); }
    copia += 4;
    let de = o - desloc;
    for (let i = 0; i < copia && o < tamanhoFinal; i++) destino[o++] = destino[de++];
  }
  return { dados: destino, escritos: o };
}

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (const x of b) c = TABELA_CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/** PNG mínimo a partir de pixels RGBA. zlib é do Node; não entra pacote nenhum por isto. */
export function montarPng(largura, altura, rgba) {
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'latin1');
    const cab = Buffer.alloc(4); cab.writeUInt32BE(dados.length);
    const fim = Buffer.alloc(4); fim.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([cab, t, dados, fim]);
  };
  // cada linha começa com o byte de filtro (0 = nenhum)
  const linhas = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const base = y * (largura * 4 + 1);
    rgba.copy(linhas, base + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8 bits por canal, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const FORMATO_BGRA8888 = 28;

/** Uma textura .vtex_c do Source 2 virando PNG. Só o caso que o radar usa. */
export function texturaParaPng(vtex) {
  const tamCabecalho = vtex.readUInt32LE(0);
  const blocoDesloc = vtex.readUInt32LE(8);
  const blocoQtd = vtex.readUInt32LE(12);

  let p = 8 + blocoDesloc;
  let dados = null;
  for (let i = 0; i < blocoQtd; i++) {
    const nome = vtex.toString('latin1', p, p + 4);
    if (nome === 'DATA') dados = p + 4 + vtex.readUInt32LE(p + 4);
    p += 12;
  }
  if (dados == null) throw new Error('textura sem bloco DATA');

  const largura = vtex.readUInt16LE(dados + 20);
  const altura = vtex.readUInt16LE(dados + 22);
  const formato = vtex.readUInt8(dados + 26);
  if (formato !== FORMATO_BGRA8888) throw new Error(`formato de textura ${formato} que eu não sei ler (esperava ${FORMATO_BGRA8888})`);

  const esperado = largura * altura * 4;
  const carga = vtex.slice(tamCabecalho);          // os pixels vêm depois dos blocos
  let bgra;
  if (carga.length >= esperado) bgra = carga;
  else {
    const { dados: saida, escritos } = lz4(carga, esperado);
    if (escritos !== esperado) throw new Error(`LZ4 devolveu ${escritos} de ${esperado} bytes`);
    bgra = saida;
  }

  // BGRA -> RGBA, no lugar: é 4 MB por mapa e copiar de novo não ajuda ninguém
  const rgba = Buffer.from(bgra.slice(0, esperado));
  for (let i = 0; i < rgba.length; i += 4) { const b = rgba[i]; rgba[i] = rgba[i + 2]; rgba[i + 2] = b; }

  return { largura, altura, png: montarPng(largura, altura, rgba) };
}

/**
 * O `.txt` de overview, que é o que converte coordenada do mundo em ponto do radar.
 * Traz de brinde os dois bombsites e os dois spawns já em 0..1 — quatro pontos de
 * referência por mapa, de graça, que no Valorant eu só tinha porque a API dava callout.
 */
export function lerOverview(txt) {
  const s = txt.toString('utf8');
  const campo = (nome) => {
    const m = new RegExp(`"${nome}"\\s+"([^"]*)"`, 'i').exec(s);
    return m ? m[1] : null;
  };
  const num = (nome) => { const v = campo(nome); const n = Number(v); return Number.isFinite(n) ? n : null; };
  const ponto = (base) => {
    const x = num(`${base}_x`), y = num(`${base}_y`);
    return x == null || y == null ? null : { x, y };
  };
  return {
    posX: num('pos_x'), posY: num('pos_y'), escala: num('scale'),
    rotacionado: num('rotate') === 1,
    pontos: [
      ['Bombsite A', ponto('bombA')], ['Bombsite B', ponto('bombB')],
      ['T Spawn', ponto('TSpawn')], ['CT Spawn', ponto('CTSpawn')],
    ].filter(([, p]) => p).map(([nome, p]) => ({ nome, x: p.x, y: p.y })),
  };
}
