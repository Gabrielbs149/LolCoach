import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * As opções do jogo (HUD, câmera, som) que o próprio client guarda em
 * `Config/PersistedSettings.json` — as mesmas da tela de opções dentro da
 * partida, só que numa tela simples fora dela.
 *
 * Com o client aberto vai pela LCU (`/lol-game-settings/v1/game-settings` +
 * `/save`), que é o jeito oficial e evita o client sobrescrever. Com o client
 * fechado edita o arquivo (o jogo só lê ao iniciar). Com partida rodando não
 * mexe: nada encosta no jogo em andamento.
 */

const CAMINHOS = [
  'C:\\Riot Games\\League of Legends\\Config',
  'D:\\Riot Games\\League of Legends\\Config',
  'C:\\Program Files\\Riot Games\\League of Legends\\Config',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends\\Config',
];

/** O que aparece na tela, em grupos. `secao`/`chave` são os nomes do Game.cfg. */
export const OPCOES = [
  { grupo: 'Interface', secao: 'HUD', chave: 'GlobalScale', rotulo: 'Tamanho da HUD', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Interface', secao: 'HUD', chave: 'MinimapScale', rotulo: 'Tamanho do minimapa', tipo: 'faixa', min: 0, max: 2.5, passo: 0.05, decimais: 4 },
  { grupo: 'Interface', secao: 'HUD', chave: 'ChatScale', rotulo: 'Tamanho do chat', tipo: 'faixa', min: 0, max: 100, passo: 1, decimais: 0 },
  { grupo: 'Interface', secao: 'HUD', chave: 'NumericCooldownFormat', rotulo: 'Números nos cooldowns', tipo: 'opcao', opcoes: [[0, 'não'], [1, 'inteiro'], [2, 'decimal'], [3, 'os dois']] },
  { grupo: 'Interface', secao: 'HUD', chave: 'MinimapEnableAllTimers', rotulo: 'Timers no minimapa', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'DrawHealthBars', rotulo: 'Barras de vida', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'HidePlayerNames', rotulo: 'Esconder nomes dos jogadores', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'MirroredScoreboard', rotulo: 'Placar espelhado', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'FlipMiniMap', rotulo: 'Inverter minimapa', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'FlashScreenWhenDamaged', rotulo: 'Piscar a tela ao tomar dano', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'FlashScreenWhenStunned', rotulo: 'Piscar a tela ao ser stunado', tipo: 'liga' },
  { grupo: 'Interface', secao: 'Performance', chave: 'EnableHUDAnimations', rotulo: 'Animações da HUD', tipo: 'liga' },
  { grupo: 'Interface', secao: 'HUD', chave: 'EmotePopupUIDisplayMode', rotulo: 'Emotes dos outros', tipo: 'opcao', opcoes: [[0, 'mostrar'], [1, 'só do time'], [2, 'esconder']] },

  { grupo: 'Câmera e mouse', secao: 'General', chave: 'EnableScreenShake', rotulo: 'Tremer a tela', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'CursorScale', rotulo: 'Tamanho do cursor', tipo: 'faixa', min: 0.5, max: 2, passo: 0.05, decimais: 4 },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'GameMouseSpeed', rotulo: 'Velocidade do mouse', tipo: 'faixa', min: 1, max: 20, passo: 1, decimais: 0 },
  { grupo: 'Câmera e mouse', secao: 'HUD', chave: 'MapScrollSpeed', rotulo: 'Velocidade da câmera', tipo: 'faixa', min: 0, max: 1, passo: 0.05, decimais: 4 },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'CameraZoomOnMouseScroll', rotulo: 'Zoom com a roda do mouse', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'RelativeTeamColors', rotulo: 'Meu time sempre azul', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'ShowTurretRangeIndicators', rotulo: 'Alcance da torre', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'EnableTargetedAttackMove', rotulo: 'Attack move no alvo', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'AutoAcquireTarget', rotulo: 'Auto-atacar', tipo: 'liga' },
  { grupo: 'Câmera e mouse', secao: 'General', chave: 'RecommendJunglePaths', rotulo: 'Rota de jungle sugerida', tipo: 'liga' },

  { grupo: 'Som', secao: 'Volume', chave: 'MasterVolume', rotulo: 'Geral', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'MusicVolume', rotulo: 'Música', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'SfxVolume', rotulo: 'Efeitos', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'VoiceVolume', rotulo: 'Vozes', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'AnnouncerVolume', rotulo: 'Locutor', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'PingsVolume', rotulo: 'Pings', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },
  { grupo: 'Som', secao: 'Volume', chave: 'AmbienceVolume', rotulo: 'Ambiente', tipo: 'faixa', min: 0, max: 1, passo: 0.01, decimais: 4 },

  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'Damage_Enabled', rotulo: 'Dano que eu causo', tipo: 'liga' },
  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'EnemyDamage_Enabled', rotulo: 'Dano que eu tomo', tipo: 'liga' },
  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'Heal_Enabled', rotulo: 'Cura', tipo: 'liga' },
  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'Gold_Enabled', rotulo: 'Gold', tipo: 'liga' },
  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'Experience_Enabled', rotulo: 'Experiência', tipo: 'liga' },
  { grupo: 'Texto flutuante', secao: 'FloatingText', chave: 'Dodge_Enabled', rotulo: 'Esquiva', tipo: 'liga' },
];

