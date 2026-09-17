import { buildsDoCampeao } from '../dados/builds.js';
import { elencoCompleto } from '../dados/ddragon.js';

/**
 * Conjuntos de itens dentro do client — os que aparecem na loja, durante a
 * partida, na aba de builds recomendadas.
 *
 * O client guarda TODOS os conjuntos da conta num único documento, e o PUT
 * substitui o documento inteiro. Então a regra é a mesma das runas: ler o que
 * existe, **manter tudo o que não é nosso**, trocar só os conjuntos
 * "LolCoach · …" e gravar de volta. Conjunto que o Gabriel montou à mão nunca
 * é tocado.
 *
 * Um conjunto por campeão por role, com blocos: início, botas, os 3 cores mais
 * jogados (com taxa no título do bloco) e os itens finais.
 */

export const PREFIXO = 'LolCoach · ';
const MAPA_SR = 11;

const bloco = (titulo, itens) => ({
  type: titulo,
  items: itens.map((it) => ({ id: String(it.id), count: 1 })),
  hideIfSummonerSpell: '',
  showIfSummonerSpell: '',
});

/** Monta o conjunto de um campeão numa role a partir da build do op.gg. */
export function montarConjunto(build, championId) {
  const it = build.itens;
  const blocos = [];

  if (it.iniciais[0]) blocos.push(bloco(`Início (${it.iniciais[0].taxa}% · ${it.iniciais[0].jogos} jogos)`, it.iniciais[0].itens));
  if (it.botas.length) blocos.push(bloco('Botas', it.botas.map((b) => b.item)));
  it.principais.forEach((c, i) => blocos.push(bloco(`Core ${i + 1} (${c.taxa}% · ${c.jogos} jogos)`, c.itens)));
  if (it.finais.length) blocos.push(bloco('Finais — 4º, 5º, 6º', it.finais.map((f) => f.item)));

  return {
    uid: `lolcoach-${championId}-${build.role}`,
    title: `${PREFIXO}${build.campeao ?? ''} ${build.roleNome}`.replace(/\s+/g, ' '),
    type: 'custom',
    map: 'any',
    mode: 'any',
    associatedChampions: [championId],
    associatedMaps: [MAPA_SR],
    blocks: blocos,
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: 'blank',
  };
}

const ehNosso = (s) => String(s?.title ?? '').startsWith(PREFIXO) || String(s?.uid ?? '').startsWith('lolcoach-');

/**
 * Grava os conjuntos no client, preservando os que não são nossos.
 * `conjuntos` substitui os nossos de mesmo uid; os outros nossos ficam.
 */
export async function gravarConjuntos(lcu, conjuntos, { limparNossos = false } = {}) {
  const eu = await lcu.get('/lol-summoner/v1/current-summoner');
  const caminho = `/lol-item-sets/v1/item-sets/${eu.summonerId}/sets`;
  const atual = await lcu.get(caminho).catch(() => null) ?? { itemSets: [] };

  const novosPorUid = new Map(conjuntos.map((c) => [c.uid, c]));
  // `limparNossos`: começo de uma carga completa — os nossos antigos saem
  // todos (o documento tem limite de tamanho no client); os dele ficam sempre.
  const mantidos = (atual.itemSets ?? []).filter((s) => !ehNosso(s) || (!limparNossos && !novosPorUid.has(s.uid)));
  const itemSets = [...mantidos, ...conjuntos];

  await lcu.put(caminho, {
    accountId: atual.accountId ?? eu.accountId ?? 0,
    itemSets,
    timestamp: Date.now(),
  });

  return {
    gravados: conjuntos.length,
    preservados: mantidos.filter((s) => !ehNosso(s)).length,
    total: itemSets.length,
  };
}

/** Um campeão numa role (a principal, se `role` for null). */
export async function aplicarConjunto(lcu, nome, championId, role = null, opcoes = {}) {
  const build = await buildsDoCampeao(nome, role, opcoes);
  const conjunto = montarConjunto({ ...build, campeao: build.campeao ?? nome }, championId);
  await gravarConjuntos(lcu, [conjunto]);
  // confere: o client às vezes engole o PUT em silêncio; se o nosso conjunto pra ESTE campeão não está lá, grava de novo
  await new Promise((r) => setTimeout(r, 2500));
  const eu = await lcu.get('/lol-summoner/v1/current-summoner');
  const atual = await lcu.get(`/lol-item-sets/v1/item-sets/${eu.summonerId}/sets`).catch(() => null);
  const tem = (atual?.itemSets ?? []).some((s) => s.uid === conjunto.uid && (s.associatedChampions ?? []).includes(championId));
  if (!tem) { await gravarConjuntos(lcu, [conjunto]); }
  return { campeao: nome, role: build.roleNome, blocos: conjunto.blocks.length, conferido: tem, core: (build.itens?.principais?.[0]?.itens ?? []).join(',') };
}

/**
 * Todos os campeões, na role principal de cada um; os que ele joga, em todas
 * as roles em que os joga. Sequencial com pausa: são ~200 chamadas ao op.gg,
 * e o que evita bloqueio é não fazê-las em rajada. Grava no client em lotes
 * pra um erro no meio não perder o que já foi montado.
 *
 * `rolesDele`: Map(championId -> ['jungle','mid']) das roles que ele joga.
 */
export async function aplicarConjuntosDeTodos(lcu, { rolesDele = new Map(), apenas = null, pausaMs = 450, aoProgresso, opcoes = {}, podeContinuar = () => true } = {}) {
  // `apenas`: Set de championId. O client recusa o documento quando passa de
  // umas centenas de conjuntos (HTTP 413) — então só os campeões que importam.
  const elenco = (await elencoCompleto()).filter((c) => !apenas || apenas.has(c.id));
  const total = elenco.length;
  const conjuntos = [];
  let feitos = 0, falhas = 0, primeiraGravacao = true;
  const gravar = async (lote) => {
    const r = await gravarConjuntos(lcu, lote, { limparNossos: primeiraGravacao });
    primeiraGravacao = false;
    return r;
  };

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const c of elenco) {
    // Partida começou no meio: espera. Não é por causa do jogo (isto é só
    // rede), é pra não disputar banda e CPU com ele.
    while (!podeContinuar()) await dormir(5_000);

    const roles = rolesDele.get(c.id) ?? [null];
    for (const role of roles) {
      try {
        const build = await buildsDoCampeao(c.nome, role, opcoes);
        conjuntos.push(montarConjunto(build, c.id));
      } catch (erro) {
        falhas++;
        // 429 = o op.gg pediu calma. Espera de verdade antes de seguir.
        if (/429/.test(erro.message)) await dormir(15_000);
      }
      await dormir(pausaMs);
    }
    feitos++;
    aoProgresso?.({ feitos, total, campeao: c.nome, conjuntos: conjuntos.length, falhas });

    // Lote a cada 25 campeões: se cair no meio, o que já foi fica no client.
    if (feitos % 25 === 0) await gravar(conjuntos.splice(0)).catch(() => {});
  }

  const r = conjuntos.length ? await gravar(conjuntos) : { gravados: 0 };
  return { campeoes: feitos, falhas, ...r };
}
