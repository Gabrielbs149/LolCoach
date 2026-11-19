/**
 * O que está acontecendo no CS2 agora, pela Game State Integration da Valve.
 *
 * O jogo é que fala com a gente: um `.cfg` na pasta dele manda o CS mandar JSON pro
 * servidor do app a cada mudança. Canal oficial, documentado, e nada é lido da memória do
 * jogo nem desenhado por cima dele.
 *
 * MEDIDO no CS2 dele, com ele dentro de um mapa (18/11/2026). O que um cliente NORMAL
 * recebe:
 *   blocos: provider, map, round, player
 *   player: steamid, name, observer_slot, team ("T"), activity ("playing"),
 *           state { health, armor, flashed, smoked, burning, money, ... },
 *           weapons { ..., weapon_smokegrenade: { type: "Grenade", state: "active" } }
 *   map: { name: "miragelinups", mode: "casual", phase: "live" }
 *
 * E o que NÃO vem, por mais que o `.cfg` peça: **`player_position` e `allgrenades`**. Os
 * dois são só pra cliente espectador/GOTV. Foi por isso que a ideia de gravar a lineup
 * sozinho (ver de onde ele jogou e onde a granada parou) morreu — está medido, não suposto.
 *
 * O que sobrou é melhor do que parecia: o jogo diz o MAPA, o LADO e **qual granada está na
 * mão dele agora**. Com isso a tela de lineups segue o jogo sozinha, sem um clique.
 */

/* T planta, CT defende. Aqui não há convenção pra adivinhar, ao contrário do Valorant,
 * onde o lado sai do time mais a rodada e a regra "Blue ataca primeiro" é leitura minha. */
const LADO = { T: 'atacando', CT: 'defendendo' };

/* A arma na mão vira o filtro de utilitário da tela. Decoy fica de fora de propósito:
 * ninguém guarda lineup de decoy, e trocar o filtro pra algo vazio seria pior que não
 * trocar. Incendiária e molotov são a mesma lineup — muda só o lado que compra. */
const UTIL = {
  weapon_smokegrenade: 'Smoke',
  weapon_flashbang: 'Flash',
  weapon_molotov: 'Molotov',
  weapon_incgrenade: 'Molotov',
  weapon_hegrenade: 'HE',
};

/** O mapa interno ("de_mirage") vira o nome da tela ("Mirage"). */
export function mapaDoCs(nome, mapas) {
  const id = String(nome ?? '').toLowerCase();
  if (!id) return null;
  const achado = (mapas ?? []).find((m) => m.id === id);
  if (achado) return achado.nome;
  /* Mapa de workshop ("miragelinups", "yprac_mirage") não é o mapa oficial, mas é onde ele
   * TREINA lineup — é justamente ali que a tela tem que acompanhar. Então, se o nome do
   * mapa contém o nome de um mapa de verdade, vale. */
  const porDentro = (mapas ?? []).find((m) => id.includes(m.id.replace(/^de_/, '')));
  return porDentro?.nome ?? null;
}

/** A granada que está na mão. `null` quando ele está com arma, faca ou nada. */
export function utilitarioNaMao(weapons) {
  for (const w of Object.values(weapons ?? {})) {
    if (w?.state !== 'active') continue;
    return UTIL[w.name] ?? null;
  }
  return null;
}

/**
 * Traduz um pacote da GSI pro que a tela precisa. Devolve sempre um objeto; fora de
 * partida vem tudo nulo com `ligado: false`, que é o mesmo contrato da situação do Valorant.
 */
export function lerPacote(j, mapas) {
  const p = j?.player ?? null;
  const dentro = p?.activity === 'playing' && !!j?.map?.name;
  if (!dentro) {
    return { ligado: !!p, estado: p?.activity ?? null, mapa: null, lado: null, utilitario: null, fase: null };
  }
  return {
    ligado: true,
    estado: 'jogando',
    mapa: mapaDoCs(j.map.name, mapas),
    mapaCru: j.map.name,
    lado: LADO[p.team] ?? null,
    utilitario: utilitarioNaMao(p.weapons),
    fase: j.round?.phase ?? j.map?.phase ?? null,
  };
}

/* O último pacote, e quando chegou. Sem notícia recente o jogo está fechado: o CS não
 * avisa que saiu, ele simplesmente para de mandar. 90 s porque o `heartbeat` do .cfg é de
 * 30 s — três batidas perdidas é desligado, uma só seria falso alarme em qualquer engasgo. */
const VALIDADE = 90_000;
let ultimo = null;

export function guardarPacote(j, mapas) {
  const s = lerPacote(j, mapas);
  ultimo = { ...s, em: Date.now() };
  return ultimo;
}

export function situacaoDoCs() {
  if (!ultimo || Date.now() - ultimo.em > VALIDADE) {
    return { ligado: false, estado: null, mapa: null, lado: null, utilitario: null, fase: null };
  }
  return ultimo;
}

/** só pros testes */
export function esquecerCs() { ultimo = null; }
