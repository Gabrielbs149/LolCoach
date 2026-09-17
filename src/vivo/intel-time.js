/**
 * Intel do time deles na seleção: o que dá pra saber de cada campeão que eles
 * travaram, antes de saber quem são as pessoas (a ranqueada esconde os nomes
 * até a tela de carregamento).
 *
 * Por campeão: rota provável, tipo de dano, classe, CC pesado, se é ameaça
 * direta pra sua rota, o seu histórico contra ele (banco) e uma dica oficial
 * de como jogar contra. Do time: dano AD/AP, engage, CC (Purificar/Mercúrio),
 * poke, tanques, assassinos, quem escala e quem é forte no early.
 */
const ENGAGE = new Set(['Leona', 'Nautilus', 'Rell', 'Alistar', 'Thresh', 'Blitzcrank', 'Pyke', 'Rakan', 'Braum', 'Maokai', 'Malphite', 'Amumu', 'Sejuani', 'Jarvan IV', 'Hecarim', 'Wukong', 'Zac', 'Vi', 'Nocturne', 'Kennen', 'Gragas', 'Galio', 'Ornn', 'Sion', 'Skarner', 'Rammus', 'Diana', 'Kayn', 'Lee Sin', 'Camille', 'Poppy', 'Shen', 'Nunu & Willump', 'Volibear', 'Warwick', 'Xin Zhao', 'Pantheon', 'Renekton', 'Sett', 'Jax', 'Irelia', 'Yone', 'Ambessa', 'Briar']);
const ASSASSINOS = new Set(['Zed', 'Talon', "Kha'Zix", 'Rengar', 'Nocturne', 'Kayn', 'Fizz', 'Akali', 'Katarina', 'Qiyana', 'Evelynn', 'Shaco', 'Ekko', 'Diana', 'Naafiri', 'Briar', 'Pyke', 'Master Yi', 'Kassadin', 'LeBlanc', 'Sylas', 'Ambessa', 'Nilah', 'Samira', 'Yasuo', 'Yone', 'Tryndamere']);
const POKE = new Set(['Xerath', 'Zoe', 'Lux', 'Ziggs', "Vel'Koz", 'Jayce', 'Varus', 'Ezreal', 'Caitlyn', 'Jhin', 'Karma', 'Zyra', 'Brand', 'Nidalee', 'Corki', 'Hwei', 'Syndra', 'Ahri', 'Seraphine', 'Senna', 'Ashe', 'Kog\'Maw', 'Aurelion Sol', 'Viktor', 'Anivia', 'Swain', 'Vex', 'Mel']);
const TANQUES = new Set(['Ornn', 'Malphite', 'Sion', 'Maokai', 'Shen', 'Sejuani', 'Zac', 'Rammus', 'Amumu', 'Nautilus', 'Leona', 'Braum', 'Tahm Kench', "Cho'Gath", 'Dr. Mundo', 'Nunu & Willump', 'Galio', 'Poppy', 'Alistar', 'Rell', 'Skarner', 'Udyr', "K'Sante", 'Gragas', 'Volibear', 'Illaoi', 'Mordekaiser', 'Nasus', 'Singed', 'Taric', 'Zilean']);
const ESCALA = new Set(['Kayle', 'Kassadin', 'Veigar', 'Vayne', "Kog'Maw", 'Jinx', 'Nasus', 'Senna', 'Smolder', 'Sona', 'Twitch', 'Aphelios', 'Zeri', 'Aurelion Sol', 'Karthus', 'Viktor', 'Ryze', 'Cassiopeia', 'Azir', "Cho'Gath", 'Kindred', 'Master Yi', 'Yuumi', 'Seraphine', 'Ornn', 'Sion', 'Yunara', 'Gangplank', 'Vladimir', 'Syndra', 'Gwen', 'Jax', 'Yasuo', 'Yone']);
const EARLY = new Set(['Draven', 'Lucian', 'Caitlyn', 'Pantheon', 'Renekton', 'Darius', 'Lee Sin', 'Elise', 'Xin Zhao', 'Jarvan IV', 'Rengar', 'Nidalee', 'Leona', 'Blitzcrank', 'Nautilus', 'Pyke', 'Talon', 'Qiyana', 'LeBlanc', 'Zed', 'Irelia', 'Riven', 'Olaf', 'Volibear', 'Warwick', 'Briar', 'Naafiri', 'Ambessa', 'Kled', 'Rell', 'Samira', 'Tristana', 'Kalista', 'Miss Fortune', 'Rakan']);
const MUITO_CC = new Set(['Morgana', 'Malzahar', 'Leona', 'Nautilus', 'Ashe', 'Lissandra', 'Sejuani', 'Amumu', 'Skarner', 'Warwick', 'Rammus', 'Thresh', 'Blitzcrank', 'Zoe', 'Neeko', 'Twisted Fate', 'Veigar', 'Annie', 'Fiddlesticks', 'Maokai', 'Zyra', 'Lux', 'Pyke', 'Rell', 'Alistar', 'Braum', 'Galio', 'Gragas', 'Jarvan IV', 'Kennen', 'Malphite', 'Nami', 'Ornn', 'Poppy', 'Sion', 'Swain', 'Taric', 'Vi', 'Zac', 'Cassiopeia', 'Anivia', 'Jax', 'Renata Glasc', 'Seraphine', 'Sona', 'Lulu', 'Janna', 'Milio', 'Bard', 'Ivern', 'Nunu & Willump', 'Xin Zhao', 'Camille', 'Hecarim', 'Wukong', 'Diana', 'Kayn', 'Nocturne', 'Yone', 'Yasuo', 'Ahri', 'Syndra', 'Vex', 'Hwei', 'Zilean', 'Aurora', 'Mel']);
const SUPS = new Set(['Leona', 'Nautilus', 'Rell', 'Alistar', 'Thresh', 'Blitzcrank', 'Pyke', 'Rakan', 'Braum', 'Maokai', 'Taric', 'Lulu', 'Yuumi', 'Nami', 'Janna', 'Soraka', 'Milio', 'Karma', 'Sona', 'Renata Glasc', 'Seraphine', 'Lux', 'Morgana', 'Xerath', 'Zyra', 'Brand', "Vel'Koz", 'Swain', 'Neeko', 'Zilean', 'Senna', 'Bard', 'Tahm Kench', 'Poppy', 'Pantheon', 'Shaco', 'Hwei', 'Mel', 'Heimerdinger', 'Zoe', 'Ashe']);
const ADCS = new Set(['Jinx', 'Caitlyn', "Kai'Sa", 'Ezreal', 'Jhin', 'Lucian', 'Samira', 'Vayne', 'Xayah', 'Draven', 'Tristana', 'Ashe', 'Varus', 'Miss Fortune', 'Aphelios', "Kog'Maw", 'Twitch', 'Zeri', 'Nilah', 'Kalista', 'Sivir', 'Smolder', 'Yunara', 'Senna', 'Ziggs', 'Corki', 'Kindred']);
const JUNGLERS = new Set(['Lee Sin', 'Elise', 'Xin Zhao', 'Jarvan IV', 'Nunu & Willump', 'Warwick', 'Shaco', 'Briar', "Kha'Zix", 'Rengar', 'Nidalee', 'Viego', 'Graves', 'Kindred', 'Kayn', 'Master Yi', 'Karthus', 'Amumu', 'Fiddlesticks', 'Lillia', 'Hecarim', 'Vi', 'Evelynn', 'Zac', 'Sejuani', 'Diana', 'Ekko', 'Volibear', 'Skarner', 'Udyr', 'Wukong', "Rek'Sai", 'Ivern', 'Taliyah', 'Naafiri', 'Nocturne', 'Rammus', 'Maokai', "Bel'Veth", 'Shyvana', 'Olaf', 'Trundle']);
// quem joga em duas rotas: a rota principal primeiro
const PRIMARIA = { Zed: 'mid', Talon: 'mid', Sylas: 'mid', Gwen: 'top', Jax: 'top', Zyra: 'sup', Brand: 'sup', Gragas: 'jungle', Poppy: 'jungle', Pantheon: 'sup', Ashe: 'adc', Senna: 'sup', Seraphine: 'sup', Swain: 'sup', Lux: 'sup', Morgana: 'sup', Karma: 'sup', Yasuo: 'mid', Yone: 'mid', Akali: 'mid', Irelia: 'top', Camille: 'top', Diana: 'jungle', Ekko: 'jungle', Nocturne: 'jungle', Kayn: 'jungle', Tristana: 'adc', Corki: 'adc', Ziggs: 'adc', Vayne: 'adc', Kindred: 'jungle', Shaco: 'jungle', Maokai: 'sup', Taric: 'sup', Rell: 'sup', Nautilus: 'sup', Leona: 'sup', Malphite: 'top', Volibear: 'jungle', Warwick: 'jungle', Wukong: 'jungle', Skarner: 'jungle', Udyr: 'jungle', 'Nunu & Willump': 'jungle', Zac: 'jungle', Sejuani: 'jungle', Amumu: 'jungle', 'Xin Zhao': 'jungle', 'Jarvan IV': 'jungle', 'Lee Sin': 'jungle', Hecarim: 'jungle', Vi: 'jungle', Rammus: 'jungle', Naafiri: 'jungle', Briar: 'jungle', Fizz: 'mid', Katarina: 'mid', Qiyana: 'mid', Kassadin: 'mid', LeBlanc: 'mid', Ambessa: 'top', Nilah: 'adc', Samira: 'adc', Pyke: 'sup', Bard: 'sup', Thresh: 'sup', Blitzcrank: 'sup', Alistar: 'sup', Braum: 'sup', Rakan: 'sup', 'Tahm Kench': 'sup', Milio: 'sup', Yuumi: 'sup', Lulu: 'sup', Nami: 'sup', Janna: 'sup', Soraka: 'sup', Sona: 'sup', 'Renata Glasc': 'sup', Xerath: 'sup', "Vel'Koz": 'sup', Neeko: 'sup', Zilean: 'sup', Hwei: 'sup', Mel: 'mid', Zoe: 'mid', Heimerdinger: 'sup' };

