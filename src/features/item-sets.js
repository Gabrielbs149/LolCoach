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
    title: `${PREFIXO}${build.roleNome}`,
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
export async function gravarConjuntos(lcu, conjuntos) {
  const eu = await lcu.get('/lol-summoner/v1/current-summoner');
  const caminho = `/lol-item-sets/v1/item-sets/${eu.summonerId}/sets`;
  const atual = await lcu.get(caminho).catch(() => null) ?? { itemSets: [] };

  const novosPorUid = new Map(conjuntos.map((c) => [c.uid, c]));
  const mantidos = (atual.itemSets ?? []).filter((s) => !ehNosso(s) || !novosPorUid.has(s.uid));
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
  const conjunto = montarConjunto(build, championId);
  await gravarConjuntos(lcu, [conjunto]);
  return { campeao: nome, role: build.roleNome, blocos: conjunto.blocks.length };
}

/**
 * Todos os campeões, na role principal de cada um; os que ele joga, em todas
 * as roles em que os joga. Sequencial com pausa: são ~200 chamadas ao op.gg,
 * e o que evita bloqueio é não fazê-las em rajada. Grava no client em lotes
 * pra um erro no meio não perder o que já foi montado.
 *
 * `rolesDele`: Map(championId -> ['jungle','mid']) das roles que ele joga.
 */
export async function aplicarConjuntosDeTodos(lcu, { rolesDele = new Map(), pausaMs = 450, aoProgresso, opcoes = {}, podeContinuar = () => true } = {}) {
  const elenco = await elencoCompleto();
  const total = elenco.length;
  const conjuntos = [];
  let feitos = 0, falhas = 0;

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
    if (feitos % 25 === 0) await gravarConjuntos(lcu, conjuntos.splice(0)).catch(() => {});
  }

  const r = conjuntos.length ? await gravarConjuntos(lcu, conjuntos) : { gravados: 0 };
  return { campeoes: feitos, falhas, ...r };
}
