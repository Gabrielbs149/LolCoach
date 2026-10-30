/**
 * Lineups de Valorant.
 *
 * Por que vídeo e não uma base de dados: não existe fonte aberta de lineup. Procurei —
 * valorant-api.com tem agente, mapa e habilidade (assets oficiais, API pública sem chave),
 * mas lineup em si só existe em vídeo de criador. Sites como o strats.gg estão atrás de
 * desafio de bot do Cloudflare e, de todo jeito, copiar a biblioteca deles pra cá seria
 * redistribuir conteúdo dos outros num repositório público.
 *
 * Então: o app ACHA o vídeo (busca por mapa + agente + habilidade), ele salva os que
 * gostou com o minuto certo e a marcação de pulo, e na hora de jogar vê isso na segunda
 * tela. O vídeo toca pelo player oficial do YouTube — o criador leva a view.
 *
 * Nada aqui toca no processo do Valorant. Não há leitura de memória nem sobreposição em
 * cima do jogo: o Vanguard é anticheat de kernel e trata overlay como trapaça.
 */
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pastaBase } from '../caminhos.js';

const pasta = () => resolve(pastaBase(), 'dados', 'valorant');
const arqCatalogo = () => resolve(pasta(), 'catalogo.json');
const arqSalvas = () => resolve(pasta(), 'lineups.json');
const arqBusca = (chave) => resolve(pasta(), 'buscas', `${chave}.json`);
const arqAcervo = () => resolve(pasta(), 'acervo.json');
const arqRuins = () => resolve(pasta(), 'videos-ruins.json');

/* ------------------------------------------------------------- vídeo que não toca
 *
 * Filtrar no momento da busca resolve o que vem de hoje em diante, mas não o que já está
 * no disco: medido no acervo dele, 135 das 7890 lineups (1,7%) apontam pra dois vídeos do
 * Valomate que o dono marcou como "não pode tocar fora do YouTube" — e o player não tem
 * como adivinhar isso antes de tentar. Então quando a tela erra, ela AVISA aqui, e o vídeo
 * some de todas as buscas, inclusive das que já estão salvas. Uma tela preta só, nunca duas.
 */
let ruins = null;
async function videosRuins() {
  if (!ruins) ruins = new Set(await lerJson(arqRuins(), []));
  return ruins;
}

export async function marcarVideoRuim(video, motivo = '') {
  const id = String(video ?? '').trim();
  if (!id || id.length > 32) return { ok: false };
  const r = await videosRuins();
  if (r.has(id)) return { ok: true, total: r.size };
  r.add(id);
  await mkdir(pasta(), { recursive: true }).catch(() => {});
  await writeFile(arqRuins(), JSON.stringify([...r]), 'utf8').catch(() => {});
  return { ok: true, total: r.size, motivo };
}

/** Tira do resultado as lineups de vídeo que já deu erro. */
async function semOsRuins(r) {
  const maus = await videosRuins();
  if (!maus.size || !r?.lineups?.length) return r;
  const lineups = r.lineups.filter((l) => !maus.has(l.video));
  return lineups.length === r.lineups.length ? r : { ...r, lineups };
}

const garantirPasta = () => mkdir(pasta(), { recursive: true }).catch(() => {});
const garantirBuscas = () => mkdir(resolve(pasta(), 'buscas'), { recursive: true }).catch(() => {});
const lerJson = async (caminho, reserva) => { try { return JSON.parse(await readFile(caminho, 'utf8')); } catch { return reserva; } };
const gravarJson = async (caminho, v) => { await garantirPasta(); await writeFile(caminho, JSON.stringify(v, null, 2), 'utf8'); };

