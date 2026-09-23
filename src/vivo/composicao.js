/**
 * Leitura de composição na seleção: o buraco do time, dito antes do jogo começar.
 *
 * Partida se ganha e se perde no draft com mais frequência do que se admite. O que
 * dá pra ver sem adivinhar nada: de onde vem o dano (tudo AD morre pro primeiro
 * item de armadura), quem segura a frente, quem começa a briga e quem tira o carry
 * de cima. Só sai aviso quando o time está REALMENTE torto — dizer "faltou um
 * pouco de CC" em toda partida não serve pra nada.
 */

// Quem entra na briga sozinho e trava alguém. Lista curta e na mão: tag do Data
// Dragon não distingue engage de tank passivo (Sion entra, Ornn entra, Malphite
// entra; Sejuani entra, Tahm não entra).
const ENGAGE = new Set(['Leona', 'Nautilus', 'Rell', 'Alistar', 'Thresh', 'Blitzcrank', 'Pyke', 'Rakan', 'Maokai', 'Pantheon', 'Poppy', 'Galio', 'Shen', 'Nunu & Willump', 'Nunu', 'Sejuani', 'Zac', 'Amumu', 'Malphite', 'Ornn', 'Sion', 'Gragas', 'Vi', 'Jarvan IV', 'Hecarim', 'Wukong', 'MonkeyKing', 'Diana', 'Lissandra', 'Ekko', 'Kennen', 'Yasuo', 'Yone', 'Camille', 'Urgot', 'Rammus', 'Volibear', 'Warwick', 'Skarner', 'Neeko', 'Nocturne', 'Xin Zhao', 'Jax', 'Riven', 'Irelia', 'Gwen', 'Briar', 'Ambessa', "K'Sante", 'KSante', 'Rengar', 'Kled']);

// CC que tira o turno do inimigo (atordoar, prender, empurrar, virar). Poke e
// lentidão não contam — o que interessa é quem impede a resposta.
const CC_DURO = new Set([...ENGAGE, 'Morgana', 'Lux', 'Ashe', 'Varus', 'Veigar', 'Swain', 'Syndra', 'Annie', 'Twisted Fate', 'TwistedFate', 'Zoe', 'Ahri', 'Cassiopeia', 'Anivia', 'Taric', 'Braum', 'Nami', 'Seraphine', 'Sona', 'Bard', 'Zilean', 'Lulu', 'Janna', 'Renata Glasc', 'Renata', 'Milio', 'Elise', 'Trundle', 'Ivern', 'Maokai', 'Cho\'Gath', 'Chogath', 'Singed', 'Sett', 'Darius', 'Garen', 'Nasus', 'Illaoi', 'Fiora', 'Mordekaiser', 'Aatrox', 'Kalista', 'Senna', 'Jhin', 'Caitlyn']);

// Quem tira o carry de cima (escudo, cura, purificar, empurrar o inimigo).
const PEEL = new Set(['Lulu', 'Janna', 'Milio', 'Renata Glasc', 'Renata', 'Nami', 'Soraka', 'Taric', 'Braum', 'Karma', 'Seraphine', 'Yuumi', 'Sona', 'Alistar', 'Thresh', 'Poppy', 'Shen', 'Zilean', 'Ivern', 'Bard', 'Tahm Kench', 'TahmKench', 'Morgana', 'Rakan', 'Maokai']);

const forcaDeFrente = (tags = []) => (tags.includes('Tank') ? 1 : tags.includes('Fighter') && !tags.includes('Assassin') ? 0.5 : 0);

const chave = (n) => String(n ?? '').replace(/[^a-zA-Z]/g, '').toLowerCase();
const temNaLista = (lista, nome) => [...lista].some((x) => chave(x) === chave(nome));

/** Retrato de um time: de onde vem o dano, quem segura, quem entra, quem protege. */
export function retratoDoTime(nomes, perfis = new Map()) {
  const dano = { ad: 0, ap: 0, misto: 0 };
  let frente = 0;
  const engage = [], peel = [], cc = [];
  for (const n of nomes) {
    if (!n) continue;
    const p = perfis.get(n) ?? perfis.get(chave(n)) ?? null;
    if (p?.dano) dano[p.dano] = (dano[p.dano] ?? 0) + 1;
    frente += forcaDeFrente(p?.tags ?? []);
    if (temNaLista(ENGAGE, n)) engage.push(n);
    if (temNaLista(PEEL, n)) peel.push(n);
    if (temNaLista(CC_DURO, n)) cc.push(n);
  }
  return { n: nomes.filter(Boolean).length, dano, frente, engage, peel, cc };
}

/**
 * Os avisos que valem a pena. `nossos` e `deles` são listas de nomes de campeão
 * (o que já foi escolhido). Devolve no máximo 3, do mais caro pro menos.
 */
export function avisosDeComposicao({ nossos = [], deles = [], perfis = new Map(), minhaRole = null } = {}) {
  const A = retratoDoTime(nossos, perfis), B = retratoDoTime(deles, perfis);
  const avisos = [];
  const completo = A.n >= 4;

  // dano de um tipo só: o item certo do outro lado apaga metade do time
  if (completo) {
    const total = A.dano.ad + A.dano.ap + A.dano.misto;
    if (total >= 4 && A.dano.ap === 0 && A.dano.ad >= 3) avisos.push({ peso: 100, chave: 'so-ad', texto: 'Dano do seu time é todo físico. Uma Malha Espinhosa ou uma Placa do Morto do lado deles vale por dois itens — se der pra pegar dano mágico, pega.' });
    else if (total >= 4 && A.dano.ad === 0 && A.dano.ap >= 3) avisos.push({ peso: 100, chave: 'so-ap', texto: 'Dano do seu time é todo mágico. Um Manto de Espinhos deles resolve metade do seu time — vale um pick de dano físico.' });
  }

  // ninguém segura a frente
  if (completo && A.frente < 1) avisos.push({ peso: 90, chave: 'sem-frente', texto: 'Ninguém segura a frente no seu time. Sem tank, a briga começa em cima dos carries — joga agrupado e não aceita luta sem visão.' });

  // eles entram e vocês não têm quem tire de cima
  if (B.engage.length >= 2 && A.peel.length === 0 && (minhaRole === 'sup' || A.n >= 4)) {
    avisos.push({ peso: 85, chave: 'sem-peel', texto: `${B.engage.slice(0, 2).join(' e ')} entram na hora que quiserem e o seu time não tem quem tire de cima. ${minhaRole === 'sup' ? 'Um sup de escudo ou purificar resolve isso.' : 'Fica atrás do teu sup e não caminha sozinho.'}` });
  }

  // ninguém começa a briga do nosso lado
  if (completo && A.engage.length === 0) avisos.push({ peso: 80, chave: 'sem-engage', texto: 'Ninguém do seu time começa briga. Sem entrada, objetivo só sai com pick ou com eles errando — joga em cima da visão e não force 5v5.' });

  // CC quase zero
  if (completo && A.cc.length <= 1) avisos.push({ peso: 70, chave: 'sem-cc', texto: 'Quase nada de CC duro do seu lado: quem entrar no seu carry vai sair vivo. Vale um pick com atordoamento ou prisão.' });

  // eles sem frente: a vantagem é sua
  if (B.n >= 4 && B.frente < 1) avisos.push({ peso: 60, chave: 'deles-sem-frente', texto: 'O time deles não tem frente. Qualquer entrada certa ganha a briga — e o jogo deles é evitar 5v5.' });

  return avisos.sort((a, b) => b.peso - a.peso).slice(0, 3);
}