async function pastaConfig() {
  for (const p of CAMINHOS) { try { await access(join(p, 'PersistedSettings.json')); return p; } catch { /* próxima */ } }
  return null;
}

/* ----------------------------------------------------------- arquivo */
async function lerArquivo() {
  const pasta = await pastaConfig();
  if (!pasta) throw new Error('não achei o PersistedSettings.json do League');
  const caminho = join(pasta, 'PersistedSettings.json');
  return { caminho, doc: JSON.parse(await readFile(caminho, 'utf8')) };
}

function valoresDoDoc(doc) {
  const cfg = (doc.files ?? []).find((f) => f.name === 'Game.cfg');
  const valores = {};
  for (const s of cfg?.sections ?? []) for (const x of s.settings ?? []) valores[`${s.name}.${x.name}`] = x.value;
  return valores;
}

function formatar(op, valor) {
  if (op.tipo === 'liga') return valor ? '1' : '0';
  if (op.tipo === 'opcao') return String(Number(valor));
  return Number(valor).toFixed(op.decimais);
}

async function gravarNoArquivo(mudancas) {
  const { caminho, doc } = await lerArquivo();
  // Cópia de segurança uma vez, antes da primeira escrita.
  const backup = caminho.replace(/\.json$/, '.antes-do-lolcoach.json');
  try { await access(backup); } catch { await copyFile(caminho, backup).catch(() => {}); }

  const cfg = (doc.files ??= []).find((f) => f.name === 'Game.cfg') ?? (doc.files.push({ name: 'Game.cfg', sections: [] }), doc.files.at(-1));
  for (const { op, valor } of mudancas) {
    const secao = cfg.sections.find((s) => s.name === op.secao) ?? (cfg.sections.push({ name: op.secao, settings: [] }), cfg.sections.at(-1));
    const item = secao.settings.find((x) => x.name === op.chave);
    if (item) item.value = formatar(op, valor); else secao.settings.push({ name: op.chave, value: formatar(op, valor) });
  }
  await writeFile(caminho, JSON.stringify(doc, null, 4), 'utf8');
  return 'arquivo';
}

/* --------------------------------------------------------------- LCU */
async function lerDaLcu(lcu) {
  const g = await lcu.get('/lol-game-settings/v1/game-settings');
  const valores = {};
  for (const [secao, itens] of Object.entries(g ?? {})) {
    if (!itens || typeof itens !== 'object') continue;
    for (const [k, v] of Object.entries(itens)) valores[`${secao}.${k}`] = v;
  }
  return valores;
}

async function gravarNaLcu(lcu, mudancas) {
  const corpo = {};
  for (const { op, valor } of mudancas) {
    (corpo[op.secao] ??= {})[op.chave] = op.tipo === 'liga' ? !!valor : Number(valor);
  }
  await lcu.patch('/lol-game-settings/v1/game-settings', corpo);
  await lcu.post('/lol-game-settings/v1/save').catch(() => {});
  return 'client';
}

/* ---------------------------------------------------------- público */
const normal = (op, v) => {
  if (v == null) return null;
  if (op.tipo === 'liga') return v === true || v === '1' || v === 1;
  return Number(v);
};

/** Tudo que a tela mostra, com o valor atual e de onde veio. */
export async function lerOpcoes(lcu) {
  let valores, origem;
  if (lcu?.conectado) {
    try { valores = await lerDaLcu(lcu); origem = 'client'; } catch { /* cai pro arquivo */ }
  }
  if (!valores) { valores = valoresDoDoc((await lerArquivo()).doc); origem = 'arquivo'; }
  return {
    origem,
    opcoes: OPCOES.map((op) => ({ ...op, valor: normal(op, valores[`${op.secao}.${op.chave}`]) })),
  };
}

/** `mudancas`: [{ secao, chave, valor }]. Nunca com partida rodando. */
export async function gravarOpcoes(lcu, mudancas, { fase } = {}) {
  if (fase === 'InProgress') throw new Error('não mexo nas opções com a partida rodando');
  const lista = mudancas.map((m) => ({ op: OPCOES.find((o) => o.secao === m.secao && o.chave === m.chave), valor: m.valor }))
    .filter((x) => x.op);
  if (!lista.length) throw new Error('nada pra gravar');
  if (lcu?.conectado) {
    try { return await gravarNaLcu(lcu, lista); } catch { /* client sem a rota: arquivo */ }
  }
  return gravarNoArquivo(lista);
}
