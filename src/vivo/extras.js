import { buildsDoCampeao } from '../dados/builds.js';
import { classesDosCampeoes } from '../dados/ddragon.js';
import { RiotApi } from '../dados/riot.js';

/**
 * O que a voz precisa saber uma vez por partida e não vem da API do jogo:
 *  - a build do seu campeão (op.gg) pra dizer "X fechado, próximo é Y";
 *  - de que tipo de dano é o time deles (armadura ou resistência mágica);
 *  - quem deles está de main (maestria pela API da Riot, com a chave que já
 *    vai no app) — "Cassiopeia é main dela, fica esperto".
 * Tudo em segundo plano; a partida não espera por nada disto.
 */

// Campeões que batem de AP mesmo sem a tag Mage.
const AP_FORA_DA_TAG = new Set(['Katarina', 'Akali', 'Ekko', 'Fizz', 'Diana', 'Kayle', 'Gwen', 'Mordekaiser', 'Rumble', 'Singed', 'Vladimir', 'Sylas', 'Elise', 'Nidalee', 'Evelynn', 'Fiddlesticks', 'Amumu', 'Gragas', 'Kennen', 'Teemo', "Cho'Gath", 'Shyvana', 'Lillia', 'Zac', 'Maokai', 'Galio', 'Nunu & Willump', 'Malphite', 'Rakan', 'Zoe', 'Neeko', 'Ahri', 'Aurora', 'Hwei', 'Smolder', 'Karma', 'Lulu', 'Nami', 'Janna', 'Sona', 'Soraka', 'Seraphine', 'Yuumi', 'Milio', 'Zilean', 'Morgana', 'Lux', 'Zyra', 'Brand', 'Vel\'Koz', 'Xerath', 'Ziggs', 'Anivia', 'Annie', 'Aurelion Sol', 'Azir', 'Cassiopeia', 'Heimerdinger', 'Karthus', 'Kassadin', 'LeBlanc', 'Lissandra', 'Malzahar', 'Orianna', 'Ryze', 'Swain', 'Syndra', 'Taliyah', 'Twisted Fate', 'Veigar', 'Viktor', 'Vex', 'Kog\'Maw']);

export async function perfilDeDano(inimigos) {
  const classes = await classesDosCampeoes().catch(() => new Map());
  let ap = 0, ad = 0;
  for (const j of inimigos) {
    const tags = classes.get(j.campeao) ?? [];
    if (AP_FORA_DA_TAG.has(j.campeao) || tags.includes('Mage')) ap++; else ad++;
  }
  return { ap, ad };
}

/** Itens principais da sua build (ids, nomes, preço), na ordem do op.gg. */
export async function buildDaPartida(campeao, role, opcoes) {
  try {
    const b = await buildsDoCampeao(campeao, role, opcoes);
    const principais = b.itens?.principais?.[0]?.itens ?? [];
    const botas = b.itens?.botas?.[0]?.item ?? null;
    const finais = (b.itens?.finais ?? []).map((f) => f.item).filter(Boolean).slice(0, 3);
    return { principais, botas, finais, ordem: [...principais, ...(botas ? [botas] : []), ...finais] };
  } catch { return null; }
}

/**
 * Maestria dos inimigos no campeão que estão jogando. 2 chamadas por
 * inimigo; só pra quem interessa (sua lane e o jungler) pra não gastar chave.
 */
export async function mainsDosInimigos(riotConfig, inimigos, tabela) {
  if (!riotConfig?.apiKey) return [];
  const riot = new RiotApi(riotConfig);
  const saida = [];
  for (const j of inimigos) {
    try {
      const [nome, tag] = String(j.nome).split('#');
      if (!nome || !tag) continue;
      const conta = await riot.contaPorRiotId(nome, tag);
      if (!conta?.puuid) continue;
      const id = tabela?.porNome?.get(String(j.campeao).toLowerCase());
      if (!id) continue;
      const m = await riot.maestriaDoCampeao(conta.puuid, id);
      saida.push({ nome: j.nome, campeao: j.campeao, role: j.role, pontos: m?.championPoints ?? 0, nivel: m?.championLevel ?? 0 });
    } catch { /* um a menos */ }
  }
  return saida;
}