const ROTA_PT = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'adc', sup: 'sup', bottom: 'adc', utility: 'sup', middle: 'mid' };

/** Rota provável de um campeão deles (a seleção não diz), pelas listas e pelas tags. */
export function rotaProvavel(nome, tags = [], jaTomadas = new Set()) {
  const ordem = [];
  if (PRIMARIA[nome]) ordem.push(PRIMARIA[nome]);
  if (SUPS.has(nome)) ordem.push('sup');
  if (ADCS.has(nome)) ordem.push('adc');
  if (JUNGLERS.has(nome)) ordem.push('jungle');
  if (tags.includes('Mage') || tags.includes('Assassin')) ordem.push('mid');
  if (tags.includes('Fighter') || tags.includes('Tank')) ordem.push('top');
  if (tags.includes('Marksman')) ordem.push('adc');
  if (tags.includes('Support')) ordem.push('sup');
  return ordem.find((r) => !jaTomadas.has(r)) ?? ordem[0] ?? null;
}

const classeDe = (nome, tags) => {
  if (ASSASSINOS.has(nome)) return 'assassino';
  if (TANQUES.has(nome)) return 'tanque';
  if (ENGAGE.has(nome)) return 'engage';
  if (POKE.has(nome)) return 'poke';
  if (tags.includes('Marksman')) return 'atirador';
  if (tags.includes('Mage')) return 'mago';
  if (tags.includes('Support')) return 'sup';
  if (tags.includes('Fighter')) return 'lutador';
  return tags[0]?.toLowerCase() ?? '?';
};