const buscarJson = async (url, ms = 12000) => {
  const corta = AbortSignal.timeout(ms);
  const r = await fetch(url, { signal: corta, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/* ------------------------------------------------------------------ catálogo */

/** Habilidade que faz sentido ter lineup: as que você joga longe. O resto é corpo a corpo. */
const SLOT_UTIL = new Set(['Ability1', 'Ability2', 'Grenade', 'Ultimate']);
const VALIDADE_CATALOGO = 7 * 24 * 60 * 60 * 1000;   // o jogo muda de patch, mas não toda hora
/**
 * Versão do FORMATO do catálogo guardado. Sobe sempre que o que a gente guarda muda de
 * forma. Sem isso, quem já tinha cache antigo ficava com ele por 7 dias: foi o que
 * aconteceu quando os callouts entraram — o mapa abria sem nenhum pino porque o catálogo
 * em disco tinha só nome/ícone/planta e a validade por idade não notava a diferença.
 */
const FORMATO_CATALOGO = 4;

/**
 * Mapas e agentes oficiais, do valorant-api.com (público, sem chave, atualizado por patch).
 * Fica em disco: assim a aba abre sem internet e não bate na API a cada clique.
 */
export async function catalogo({ forcar = false } = {}) {
  const guardado = await lerJson(arqCatalogo(), null);
  const serve = guardado?.formato === FORMATO_CATALOGO && guardado.mapas?.length;
  if (!forcar && serve && guardado.em && Date.now() - guardado.em < VALIDADE_CATALOGO) return guardado;

  try {
    // em pt-BR pra mostrar, em en-US pra buscar: vídeo de lineup é quase todo em inglês,
    // e procurar por "Nuvem Venenosa" acha muito menos que por "Poison Cloud".
    const [m, a, aEn, mEn] = await Promise.all([
      buscarJson('https://valorant-api.com/v1/maps?language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR'),
      buscarJson('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US').catch(() => ({ data: [] })),
      buscarJson('https://valorant-api.com/v1/maps?language=en-US').catch(() => ({ data: [] })),
    ]);
    const emIngles = new Map((aEn.data ?? []).map((x) => [x.uuid, x]));
    // callout em INGLÊS: ele é casado contra nome de capítulo de vídeo, que é em inglês.
    // Com os de pt-BR, "A Lobby" nunca casava com "A Saguão" e 93 de 96 lineups caíam no
    // palpite pelo site. O nome do mapa na tela segue em pt-BR.
    const mapaEn = new Map((mEn.data ?? []).map((x) => [x.uuid, x]));
    const mapas = (m.data ?? [])
      .filter((x) => x.displayName && x.tacticalDescription)    // só mapa de partida: tira Campo de Treino e afins
      .map((x) => ({
        nome: x.displayName,
        icone: x.listViewIcon ?? x.splash ?? null,
        arte: x.splash ?? x.listViewIcon ?? null,      // a arte grande, pro seletor em grade
        planta: x.displayIcon ?? null,
        callouts: pontosDoMapa(mapaEn.get(x.uuid) ?? x),
      }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    const agentes = (a.data ?? [])
      .map((x) => {
        const en = emIngles.get(x.uuid);
        const porSlot = new Map((en?.abilities ?? []).map((h) => [h.slot, h.displayName]));
        return {
          id: x.uuid,                       // pra casar com o que o jogo informa
          nome: x.displayName,
          icone: x.displayIcon ?? null,
          funcao: x.role?.displayName ?? null,
          habilidades: (x.abilities ?? []).filter((h) => SLOT_UTIL.has(h.slot) && h.displayName)
            .map((h) => ({ nome: h.displayName, busca: porSlot.get(h.slot) ?? h.displayName, icone: h.displayIcon ?? null, slot: h.slot })),
        };
      })
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    if (!mapas.length || !agentes.length) throw new Error('catálogo veio vazio');
    const novo = { em: Date.now(), formato: FORMATO_CATALOGO, mapas, agentes };
    await gravarJson(arqCatalogo(), novo);
    return novo;
  } catch (e) {
    // sem internet: vale mais o catálogo velho do que uma aba quebrada
    if (serve) return { ...guardado, aviso: 'catálogo antigo: não consegui atualizar agora' };
    return { em: 0, mapas: [], agentes: [], aviso: `não consegui buscar mapas e agentes: ${e.message}` };
  }
}

/* ------------------------------------------------------- pontos do mapa */

/**
 * Os callouts do mapa ("A Lobby", "B Teleporter", "Top Mid") com a posição deles na
 * planta oficial, em 0..1. A Riot entrega a posição em coordenada de mundo e os fatores
 * de conversão junto; o x e o y entram TROCADOS na planta, que é como o jogo guarda.
 * É isso que deixa a lineup virar um pino no mapa em vez de uma linha numa lista.
 */
export function pontosDoMapa(mapa) {
  const { xMultiplier: xm, yMultiplier: ym, xScalarToAdd: xa, yScalarToAdd: ya } = mapa ?? {};
  if (![xm, ym, xa, ya].every((n) => typeof n === 'number')) return [];
  const fora = [];
  for (const c of mapa.callouts ?? []) {
    const l = c.location; if (!l) continue;
    const x = l.y * xm + xa, y = l.x * ym + ya;
    if (!(x >= -0.1 && x <= 1.1 && y >= -0.1 && y <= 1.1)) continue;
    const grande = String(c.superRegionName ?? '').trim();
    const regiao = String(c.regionName ?? '').trim();
    if (!regiao) continue;
    fora.push({
      nome: grande && grande !== regiao ? `${grande} ${regiao}` : regiao,
      regiao, grande,
      site: ['A', 'B', 'C'].includes(grande) ? grande : /mid/i.test(grande) || /mid/i.test(regiao) ? 'Mid' : null,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
    });
  }
  return fora;
}

const semAcento = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * De que ponto do mapa fala o nome da lineup. Casa o nome do capítulo contra os callouts
 * do mapa, do mais específico pro menos: "B default from B Teleporter" acha "B Teleporter"
 * antes de "Teleporter", senão uma lineup do B cairia no teleporter do A.
 */
export function pontoDaLineup(nome, callouts = [], site = null) {
  const t = ` ${semAcento(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  const contem = (alvo) => t.includes(` ${semAcento(alvo).replace(/[^a-z0-9]+/g, ' ').trim()} `);
  // 1. nome completo do callout ("A Lobby") — o mais específico
  const completos = callouts.filter((c) => c.nome !== c.regiao && contem(c.nome))
    .sort((a, b) => b.nome.length - a.nome.length);
  if (completos.length) return completos[0];
  // 2. só a região ("Lobby"), mas dentro do site que a lineup já disse ser
  const soRegiao = callouts.filter((c) => contem(c.regiao)).sort((a, b) => b.regiao.length - a.regiao.length);
  const noSite = site ? soRegiao.find((c) => c.site === site) : null;
  if (noSite) return noSite;
  /* "from Defender Spawn" casa a região "Spawn" em DOIS callouts (o do atacante e o do
   * defensor), empatava, e o lugar ficava sem ponto nenhum — eram 41 nomes do acervo dele
   * sem seta no mapa. Quando o texto também diz a região grande ("Defender"), é ela que
   * desempata. */
  if (soRegiao.length > 1) {
    const peloGrande = soRegiao.filter((c) => c.grande && contem(c.grande.replace(/\s*side\s*/i, ' ').trim()));
    if (peloGrande.length === 1) return peloGrande[0];
  }
  /* Este atalho mandava lineup pro lado errado do mapa. "B Default B Lobby" tem site B, mas
   * o Bind não tem callout "B Lobby" — só "A Lobby". A região "Lobby" casava, dava UM
   * resultado, e o atalho devolvia o A Lobby, do outro lado do mapa. Quando a lineup já diz
   * de que site ela é, um casamento de OUTRO site não serve: é melhor cair no centro do
   * site certo (passo 3) do que fincar no lugar errado. */
  const soUm = soRegiao.length === 1 ? soRegiao[0] : null;
  if (soUm && !(site && soUm.site && soUm.site !== site)) return soUm;
  // 3. nada de específico: o centro do site, se a gente souber qual é
  if (site) {
    const doSite = callouts.filter((c) => c.site === site);
    const alvo = doSite.find((c) => /site/i.test(c.regiao)) ?? doSite[0];
    if (alvo) return { ...alvo, aproximado: true };
  }
  return null;
}

/* ------------------------------------------------------- ataque ou defesa
 *
 * O app não sabia disso. O lado só existia como PALAVRA NA BUSCA ("sova ascent lineup
 * attack") e como nome do arquivo salvo — e aí todo capítulo do vídeo achado virava lineup
 * daquele lado, inclusive os que diziam o contrário com todas as letras. Medido no acervo
 * dele, 8266 lineups: pedindo atacante, 1128 das 3256 mostradas (34,6%) são de defesa;
 * pedindo defensor, 987 de 2989 (33%) são de ataque. Uma em cada três estava errada.
 *
 * As pistas, em ordem de certeza — a primeira que casar manda, por isso a ordem importa:
 * "A 진입 카운터" é entrada CONTRA-atacada, defesa, e tem que ser vista antes de "진입".
 *
 * Os idiomas não são enfeite: são os que existem no acervo dele. Inglês, espanhol e
 * português vêm dos canais de sempre; coreano são 140 nomes de capítulo e japonês 77, de
 * canais que fazem lineup muito boa e nunca escrevem uma palavra em inglês.
 *
 * O que ficou DE FORA de propósito:
 *  - "defender" solto: "A Attack - Shock to clear defender utilities" é ataque, e a palavra
 *    ali é o inimigo, não o lado. Só "Defender Spawn" conta, que é lugar.
 *  - "push"/"rush"/"푸시" soltos: "B Main Push 1" pode ser os dois. Só "anti-rush" e
 *    "counter push" contam, que são reação, e reação é de quem defende.
 *  - "default", "capturar": aparecem dos dois lados no mesmo canal.
 */
const PISTAS_DE_LADO = [
  // inequívocos: a spike plantada é coisa de atacante, retomar o site é de defensor
  [/\bpost\s*-?\s*plants?\b|\bpostplant\b|\bpos\s*-?\s*plant|포스트플랜트|ポストプラント/i, 'atacando'],
  [/\bretakes?\b|\bretoma\w*|리테이크|リテイク/i, 'defendendo'],
  [/\banti\s*-?\s*(?:rush|push|eco|entry)|\bcounter\s*-?\s*(?:push|rush|entry|exec)|카운터/i, 'defendendo'],
  // impedir o desarme é de quem plantou
  [/\bdefuse\b|\bdesarm\w*/i, 'atacando'],
  // o lado dito com todas as letras (o "DEF"/"ATT" na frente do nome é o formato de 276 capítulos dele)
  [/\bdefen[cs]\w*\b|\bdefend(?:ing|endo|iendo)\b|\bdef\b|수비|守り|守備/i, 'defendendo'],
  [/\battack\w*\b|\batk\b|\batt\b|\bataques?\b|\batacand\w*|\bofensiv\w*|\boffens\w*|공격|攻め|攻撃/i, 'atacando'],
  // de onde se joga: o spawn de um lado só é daquele lado ("CT" é como o pessoal chama o spawn do defensor)
  [/\bdefender(?:'?s)?\s*(?:side\s*)?spawn\b|\bct\b/i, 'defendendo'],
  [/\battacker(?:'?s)?\s*(?:side\s*)?spawn\b|\bt\s*-?\s*spawn\b/i, 'atacando'],
  // entrar no site é de atacante; segurar é de defensor
  [/\bentry\b|\bentrada\b|\bexecut\w*|\bejecu\w*|진입|エントリー/i, 'atacando'],
  [/\bhold(?:s|ing)?\b|\bsegurar\b|\bstall\w*/i, 'defendendo'],
];

/**
 * Tira acento sem desmontar hangul. O `semAcento` daqui faz NFD, e NFD QUEBRA sílaba
 * coreana em jamo — "공격" deixava de ser "공격" e nenhuma pista casava. O NFC no fim
 * remonta a sílaba; o acento latino já saiu, então não volta.
 */
const semAcentoCJK = (t) => String(t ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase();

/** 'atacando', 'defendendo' ou null — só pelo texto, sem adivinhar. */
export function ladoPeloTexto(texto) {
  const t = ` ${semAcentoCJK(texto).replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ')} `;
  for (const [pista, lado] of PISTAS_DE_LADO) if (pista.test(t)) return lado;
  return null;
}

/**
 * De onde se joga diz o lado, quando o lugar é de um lado SÓ.
 *
 * A primeira versão media distância até os dois spawns e ficava com o mais perto. Media
 * errado: "[Atk Eye] A Main to A Site" no Pearl fica mais perto do spawn do defensor e
 * virava defesa, e no Fracture — onde o atacante nasce dos DOIS lados — a conta não quer
 * dizer nada. Eram 44 brigas com o que o próprio capítulo dizia com todas as letras.
 *
 * Agora quem decide é o território, e ele vem do catálogo da Riot, não de conta nossa: o
 * callout tem super-região "Attacker Side" ou "Defender Side" (são os spawns) e região
 * "Lobby" — lobby é de onde o atacante sai, todo mapa tem o do atacante e nenhum tem o do
 * defensor. Fora desses, lugar nenhum é de um lado só: A Main é caminho de quem entra e
 * também de quem segura. Com essa regra dá 0 brigas, e 269 lineups do acervo dele ganham
 * lado por aqui.
 */
export function ladoPeloLugar(posicao, callouts = []) {
  if (!posicao?.nome) return null;
  const c = callouts.find((x) => x.nome === posicao.nome);
  if (/attacker/i.test(c?.grande ?? '')) return 'atacando';
  if (/defender/i.test(c?.grande ?? '')) return 'defendendo';
  if (/\blobby\b/i.test(c?.regiao ?? '') || /\blobby\b/i.test(posicao.nome)) return 'atacando';
  return null;
}

/** Palavra que não muda nada num cabeçalho: "Defense Lineups" é a mesma coisa que "Defense". */
const ENFEITE = /^(?:lineups?|setups?|sides?|parts?|sections?|all|new|best|the|and|of|for|valorant|guide|라인업|ラインアップ)$/;

/**
 * O capítulo é CABEÇALHO de seção ("Defense", "❚█══ATTACK══█❚", "Post Plant") ou é o nome
 * de UMA lineup que por acaso diz o lado ("A RETAKE from RAFTERS")? Só cabeçalho vale pro
 * que vem depois dele.
 *
 * Isto é o conserto do "ainda tô vendo lineup de defesa no ataque". Antes QUALQUER capítulo
 * que dissesse o lado passava esse lado pra todos os seguintes até o fim do vídeo: no "FADE
 * LINEUPS ASCENT" o capítulo "A RETAKE", que é uma lineup só, marcava de defesa as 14
 * seguintes — "GOD A", "FAST B", "SIMPLE B", "MID CONTROL". Deu 208 lineups brigando com o
 * lugar de onde se joga, e nessas quem estava certo era o lugar.
 */
export function ladoCabecalho(texto) {
  const lado = ladoPeloTexto(texto);
  if (!lado) return null;
  let t = ` ${semAcentoCJK(texto).replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ')} `;
  for (const [pista] of PISTAS_DE_LADO) t = t.replace(new RegExp(pista.source, 'gi'), ' ');
  const sobra = t.split(/\s+/).filter((p) => p && !ENFEITE.test(p) && !/^\d+$/.test(p));
  return sobra.length ? null : lado;
}

/**
 * O lado de cada capítulo do vídeo, pelo texto.
 *
 * `pista` é pra tela poder ser honesta sobre o que ela sabe:
 *   nome   - o capítulo disse
 *   bloco  - herdou do CABEÇALHO da seção em que ele está
 *   video  - ninguém falou nada ainda e o título do vídeo diz
 */
export function ladosDosCapitulos(caps, titulo = '') {
  const noTitulo = ladoPeloTexto(titulo);
  let secao = null;
  return caps.map((c) => {
    const cab = ladoCabecalho(c.nome);
    if (cab) secao = cab;                       // abriu seção: vale pro que vem depois
    const dito = cab ?? ladoPeloTexto(c.nome);
    if (dito) return { lado: dito, pista: 'nome' };
    if (secao) return { lado: secao, pista: 'bloco' };
    return noTitulo ? { lado: noTitulo, pista: 'video' } : { lado: null, pista: null };
  });
}

/**
 * Junta as pistas na ordem de certeza: o que o capítulo DIZ, depois de onde se joga, e só
 * então o que vem de fora dele (a seção do vídeo, o título). O lugar passa na frente da
 * seção porque estar no A Lobby é fato, e herdar seção é dedução.
 */
export function juntarLado(doTexto, posicao, callouts = []) {
  if (doTexto?.pista === 'nome') return doTexto;
  const lugar = ladoPeloLugar(posicao, callouts);
  if (lugar) return { lado: lugar, pista: 'lugar' };
  return doTexto?.lado ? doTexto : { lado: null, pista: null };
}

/* --------------------------------------------------- qual habilidade é */

/**
 * Apelido que o pessoal usa no título do capítulo → pedaço do nome oficial da habilidade.
 * Ninguém escreve "Incendiary" no vídeo, escreve "molly". Só os apelidos que aparecem de
 * verdade; o que não casar fica sem ícone, que é melhor que mostrar o ícone errado.
 */
const APELIDOS = [
  [/\bmolly\b|\bmolli?es\b|\bmolotov\b|\bincend/i, ['incendiary', 'snake bite', 'frag', 'hot hands', 'blaze', 'molly']],
  [/\bsmoke?s?\b|\bfuma\b/i, ['sky smoke', 'poison cloud', 'dark cover', 'cove', 'nebula', 'smoke', 'orb']],
  [/\bwall\b|\bparede\b/i, ['toxic screen', 'barrier', 'cascade', 'wall']],
  [/\bflash\b|\bflashes\b/i, ['flashpoint', 'blaze', 'curveball', 'paranoia', 'flash', 'blindside', 'dizzy']],
  [/\bstun\b|\bconcuss/i, ['fault line', 'aftershock', 'concussion', 'stun', 'seize']],
  [/\bdart\b|\brecon\b|\bscan\b/i, ['recon bolt', 'owl drone', 'trailblazer', 'prowler', 'recon']],
  [/\bshock\b/i, ['shock bolt']],
  [/\bult\b|\bultimate\b/i, []],   // o ult é tratado pelo slot, não pelo nome
];

const semAcentoMin = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Qual habilidade a lineup usa, pelo nome do capítulo. Devolve a habilidade do agente ou
 * null — ícone errado no pino confunde mais do que pino sem ícone.
 */
export function habilidadeDaLineup(nome, habilidades = []) {
  if (!habilidades.length) return null;
  const t = ` ${semAcentoMin(nome).replace(/[^a-z0-9]+/g, ' ')} `;
  // 1. o nome oficial (pt-BR ou en-US) aparece no título
  for (const h of habilidades) {
    for (const alvo of [h.busca, h.nome]) {
      const limpo = semAcentoMin(alvo).replace(/[^a-z0-9]+/g, ' ').trim();
      if (limpo.length >= 4 && t.includes(` ${limpo} `)) return h;
    }
  }
  // 2. "ult" / "ultimate" → a habilidade do slot de ultimate
  if (/\bult\b|\bultimate\b/i.test(nome)) {
    const u = habilidades.find((h) => h.slot === 'Ultimate');
    if (u) return u;
  }
  // 3. apelido ("molly", "smoke", "wall"…)
  for (const [apelido, pistas] of APELIDOS) {
    if (!apelido.test(nome)) continue;
    for (const pista of pistas) {
      const h = habilidades.find((x) => semAcentoMin(x.busca).includes(pista) || semAcentoMin(x.nome).includes(pista));
      if (h) return h;
    }
  }
  return null;
}

/**
 * O título do capítulo costuma trazer as DUAS pontas: "A default from A Short" é alvo A
 * default, jogada de A Short. Medido em 154 lineups: 33% dizem de onde se joga. Nessas dá
 * pra desenhar a linha no mapa; nas outras sobra só o alvo, e é o que a gente mostra.
 */
// "A default FROM A Short" → alvo primeiro, posição depois.
const DE_ONDE = /^(.*?)\s+(?:from|at|@|desde)\s+(.+)$/i;
// "A Garden TO A Long Ramp" → o contrário: posição primeiro, alvo depois. Os dois formatos
// aparecem; sem o segundo, título assim ficava sem linha no mapa.
const PARA_ONDE = /^(.*?)\s+(?:to|para|pro)\s+(.+)$/i;

export function pontasDaLineup(nome, callouts = [], site = null) {
  let m = String(nome).match(DE_ONDE), invertido = false;
  if (!m) { m = String(nome).match(PARA_ONDE); invertido = !!m; }
  if (!m) return { alvo: pontoDaLineup(nome, callouts, site), posicao: null };
  const [, um, dois] = m;
  const [alvoTxt, posTxt] = invertido ? [dois, um] : [um, dois];
  // "(Crosshair)" e afins no fim não são lugar
  const limpo = posTxt.replace(/\s*\((?:crosshair|hud|mira|game\s*hud)\)\s*$/i, '').trim();
  const posicao = pontoDaLineup(limpo, callouts, null);
  const alvo = pontoDaLineup(alvoTxt, callouts, site) ?? pontoDaLineup(nome, callouts, site);
  // posição igual ao alvo não acrescenta nada — e linha de um ponto pra ele mesmo confunde
  if (posicao && alvo && posicao.nome === alvo.nome) return { alvo, posicao: null };
  return { alvo, posicao: posicao && !posicao.aproximado ? posicao : null };
}

/* ------------------------------------------------------------------ busca */

/**
 * Instâncias de Invidious: API aberta de busca no YouTube, sem chave. São comunitárias e
 * caem direto, por isso a lista — tenta uma, deu ruim vai pra próxima. Se ele puser uma
 * chave do YouTube na config, usa a oficial e nem passa por aqui.
 */
const INVIDIOUS = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks',
];
const ESPERAR = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * As instâncias são comunitárias e balançam: a mesma que acabou de responder a busca
 * devolve 500 no pedido seguinte e 200 no outro. Então cada uma leva duas tentativas antes
 * da gente desistir dela — desistir na primeira deixava a aba vazia com a rede inteira de pé.
 */
async function tentarJson(url, ms = 9000, vezes = 2, ate = Infinity) {
  let ultimo = null;
  for (let i = 0; i < vezes; i++) {
    if (Date.now() > ate) break;
    try { return await buscarJson(url, Math.min(ms, Math.max(1500, ate - Date.now()))); }
    catch (e) { ultimo = e; if (i + 1 < vezes && Date.now() < ate) await ESPERAR(400); }
  }
  throw ultimo ?? new Error('sem resposta');
}
const MIN_SEG = 25;        // menos que isso não é lineup, é corte
const MAX_SEG = 3600;

const LADO = { atacando: 'attack', defendendo: 'defense' };

/** O texto da busca. "lineup" em inglês acha muito mais que em português. */
export function termoDaBusca({ mapa, agente, habilidade, lado }) {
  return [agente, habilidade, 'lineup', mapa, LADO[lado] ?? '']
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Sem agente ou sem mapa não dá pra procurar nada útil. */
export const buscavel = ({ mapa, agente } = {}) => Boolean(mapa && agente);

const normalizarInvidious = (v) => ({
  id: v.videoId,
  titulo: v.title ?? '',
  canal: v.author ?? '',
  segundos: Number(v.lengthSeconds) || 0,
  // sempre o CDN do YouTube, nunca a capa proxiada pela instância: as 20 vinham quebradas
  // porque o proxy da instância comunitária não serve imagem de forma confiável
  capa: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
  visitas: Number(v.viewCount) || 0,
});

const normalizarYoutube = (v) => ({
  id: v.id?.videoId,
  titulo: v.snippet?.title ?? '',
  canal: v.snippet?.channelTitle ?? '',
  segundos: 0,                                   // a busca oficial não devolve duração
  capa: v.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id?.videoId}/mqdefault.jpg`,
  visitas: 0,
});

/**
 * Procura vídeo de lineup. Devolve `{ termo, videos, fonte, aviso }` — nunca estoura:
 * aba sem resultado com um aviso é melhor que aba quebrada.
 */
export async function buscar({ mapa, agente, habilidade, lado, chaveYoutube = null, duracao = null } = {}) {
  const termo = termoDaBusca({ mapa, agente, habilidade, lado });
  if (!termo || termo === 'lineup') return { termo, videos: [], fonte: null, aviso: 'escolha pelo menos o agente e o mapa' };

  // 1. chave oficial do YouTube, se ele tiver posto uma na config
  if (chaveYoutube) {
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      const campos = { part: 'snippet', type: 'video', maxResults: '20', q: termo, key: chaveYoutube };
      // `medium` = de 4 a 20 min, que é onde vivem as compilações com capítulo. Sem esse filtro
      // a oficial trazia só Shorts de uma lineup só, sem capítulo nenhum, e a busca de
      // Bind+Brimstone voltava 0 (enquanto o Invidious trazia as compilações).
      if (duracao) campos.videoDuration = duracao;
      u.search = new URLSearchParams(campos);
      const d = await buscarJson(u.toString());
      const videos = (d.items ?? []).map(normalizarYoutube).filter((v) => v.id);
      if (videos.length) return { termo, videos, fonte: 'youtube' };
    } catch { /* chave velha ou cota estourada: cai pro sem-chave */ }
  }

  // 2. sem chave, pelas instâncias abertas
  const erros = [];
  for (const base of INVIDIOUS) {
    try {
      const d = await tentarJson(`${base}/api/v1/search?q=${encodeURIComponent(termo)}&type=video`, 12000);
      if (!Array.isArray(d)) throw new Error('resposta fora do formato');
      const videos = d.map(normalizarInvidious)
        .filter((v) => v.id && v.segundos >= MIN_SEG && v.segundos <= MAX_SEG);
      if (videos.length) return { termo, videos, fonte: new URL(base).host };
      erros.push(`${new URL(base).host}: sem resultado`);
    } catch (e) { erros.push(`${new URL(base).host}: ${e.message}`); }
  }
  return {
    termo, videos: [], fonte: null,
    aviso: 'não consegui buscar agora. Dá pra abrir a mesma busca no YouTube pelo botão.',
    detalhe: erros.join(' · '),
  };
}

/* ------------------------------------------------------------- lineup a lineup */

/**
 * O pulo do gato: vídeo de lineup quase sempre vem com capítulo por lineup na descrição
 * ("00:07 A Default FAST Molly 1 (A Lobby)"). Um vídeo de 10 min vira 34 lineups
 * clicáveis, cada uma abrindo no segundo exato. Sem isso a aba seria uma lista de vídeos
 * de 10 minutos pra assistir inteiros, que não serve pra nada na hora de jogar.
 */
const MARCADOR = /^[\s\-–—•*]*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:)|.]*\s*(.{3,80}?)\s*$/;
const PULA = /\bjump(?:\s*|-)?throw\b|\bjump\b|\brun\s*(?:and\s*)?throw\b|\bpulo\b|\bpulando\b/i;
const SO_INTRO = /^(intro|introduction|in[ií]cio|outro|like|subscribe|inscreva|timestamps?|cap[ií]tulos?)\b/i;
// capítulo que não é lineup: agradecimento, pedido de inscrição, encerramento
const NAO_E_LINEUP = /\bthanks?\s+(?:for|you)\b|\bsubscribe\b|\bsub\s+to\b|\bdiscord\b|\boutro\b|\bconclus|\bobrigad/i;

const emSegundos = (t) => {
  const p = String(t).split(':').map(Number);
  if (p.some((n) => !Number.isFinite(n))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

/** De que ponto do mapa é a lineup, pelo nome do capítulo. É o filtro que ele usa de verdade. */
export function sitePeloNome(nome) {
  const t = ` ${String(nome).toLowerCase()} `;
  const ondes = [
    ['A', /\ba[\s)\].,]|\ba site\b|\ba lobby\b|\ba main\b/],
    ['B', /\bb[\s)\].,]|\bb site\b|\bb lobby\b|\bb main\b/],
    ['C', /\bc[\s)\].,]|\bc site\b/],
    ['Mid', /\bmid\b|\bmeio\b/],
  ].map(([site, re]) => [site, t.search(re)]).filter(([, i]) => i >= 0);
  if (!ondes.length) return null;
  // o primeiro que aparece: "A Default Molly (Top Mid)" é do A, jogada do mid
  return ondes.sort((x, y) => x[1] - y[1])[0][0];
}

/** Que mapas são citados num nome, na ordem em que aparecem. Nome de mapa não é traduzido. */
export function mapasNoNome(nome, nomes = []) {
  const t = semAcentoMin(nome);
  return nomes
    .map((m) => [m, t.search(new RegExp(String.raw`\b${semAcentoMin(m).replace(/[^a-z0-9]/g, '.')}\b`))])
    .filter(([, i]) => i >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([m]) => m);
}

/**
 * Quais capítulos são DESTE mapa — devolve um booleano por capítulo.
 *
 * Sem isto a aba misturava mapa. Medido no Breeze com Fade: dos 85 capítulos, 38 vinham de
 * um só vídeo, o "BEST Fade Lineups ALL MAPS", e NENHUM deles era de Breeze — eram Abyss,
 * Bind, Corrode, Fracture, Haven, Lotus, Pearl e Sunset, todos fincados na planta do Breeze.
 *
 * A regra: o capítulo que cita um mapa é daquele mapa; o que não cita herda o do capítulo
 * anterior (vídeo de compilação diz o mapa uma vez e segue). Quando ninguém disse nada
 * ainda, vale o que o título do vídeo diz. E se nem o título diz, o capítulo fica — não dá
 * pra afirmar que é de outro mapa, e jogar fora no escuro é pior do que deixar passar.
 */
export function capitulosDesteMapa(caps, titulo, mapa, nomes = []) {
  if (!mapa || nomes.length < 2) return caps.map(() => true);
  const noTitulo = mapasNoNome(titulo, nomes);
  // o título citar o mapa pedido já basta, mesmo que cite outros junto
  let atual = noTitulo.includes(mapa) ? mapa : (noTitulo.length === 1 ? noTitulo[0] : null);
  return caps.map((c) => {
    const citados = mapasNoNome(c.nome, nomes);
    if (citados.includes(mapa)) atual = mapa;
    else if (citados.length) atual = citados[0];
    return atual == null || atual === mapa;
  });
}

/** Que agentes são citados num nome, na ordem em que aparecem. Nome de agente não é traduzido. */
export function agentesNoNome(nome, nomes = []) {
  const t = semAcentoMin(nome);
  return nomes
    // o `.?` no lugar da pontuação é o KAY/O: o canal escreve "KAY/O", "KAYO" e "KAY O"
    .map((a) => [a, t.search(new RegExp(String.raw`\b${semAcentoMin(a).replace(/[^a-z0-9]/g, '.?')}\b`))])
    .filter(([, i]) => i >= 0)
    .sort((x, y) => x[1] - y[1])
    .map(([a]) => a);
}

/**
 * Quais capítulos são DESTE agente — um booleano por capítulo, a mesma regra do filtro de
 * mapa (ver capitulosDesteMapa).
 *
 * "lineup de fade apareceu uma do sova, deve ter varios assim tbm". Tem: 131 das 6245 do
 * acervo dele. 99 vêm de vídeo que não é do agente pedido de jeito nenhum — a busca do
 * YouTube devolve "Sunset Sova Lineups" numa procura por Fade e os 21 capítulos entravam
 * inteiros — e 32 são capítulo de outro agente dentro de vídeo de dois ("Sova&KAY/O Lineup
 * Guide", com blocos de Gekko, Killjoy e Tejo no meio).
 */
export function capitulosDesteAgente(caps, titulo, agente, nomes = []) {
  if (!agente || nomes.length < 2) return caps.map(() => true);
  const noTitulo = agentesNoNome(titulo, nomes);
  // o título citar o agente pedido já basta, mesmo que cite outros junto
  let atual = noTitulo.includes(agente) ? agente : (noTitulo.length === 1 ? noTitulo[0] : null);
  return caps.map((c) => {
    const citados = agentesNoNome(c.nome, nomes);
    if (citados.includes(agente)) atual = agente;
    else if (citados.length) atual = citados[0];
    return atual == null || atual === agente;
  });
}

/** Capítulos de um vídeo viram lineups. Devolve [] se o vídeo não tiver marcação. */
export function capitulosDaDescricao(descricao) {
  const fora = [];
  for (const linha of String(descricao ?? '').split(/\r?\n/)) {
    const m = linha.match(MARCADOR);
    if (!m) continue;
    const segundo = emSegundos(m[1]);
    const nome = m[2].replace(/\s{2,}/g, ' ').trim();
    if (segundo == null || !nome || SO_INTRO.test(nome) || NAO_E_LINEUP.test(nome)) continue;
    if (segundo === 0) continue;   // o capítulo do 0:00 é a abertura ("New Viper Lineups Ascent 2023")
    // `pula` é true, false ou null: null = o vídeo não disse. Não dá pra afirmar "sem pulo"
    // só porque o nome do capítulo não falou — ele mesmo marca quando salva.
    fora.push({ segundo, nome, site: sitePeloNome(nome), pula: PULA.test(nome) ? true : null });
  }
  // marcação de capítulo sobe no tempo; se não subir, é outra coisa (lista de links, créditos)
  const subindo = fora.filter((x, i) => i === 0 || x.segundo > fora[i - 1].segundo);
  return subindo.length >= 3 ? subindo : [];
}

/**
 * Os quadros do vídeo, de graça e sem baixar nada: o YouTube publica um "storyboard" —
 * folhas de sprite com um quadro a cada ~5 s, que é o que aparece quando você arrasta a
 * barra do player. Cada lineup pega os quadros do pedaço dela, e assim dá pra ver a tela
 * do jogo sem abrir vídeo nenhum — que era a reclamação: "não dá pra ver 1 por 1".
 *
 * O sprite vem apontando pra instância do Invidious, que serve HTML no lugar da imagem;
 * trocando o host pelo CDN do YouTube a imagem vem certa (testado: 66 KB de webp).
 */
const VTT_TEMPO = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

/**
 * O recorte vira linha/coluna na folha. Assim a tela pode mostrar o quadro em QUALQUER
 * tamanho usando porcentagem (background-size/position), sem depender da largura em pixel
 * do cartão — a fonte só tem 318x180 e encolher no CSS jogaria resolução fora.
 */
function grelhar(tiras) {
  const porFolha = new Map();
  for (const t of tiras) {
    t.col = Math.round(t.x / (t.w + 2));          // o passo é a largura do quadro + 2 px de borda
    t.lin = Math.round(t.y / t.h);
    const f = porFolha.get(t.url) ?? { cols: 0, lins: 0 };
    f.cols = Math.max(f.cols, t.col + 1); f.lins = Math.max(f.lins, t.lin + 1);
    porFolha.set(t.url, f);
  }
  for (const t of tiras) { const f = porFolha.get(t.url); t.cols = f.cols; t.lins = f.lins; }
  return tiras;
}

export function lerStoryboard(vtt) {
  const linhas = String(vtt ?? '').split(/\r?\n/);
  const fora = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(VTT_TEMPO);
    if (!m) continue;
    const de = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const ate = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    const alvo = (linhas[i + 1] ?? '').trim();
    if (!alvo.startsWith('http')) continue;
    const [endereco, corte] = alvo.split('#xywh=');
    if (!corte) continue;
    const [x, y, w, h] = corte.split(',').map(Number);
    if ([x, y, w, h].some((n) => !Number.isFinite(n))) continue;
    fora.push({ de, ate, url: endereco.replace(/^https?:\/\/[^/]+\/sb\/i\//, 'https://i.ytimg.com/sb/'), x, y, w, h });
  }
  return grelhar(fora);
}

const storyboardDoVideo = async (base, id, ate = Infinity) => {
  for (const b of ordemAPartirDe(base)) {
    if (Date.now() > ate) break;
    try {
      const corta = AbortSignal.timeout(Math.min(9000, Math.max(1500, ate - Date.now())));
      const r = await fetch(`${b}/api/v1/storyboards/${encodeURIComponent(id)}?width=320&height=180`, { signal: corta });
      if (!r.ok) continue;
      const txt = await r.text();
      if (!txt.startsWith('WEBVTT')) continue;          // instância desligada devolve 200 com aviso em texto
      const t = lerStoryboard(txt);
      if (t.length) return t;
    } catch { /* tenta a próxima */ }
  }
  return [];
};

/** Os quadros que mostram ESTA lineup: começo, meio e fim do pedaço dela. */
export function quadrosDaLineup(tiras, de, ate) {
  if (!tiras.length) return [];
  const fim = Number.isFinite(ate) && ate > de ? Math.min(ate, de + 40) : de + 12;
  const momentos = [0.12, 0.5, 0.85].map((f) => de + (fim - de) * f);
  const vistos = new Set(), fora = [];
  for (const t of momentos) {
    const q = tiras.find((x) => t >= x.de && t < x.ate) ?? tiras[tiras.length - 1];
    const chave = `${q.url}|${q.x}|${q.y}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave); fora.push(q);
  }
  return fora;
}

/**
 * Os capítulos de um vídeo. Tenta a instância que respondeu a busca e, se ela recusar,
 * as outras: são servidores comunitários que limitam por uso, e quando a de plantão começa
 * a negar os detalhes a aba vinha vazia mesmo tendo achado os vídeos.
 */
const ordemAPartirDe = (base) => [base, ...INVIDIOUS.filter((x) => x !== base)];

/**
 * Descrições pela API oficial do YouTube, em UMA chamada pra até 50 vídeos (custa 1 unidade).
 * É o caminho rápido e confiável: as instâncias comunitárias de Invidious vivem caindo — num
 * teste, as quatro recusaram detalhe ao mesmo tempo (500, 401, 403 e fora do ar) e a busca
 * voltou vazia mesmo tendo achado os vídeos. Sem chave, cai no Invidious como antes.
 */
async function descricoesOficiais(ids, chave) {
  if (!chave || !ids.length) return null;
  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    // `status` vem na MESMA chamada, de graça, e diz se o dono deixa tocar fora do YouTube.
    // Sem isso a lineup entrava no acervo e virava retângulo preto na hora de assistir.
    u.search = new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.slice(0, 50).join(','), key: chave });
    const d = await buscarJson(u.toString(), 9000);
    const fora = new Map();
    for (const v of d.items ?? []) fora.set(v.id, {
      descricao: v.snippet?.description ?? '',
      embutivel: v.status?.embeddable !== false && v.status?.privacyStatus === 'public',
    });
    return fora;
  } catch { return null; }
}

const detalhesDoVideo = async (base, id, ate = Infinity) => {
  for (const b of ordemAPartirDe(base)) {
    if (Date.now() > ate) break;
    try {
      const d = await tentarJson(`${b}/api/v1/videos/${encodeURIComponent(id)}`, 9000, 2, ate);
      const caps = capitulosDaDescricao(d?.description);
      if (caps.length) return caps;
      if (d?.description != null) return caps;   // respondeu e o vídeo não tem capítulo mesmo
    } catch { /* essa recusou: tenta a próxima */ }
  }
  return [];
};

/**
 * Busca e já abre em lineups individuais. `videos` continua vindo, pros que não têm
 * capítulo — mas o que a aba mostra é `lineups`.
 */
/**
 * Busca inteira guardada em disco. Procurar leva uns 25 s (busca + descrição e storyboard de
 * 6 vídeos) e lineup de um mapa não muda de semana pra semana — então da segunda vez em
 * diante sai na hora, do disco, e só revalida quando fica velho.
 */
// Só decide QUANDO atualizar por baixo — nunca faz ninguém esperar, então pode ser longo.
const VALIDADE_BUSCA = 30 * 24 * 60 * 60 * 1000;
// 4: antes do filtro de mapa, o que estava em disco tinha lineup de mapa errado dentro
// 5: cada lineup passou a saber se é de ataque ou de defesa
// 6: filtro de agente (tinha lineup de Sova dentro de busca de Fade) e lado mais exigente
const FORMATO_BUSCA = 6;
// quantos vídeos a busca abre (ver o comentário em buscarLineups) e quantos ganham prévia
const VIDEOS_LIDOS = 18;
const VIDEOS_COM_PREVIA = 6;
const chaveDaBusca = (p = {}) => [p.mapa, p.agente, p.habilidade || '-', p.lado || '-']
  .map((x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_')).join('__');

/** O que já está em disco pra essa combinação, ou null. */
export async function buscaGuardada(p = {}) {
  if (!buscavel(p)) return null;
  const g = await lerJson(arqBusca(chaveDaBusca(p)), null);
  if (!g?.lineups?.length) return null;
  const pronto = g.formato === FORMATO_BUSCA ? g : await migrarBusca(p, g);
  if (!pronto) return null;
  /* "Velho" não é só por data: o que foi salvo quando a busca lia 6 vídeos tem um terço
   * das lineups que a mesma busca traria hoje. Marcar como velho não faz ele esperar —
   * o arquivo magro aparece na hora do mesmo jeito e a versão cheia entra por baixo. */
  const magro = (pronto.lidos ?? 6) < VIDEOS_LIDOS;
  const vencido = Date.now() - (pronto.em ?? 0) > VALIDADE_BUSCA;
  return { ...pronto, doDisco: true, velho: magro || vencido };
}

const porVideoNaOrdem = (lineups) => {
  const m = new Map();
  for (const l of lineups) {
    if (!m.has(l.video)) m.set(l.video, []);
    m.get(l.video).push(l);
  }
  return m;
};

/** 3 -> 4: tira do arquivo o capítulo que era de outro mapa. */
function soDesteMapa(mapa, lineups, nomes) {
  const fica = new Set();
  for (const ls of porVideoNaOrdem(lineups).values()) {
    const ok = capitulosDesteMapa(ls, ls[0]?.titulo ?? '', mapa, nomes);
    ls.forEach((l, i) => { if (ok[i]) fica.add(l); });
  }
  return lineups.filter((l) => fica.has(l));
}

/**
 * 4 -> 5: diz o lado de cada lineup que já está salva.
 *
 * Dá pra fazer sem rede nenhuma: o nome do capítulo, o título do vídeo e a posição estão
 * todos no arquivo. A ordem original da lista não muda — o lado é calculado na ordem do
 * tempo de cada vídeo (que é o que a herança por bloco precisa) e devolvido por lineup.
 */
function comOLado(mapa, lineups, cat) {
  const callouts = cat?.mapas?.find((x) => x.nome === mapa)?.callouts ?? [];
  const achado = new Map();
  for (const ls of porVideoNaOrdem(lineups).values()) {
    const ordem = ls.slice().sort((a, b) => a.segundo - b.segundo);
    const lados = ladosDosCapitulos(ordem, ordem[0]?.titulo ?? '');
    ordem.forEach((l, i) => achado.set(l, lados[i]));
  }
  return lineups.map((l) => {
    const { lado, pista } = juntarLado(achado.get(l), l.posicao, callouts);
    return { ...l, lado, ladoPista: pista };
  });
}

/** 5 -> 6: tira do arquivo o capítulo que era de outro agente. */
function soDesteAgente(agente, lineups, nomes) {
  const fica = new Set();
  for (const ls of porVideoNaOrdem(lineups).values()) {
    const ordem = ls.slice().sort((a, b) => a.segundo - b.segundo);
    const ok = capitulosDesteAgente(ordem, ordem[0]?.titulo ?? '', agente, nomes);
    ordem.forEach((l, i) => { if (ok[i]) fica.add(l); });
  }
  return lineups.filter((l) => fica.has(l));
}

/**
 * Aproveita o que já está no disco em vez de mandar procurar tudo de novo.
 *
 * O formato 4 entrou porque o 3 guardava lineup de outro mapa dentro; o 5 porque a lineup
 * passou a saber de que lado ela é; o 6 porque guardava lineup de outro AGENTE dentro, e
 * porque o lado passou a ser mais exigente. Só que jogar fora 3 MB de acervo por causa
 * disso é pior pra ele do que arrumar: todas as contas rodam em cima do que já está salvo
 * — os capítulos de um vídeo estão lá, com nome, título e posição — e o arquivo sobe de
 * formato sem uma única chamada de rede. A data original fica, senão tudo pareceria novo.
 */
async function migrarBusca(p, g) {
  if (![3, 4, 5].includes(g.formato)) return null;   // mais velho que isso não vale a tentativa
  const cat = await catalogo().catch(() => null);
  const nomes = (cat?.mapas ?? []).map((x) => x.nome);
  const agentes = (cat?.agentes ?? []).map((x) => x.nome);
  if (!nomes.length || !agentes.length) return null;
  let lineups = g.lineups;
  if (g.formato === 3) {
    lineups = soDesteMapa(p.mapa, lineups, nomes);
    if (!lineups.length) return null;      // era tudo de outro mapa: melhor procurar de novo
  }
  lineups = soDesteAgente(p.agente, lineups, agentes);
  if (!lineups.length) return null;        // era tudo de outro agente: melhor procurar de novo
  lineups = comOLado(p.mapa, lineups, cat);
  const novo = { ...g, lineups, formato: FORMATO_BUSCA };
  await guardarBusca(p, novo, g.em ?? Date.now());
  return novo;
}

async function guardarBusca(p, r, em = Date.now()) {
  if (!r?.lineups?.length) return;
  // `pedido` junto do resultado: sem isso o acervo só tinha o nome do arquivo pra se virar,
  // e nome de arquivo é slug ("kay_o"), não dá pra mostrar na tela.
  const pedido = { mapa: p.mapa ?? '', agente: p.agente ?? '', habilidade: p.habilidade || null, lado: p.lado || null };
  try {
    await garantirBuscas();
    await writeFile(arqBusca(chaveDaBusca(p)), JSON.stringify({ ...r, pedido, em, formato: FORMATO_BUSCA }), 'utf8');
    await anotarNoAcervo(chaveDaBusca(p), { ...pedido, lineups: r.lineups.length, em });
  } catch { /* disco cheio: a busca continua valendo em memória */ }
}

/** Atualiza por baixo o que já está no acervo mas ficou velho. Ele não espera nada disso. */
const revalidando = new Set();
function revalidarDepois(p) {
  const chave = chaveDaBusca(p);
  if (revalidando.has(chave)) return;
  revalidando.add(chave);
  setTimeout(async () => {
    try {
      const r = await buscarLineups(p);
      if (r.lineups?.length) await guardarBusca(p, r);
    } catch { /* fica o velho, que é melhor que nada */ }
    finally { revalidando.delete(chave); }
  }, 2500);
}

/**
 * Deixa pronto, sem pressa e sem avisar, o que ele provavelmente vai pedir a seguir: o
 * outro lado do mesmo agente. No meio de uma partida, trocar de atacante pra defensor não
 * pode custar 5 segundos de espera.
 */
const aquecendo = new Set();
function aquecerDepois(p) {
  const outro = { ...p, lado: p.lado === 'defendendo' ? 'atacando' : 'defendendo', forcar: false };
  const chave = chaveDaBusca(outro);
  if (aquecendo.has(chave)) return;
  aquecendo.add(chave);
  setTimeout(async () => {
    try { if (!(await buscaGuardada(outro))) await guardarBusca(outro, await buscarLineups(outro)); }
    catch { /* era só adiantamento */ }
    finally { aquecendo.delete(chave); }
  }, 1200);
}

/**
 * Com acervo: instantâneo quando já foi guardado. `forcar` ignora o disco.
 *
 * O que está em disco sai NA HORA, mesmo velho. Antes, passado o prazo, ele tinha que
 * esperar a busca de novo (uns 25 s) — no meio de uma partida isso é inútil. Agora o
 * velho aparece na mesma e a atualização acontece por baixo; na próxima vez já é a nova.
 */
export async function lineupsDe(p = {}) {
  if (!p.forcar) {
    const g = await buscaGuardada(p);
    if (g) { if (g.velho) revalidarDepois(p); aquecerDepois(p); return semOsRuins(g); }
  }
  const r = await buscarLineups(p);
  await guardarBusca(p, r);
  if (r.lineups?.length) aquecerDepois(p);
  // deu ruim agora mas tem coisa velha guardada? melhor velho que vazio
  if (!r.lineups?.length) {
    const g = await buscaGuardada(p);
    if (g) return semOsRuins({ ...g, aviso: 'não consegui atualizar agora; mostrando o que já estava salvo' });
  }
  return semOsRuins(r);
}

export async function buscarLineups(p = {}) {
  // com chave, primeiro as compilações (4-20 min); se nenhuma tiver capítulo, repete sem filtro
  let r = await buscar(p.chaveYoutube && !p.semMedium ? { ...p, duracao: 'medium' } : p);
  let semFiltro = false;
  if (!r.videos?.length && p.chaveYoutube) { r = await buscar(p); semFiltro = true; }
  if (p.semMedium) semFiltro = true;
  if (!r.videos?.length) return { ...r, lineups: [] };
  // `fonte: 'youtube'` quer dizer que a BUSCA veio da API oficial. Isso costumava abortar
  // aqui, de quando esse caminho ainda não sabia ler capítulo — com a chave posta, a busca
  // voltava 0 lineups em 0,4 s. Hoje a oficial lê descrição, então segue em frente; só o
  // storyboard (que a oficial não tem) é que continua saindo do Invidious.
  const base = INVIDIOUS.find((b) => new URL(b).host === r.fonte) ?? INVIDIOUS[0];
  let semEmbed = 0;

  /* Com chave, 18 vídeos; sem chave, 6.
   *
   * Isto era o gargalo da variedade. A descrição de até 50 vídeos sai numa ÚNICA chamada
   * (1 unidade de cota), então ler 18 custa exatamente o mesmo que ler 6 — e muda tudo.
   * Medido agora, com a chave dele:
   *   Ascent+Sova      105 capítulos de 3 canais  ->  301 capítulos de 8 canais
   *   Bind+Brimstone   139 capítulos de 6 canais  ->  234 capítulos de 10 canais
   *   Lotus+Viper      124 capítulos de 5 canais  ->  182 capítulos de 9 canais
   * Sem chave continua 6: lá cada descrição é uma chamada ao Invidious, que é comunitário.
   */
  const candidatos = r.videos.slice(0, p.chaveYoutube ? VIDEOS_LIDOS : 6);
  const porVideo = [];
  const prazo = Date.now() + 11000;     // o que não chegou até aqui não vale a espera

  // Caminho rápido: uma chamada à API oficial traz a descrição dos 6 de uma vez.
  const oficiais = await descricoesOficiais(candidatos.map((v) => v.id), p.chaveYoutube);
  if (oficiais?.size) {
    // O quadro de prévia (storyboard) é a parte cara: vem do Invidious, uma chamada por
    // vídeo, e disparar 18 de uma vez faz a instância recusar tudo. Então só os 6 primeiros
    // ganham prévia; as lineups dos outros 12 funcionam igual, só abrem sem miniatura.
    const tiras = await Promise.all(candidatos.map(async (v, k) => {
      const o = oficiais.get(v.id);
      if (o && !o.embutivel) { semEmbed++; return { v, caps: [], tiras: [] }; }
      const caps = capitulosDaDescricao(o?.descricao);
      const vale = caps.length && k < VIDEOS_COM_PREVIA;
      return { v, caps, tiras: vale ? await storyboardDoVideo(base, v.id, prazo).catch(() => []) : [] };
    }));
    porVideo.push(...tiras);
  }

  // Só cai pro Invidious se a oficial não deu conta (sem chave, ou cota estourada)
  for (let i = 0; porVideo.length === 0 && i < candidatos.length; i += 3) {
    if (i && Date.now() > prazo) break;
    const lote = await Promise.all(candidatos.slice(i, i + 3).map(async (v) => {
      try {
        const [caps, tiras] = await Promise.all([detalhesDoVideo(base, v.id, prazo), storyboardDoVideo(base, v.id, prazo)]);
        return { v, caps, tiras: caps.length ? tiras : [] };
      } catch { return { v, caps: [], tiras: [] }; }
    }));
    porVideo.push(...lote);
    // já deu capítulo que chegue: não precisa incomodar a instância com o resto
    if (porVideo.reduce((n, x) => n + x.caps.length, 0) >= 30) break;
  }

  // o ponto no mapa sai daqui, não do navegador: a tela só desenha o pino
  const cat = await catalogo().catch(() => null);
  const callouts = cat?.mapas?.find((x) => x.nome === p.mapa)?.callouts ?? [];
  const habs = cat?.agentes?.find((x) => x.nome === p.agente)?.habilidades ?? [];
  const nomesDeMapa = (cat?.mapas ?? []).map((x) => x.nome);
  const nomesDeAgente = (cat?.agentes ?? []).map((x) => x.nome);

  const lineups = [];
  let deOutroMapa = 0, deOutroAgente = 0;
  for (const { v, caps, tiras } of porVideo) {
    const daqui = capitulosDesteMapa(caps, v.titulo, p.mapa, nomesDeMapa);
    const dele = capitulosDesteAgente(caps, v.titulo, p.agente, nomesDeAgente);
    const lados = ladosDosCapitulos(caps, v.titulo);
    for (let i = 0; i < caps.length; i++) {
      if (!daqui[i]) { deOutroMapa++; continue; }       // capítulo de outro mapa: não é deste mapa
      if (!dele[i]) { deOutroAgente++; continue; }      // capítulo de outro agente: não é dele
      const c = caps[i];
      const { alvo: ponto, posicao } = pontasDaLineup(c.nome, callouts, c.site);
      // de onde sai a habilidade, na ordem: o nome do capítulo; o título do vídeo (quase sempre
      // é lá que está, porque o vídeo inteiro é sobre uma só — "Brimstone Molly Lineups"); e por
      // fim a que ele filtrou, que é o que ele pediu. Só 2 de 111 casavam só pelo capítulo.
      const hab = habilidadeDaLineup(c.nome, habs)
        ?? habilidadeDaLineup(v.titulo, habs)
        ?? (p.habilidade ? habs.find((x) => x.busca === p.habilidade) : null)
        ?? null;
      // o fim da lineup é o começo da próxima: assim o player toca SÓ o clipe dela
      const fim = caps[i + 1]?.segundo ?? (v.segundos || c.segundo + 25);
      // ataque ou defesa: o que o capítulo diz, depois o lugar, depois a seção e o título
      const { lado, pista: ladoPista } = juntarLado(lados[i], posicao, callouts);
      lineups.push({
        video: v.id, titulo: v.titulo, canal: v.canal, lado, ladoPista,
        capa: v.capa, segundo: c.segundo, fim, nome: c.nome, site: c.site, pula: c.pula,
        quadros: quadrosDaLineup(tiras ?? [], c.segundo, fim),
        habilidade: hab ? { nome: hab.nome, icone: hab.icone } : null,
        ponto: ponto ? { nome: ponto.nome, x: ponto.x, y: ponto.y, aproximado: ponto.aproximado === true } : null,
        posicao: posicao ? { nome: posicao.nome, x: posicao.x, y: posicao.y } : null,   // de onde se joga, quando o título diz
      });
    }
  }
  // nenhum dos vídeos de 4-20 min tinha capítulo? vale tentar o resto antes de desistir
  if (!lineups.length && p.chaveYoutube && !semFiltro) {
    const solto = await buscarLineups({ ...p, semMedium: true });
    if (solto.lineups?.length) return solto;
  }

  const comCapitulo = porVideo.filter((x) => x.caps.length).length;
  const mapa = cat?.mapas?.find((x) => x.nome === p.mapa) ?? null;
  return {
    ...r, lineups,
    semChave: !p.chaveYoutube,
    planta: mapa?.planta ?? null,
    callouts: mapa?.callouts ?? [],
    semCapitulo: !lineups.length,
    deOutroMapa,
    deOutroAgente,
    semEmbed,
    lidos: candidatos.length,
    resumo: lineups.length ? `${lineups.length} lineups de ${comCapitulo} vídeo${comCapitulo > 1 ? 's' : ''}` : null,
  };
}

/* ------------------------------------------------------------------ o acervo
 *
 * "pra parar de ter q ficar pesquisando toda vez e organizar tudo".
 *
 * O que muda em relação ao cache que já existia: o cache era um efeito colateral — só
 * enchia no que ele por acaso tinha aberto, e vencia. O acervo é de propósito: ele manda
 * guardar um agente, o app varre os 13 mapas dos dois lados e grava tudo em disco. Dali em
 * diante a aba abre sem rede nenhuma, e a atualização acontece por baixo.
 *
 * Por que por AGENTE e não tudo de uma vez: a busca do YouTube custa 100 unidades da cota
 * diária de 10.000, ou seja 100 buscas por dia. Um agente são 13 mapas x 2 lados = 26
 * buscas (2.600 unidades), cabe 3 agentes por dia. Varrer os 28 agentes seriam 728 buscas:
 * estouraria a cota no primeiro terço e deixaria o resto sem nada.
 */

const indice = () => lerJson(arqAcervo(), null);
let gravandoIndice = Promise.resolve();

/** Anota uma linha no índice. Serializado: a varredura e o aquecimento gravam juntos. */
function anotarNoAcervo(chave, linha) {
  gravandoIndice = gravandoIndice.then(async () => {
    const ix = (await indice()) ?? {};
    ix[chave] = linha;
    await gravarJson(arqAcervo(), ix);
  }).catch(() => {});
  return gravandoIndice;
}

const comoSlug = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * Remonta o índice lendo a pasta. Só roda quando o índice não existe ou está atrás da
 * pasta — quem usa o app desde antes do acervo tem arquivo lá sem nenhuma anotação.
 */
async function remontarIndice(cat) {
  const arquivos = (await readdir(resolve(pasta(), 'buscas')).catch(() => [])).filter((n) => n.endsWith('.json'));
  const ix = (await indice()) ?? {};
  if (arquivos.length <= Object.keys(ix).length) return ix;
  const mapas = (cat?.mapas ?? []).map((m) => [comoSlug(m.nome), m.nome]);
  const agentes = (cat?.agentes ?? []).map((a) => [comoSlug(a.nome), a.nome]);
  for (const arq of arquivos) {
    const chave = arq.replace(/\.json$/, '');
    if (ix[chave]) continue;
    const g = await lerJson(resolve(pasta(), 'buscas', arq), null);
    if (!g?.lineups?.length) continue;
    // o nome do arquivo é slug; o `pedido` só existe nos gravados a partir do acervo
    const [m, a, hab, lado] = chave.split('__');
    ix[chave] = g.pedido ? { ...g.pedido, lineups: g.lineups.length, em: g.em ?? 0 } : {
      mapa: mapas.find(([sl]) => sl === m)?.[1] ?? m,
      agente: agentes.find(([sl]) => sl === a)?.[1] ?? a,
      habilidade: hab && hab !== '-' ? hab : null,
      lado: lado && lado !== '-' ? lado : null,
      lineups: g.lineups.length, em: g.em ?? 0,
    };
  }
  await gravarJson(arqAcervo(), ix);
  return ix;
}

/**
 * O acervo agrupado por agente, que é como ele escolhe: "tenho a Fade pronta?".
 *
 * As linhas com `habilidade` ficam de fora da conta. Até a 2.28.251 a busca levava a
 * habilidade junto, então o disco tinha um arquivo por habilidade do mesmo mapa — somar
 * todos daria "1081 lineups no Brimstone em 3 mapas", que é a mesma lineup contada cinco
 * vezes. Hoje a habilidade filtra na tela e esses arquivos não são lidos por ninguém:
 * entram só como `sobra`, pra ele apagar quando quiser.
 */
export async function acervo() {
  const cat = await catalogo().catch(() => null);
  const ix = await remontarIndice(cat);
  const porAgente = new Map();
  const sobra = { arquivos: 0, lineups: 0 };
  for (const [chave, l] of Object.entries(ix)) {
    if (!l?.agente) continue;
    if (l.habilidade) { sobra.arquivos++; sobra.lineups += l.lineups ?? 0; continue; }
    if (!porAgente.has(l.agente)) porAgente.set(l.agente, { agente: l.agente, icone: null, mapas: new Map(), lineups: 0, em: 0, chaves: [] });
    const g = porAgente.get(l.agente);
    g.chaves.push(chave);
    g.lineups += l.lineups ?? 0;
    g.em = Math.max(g.em, l.em ?? 0);
    const m = g.mapas.get(l.mapa) ?? { mapa: l.mapa, lineups: 0, lados: new Set(), em: 0 };
    m.lineups += l.lineups ?? 0;
    m.em = Math.max(m.em, l.em ?? 0);
    if (l.lado) m.lados.add(l.lado);
    g.mapas.set(l.mapa, m);
  }
  const totalMapas = (cat?.mapas ?? []).length;
  const lista = [...porAgente.values()].map((g) => ({
    agente: g.agente,
    icone: cat?.agentes?.find((a) => a.nome === g.agente)?.icone ?? null,
    lineups: g.lineups,
    em: g.em,
    mapas: [...g.mapas.values()].map((m) => ({ ...m, lados: [...m.lados] })).sort((a, b) => a.mapa.localeCompare(b.mapa, 'pt-BR')),
    completo: totalMapas > 0 && g.mapas.size >= totalMapas,
  })).sort((a, b) => b.em - a.em);
  return { agentes: lista, totalMapas, sobra, varredura: statusDaVarredura() };
}

/** Apaga as buscas por habilidade, que o app não lê mais. Só a pedido dele. */
export async function limparSobra() {
  const ix = (await indice()) ?? {};
  const chaves = Object.entries(ix).filter(([, l]) => l?.habilidade).map(([c]) => c);
  for (const c of chaves) { await unlink(arqBusca(c)).catch(() => {}); delete ix[c]; }
  await gravarJson(arqAcervo(), ix);
  return { apagadas: chaves.length };
}

/** Tira do disco tudo que é de um agente — o botão de arrumar a casa. */
export async function esquecerAgente(agente) {
  const ix = (await indice()) ?? {};
  const chaves = Object.entries(ix).filter(([, l]) => l?.agente === agente).map(([c]) => c);
  for (const c of chaves) {
    await unlink(arqBusca(c)).catch(() => {});
    delete ix[c];
  }
  await gravarJson(arqAcervo(), ix);
  return { apagadas: chaves.length };
}

/* ---------------------------------------------------------- varrer um agente */

const varredura = { rodando: false, agente: null, feitos: 0, total: 0, agora: null, novas: 0, vazias: 0, em: null };
export const statusDaVarredura = () => ({ ...varredura });

/**
 * Guarda um agente inteiro: todos os mapas, os dois lados, um de cada vez.
 *
 * Um de cada vez de propósito. As instâncias do Invidious são comunitárias e passam a
 * recusar quando a gente dispara pedido em paralelo — foi o que já aconteceu buscando
 * capítulo e quadro juntos pros 6 vídeos. Uma varredura leva uns 10 min e roda por baixo:
 * nenhuma janela é tocada e ele pode usar o app normalmente enquanto isso.
 */
export async function guardarAgente({ agente, chaveYoutube = null, refazer = false } = {}) {
  if (varredura.rodando) return { ...varredura, aviso: 'já tem uma varredura rodando' };
  const cat = await catalogo();
  if (!cat.agentes?.some((a) => a.nome === agente)) throw new Error('agente desconhecido');
  const fila = [];
  for (const m of cat.mapas) for (const lado of ['atacando', 'defendendo']) fila.push({ mapa: m.nome, agente, lado });
  Object.assign(varredura, { rodando: true, agente, feitos: 0, total: fila.length, agora: null, novas: 0, vazias: 0, em: Date.now() });

  (async () => {
    for (const item of fila) {
      varredura.agora = `${item.mapa} · ${item.lado === 'atacando' ? 'atacante' : 'defensor'}`;
      try {
        // o que já está guardado e cheio não se procura de novo: a cota do YouTube é finita.
        // O que está guardado mas magro (salvo quando a busca lia 6 vídeos) vale refazer.
        const tem = await buscaGuardada(item);
        if (!refazer && tem && !tem.velho) { varredura.feitos++; continue; }
        const r = await buscarLineups({ ...item, chaveYoutube });
        if (r.lineups?.length) { await guardarBusca(item, r); varredura.novas += r.lineups.length; }
        else varredura.vazias++;
      } catch { varredura.vazias++; }
      varredura.feitos++;
      await new Promise((ok) => setTimeout(ok, 1200));    // respiro entre uma busca e outra
    }
    Object.assign(varredura, { rodando: false, agora: null });
  })();

  return { ...varredura };
}

/** A mesma busca, pra abrir no navegador quando nada funcionar. */
export const linkYoutube = (termo) => `https://www.youtube.com/results?search_query=${encodeURIComponent(termo)}`;

/** A biblioteca do strats.gg, filtrada — sem copiar nada deles. */
export function linkStrats({ mapa, agente } = {}) {
  const parte = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const q = new URLSearchParams();
  if (mapa) q.set('map', parte(mapa));
  if (agente) q.set('agent', parte(agente));
  return `https://strats.gg/valorant/lineups${q.toString() ? `?${q}` : ''}`;
}

/* ------------------------------------------------------------------ as dele */

const limpar = (s, max) => String(s ?? '').trim().slice(0, max);

/** Lineups que ele salvou, mais novas primeiro. */
export async function salvas() {
  const l = await lerJson(arqSalvas(), []);
  return Array.isArray(l) ? l : [];
}

/**
 * Salva (ou atualiza, se o id já existir). `pula` é o único campo de instrução que ele
 * pediu: "tem q avisar se tem q pular ou n, só isso".
 */
export async function salvar(entrada = {}) {
  const lista = await salvas();
  const id = limpar(entrada.id, 40) || `ln${Date.now().toString(36)}`;
  const nova = {
    id,
    video: limpar(entrada.video, 20),               // id do vídeo no YouTube
    titulo: limpar(entrada.titulo, 200),
    canal: limpar(entrada.canal, 100),
    capa: limpar(entrada.capa, 400),
    segundo: Math.max(0, Math.round(Number(entrada.segundo) || 0)),   // onde a lineup começa
    fim: Math.max(0, Math.round(Number(entrada.fim) || 0)) || null,   // e onde acaba, pra tocar só o clipe
    mapa: limpar(entrada.mapa, 40),
    agente: limpar(entrada.agente, 40),
    habilidade: limpar(entrada.habilidade, 60),
    ponto: limpar(entrada.ponto, 60),          // onde a lineup CAI ("A Lobby")
    posicao: limpar(entrada.posicao, 60),      // de onde se joga, quando dá pra saber
    mira: Number.isFinite(Number(entrada.mira)) ? Math.max(0, Math.round(Number(entrada.mira))) : null,   // o segundo em que a mira aparece
    lado: ['atacando', 'defendendo'].includes(entrada.lado) ? entrada.lado : null,
    pula: entrada.pula === true ? true : entrada.pula === false ? false : null,   // null = ninguém disse ainda
    nota: limpar(entrada.nota, 300),
    em: Date.now(),
  };
  if (!nova.video) throw new Error('lineup sem vídeo');
  if (!nova.mapa || !nova.agente) throw new Error('lineup precisa de mapa e agente');
  // Duas lineups são a mesma quando são o mesmo vídeo no mesmo segundo — salvar de novo
  // atualiza (ex.: ele descobriu que pula), não duplica. Sem isso, clicar salvar duas
  // vezes enchia a lista de linhas idênticas.
  const i = lista.findIndex((x) => x.id === id || (x.video === nova.video && x.segundo === nova.segundo));
  if (i >= 0) lista[i] = { ...lista[i], ...nova, id: lista[i].id }; else lista.unshift(nova);
  await gravarJson(arqSalvas(), lista);
  return nova;
}

export async function apagar(id) {
  const lista = await salvas();
  const fora = lista.filter((x) => x.id !== id);
  await gravarJson(arqSalvas(), fora);
  return { apagadas: lista.length - fora.length };
}