/**
 * `inimigos`: nomes travados. `bans`: nomes que ELES baniram. `perfis`: Map(nome → {tags, dano}).
 * `contraMim`: Map(nome → {jogos, vitorias}) — suas partidas contra esse campeão (banco).
 * `dicas`: Map(nome → [frases]) — "como jogar contra" do ddragon. `minhaRota`: bottom/utility/…
 */
/**
 * Runa preferida pelo confronto de lane. Devolve { runaId, motivo } ou null.
 * Segunda Vento (8242) contra AP de poke na sua lane; Placa de Ossos (8473) contra assassino/all-in.
 * Só vale pra quem joga lane (top/mid/adc/sup); jungle não tem oponente fixo.
 */
export function runaPorConfronto({ meuCampeao, minhaRota, inimigos = [], perfis = new Map() }) {
  const minha = ROTA_PT[minhaRota] ?? minhaRota;
  if (!minha || minha === 'jungle') return null;
  const tags = (n) => perfis.get(n)?.tags ?? [];
  const tomadas = new Set();
  let oponente = null;
  for (const nome of inimigos) { const rota = rotaProvavel(nome, tags(nome), tomadas); if (rota) tomadas.add(rota); if (rota === minha) oponente = nome; }
  // só quando a rota dele é a natural (não sobrou pra ele por eliminação: Lulu "mid" porque o sup já tinha dono)
  if (!oponente || rotaProvavel(oponente, tags(oponente), new Set()) !== minha) return null;
  const dano = perfis.get(oponente)?.dano ?? null, t = tags(oponente);
  if (ASSASSINOS.has(oponente) || (t.includes('Assassin') && dano === 'ad')) return { runaId: 8473, motivo: `${oponente} é all-in: Placa de Ossos` };
  if (dano === 'ap' && (t.includes('Mage') || POKE.has(oponente))) return { runaId: 8242, motivo: `${oponente} é AP de poke: Segunda Vento` };
  return null;
}
export function intelDoTime({ inimigos = [], bans = [], perfis = new Map(), contraMim = new Map(), dicas = new Map(), minhaRota = null, meuCampeao = null }) {
  const tags = (n) => perfis.get(n)?.tags ?? [];
  const dano = (n) => perfis.get(n)?.dano ?? null;
  const minha = ROTA_PT[minhaRota] ?? minhaRota;
  const tomadas = new Set();
  const lista = inimigos.filter(Boolean).map((nome) => {
    const rota = rotaProvavel(nome, tags(nome), tomadas); if (rota) tomadas.add(rota);
    const classe = classeDe(nome, tags(nome));
    const h = contraMim.get(nome) ?? null;
    // ameaça direta pra sua rota: quem te dá dive/engage se você é adc; oponente de lane sempre
    const ameaca = (rota === minha) || (minha === 'adc' && (ASSASSINOS.has(nome) || ENGAGE.has(nome))) || (minha === 'sup' && ENGAGE.has(nome)) || (minha === 'jungle' && rota === 'jungle');
    const marcas = [];
    if (MUITO_CC.has(nome)) marcas.push('CC pesado');
    if (ESCALA.has(nome)) marcas.push('escala');
    if (EARLY.has(nome)) marcas.push('forte no early');
    return { nome, rota, classe, dano: dano(nome), ameaca, marcas, contraMim: h, dica: (dicas.get(nome) ?? [])[0] ?? null };
  });
  const n = lista.length;
  const ad = lista.filter((x) => x.dano === 'ad').length, ap = lista.filter((x) => x.dano === 'ap').length;
  const conta = (S) => lista.filter((x) => S.has(x.nome)).length;
  const engage = conta(ENGAGE), cc = conta(MUITO_CC), poke = conta(POKE), tanques = conta(TANQUES), assassinos = conta(ASSASSINOS), escalam = conta(ESCALA), early = conta(EARLY);
  const avisos = [];
  if (n >= 3 && ap === 0) avisos.push({ texto: 'todo AD: armadura vale dobrado', tipo: 'bom' });
  if (n >= 3 && ad === 0) avisos.push({ texto: 'todo AP: resistência mágica vale dobrado', tipo: 'bom' });
  if (cc >= 3) avisos.push({ texto: `${cc} com CC pesado: Purificar ou Mercúrio`, tipo: 'ruim' });
  if (assassinos >= 2) avisos.push({ texto: `${assassinos} assassinos: não anda sozinho, ward atrás`, tipo: 'ruim' });
  if (engage >= 3) avisos.push({ texto: `${engage} de engage: eles vão iniciar — não dá o flanco`, tipo: 'ruim' });
  if (poke >= 3) avisos.push({ texto: `${poke} de poke: não fica parado na frente, engaja ou recua`, tipo: 'ruim' });
  if (tanques >= 2) avisos.push({ texto: `${tanques} tanques: dano por vida / corte de armadura`, tipo: 'neutro' });
  if (escalam >= 3) avisos.push({ texto: `${escalam} escalam: fecha o jogo cedo`, tipo: 'neutro' });
  if (early >= 3 && escalam <= 1) avisos.push({ texto: `${early} fortes no early: joga seguro até os itens`, tipo: 'neutro' });
  const bansDeles = bans.filter(Boolean);
  const resumo = n ? `${ad} AD · ${ap} AP${engage ? ` · ${engage} engage` : ''}${assassinos ? ` · ${assassinos} assassino${assassinos > 1 ? 's' : ''}` : ''}${tanques ? ` · ${tanques} tanque${tanques > 1 ? 's' : ''}` : ''}${poke ? ` · ${poke} poke` : ''}` : null;
  return { lista, resumo, avisos, bans: bansDeles, completude: Math.min(1, n / 5) };
}
