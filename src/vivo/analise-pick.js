/**
 * Análise de pick: junta TUDO que dá pra saber na seleção e explica.
 *
 *   contra   — confronto direto com o oponente de lane (op.gg, mesma rota)
 *   duo      — combinação com o parceiro de lane (sinergia.js)
 *   time     — o que o nosso time precisa (todo AD? sem frontline?)
 *   ameaça   — o que eles têm de assassino/dive (pick seguro vale mais)
 *   tanques  — 2+ tanques deles: dano por vida / corte de armadura
 *   conforto — seus jogos e vitórias com o campeão (banco)
 *
 * Cada fator vira uma nota 0..1 e uma frase curta; a nota final é a média
 * ponderada dos fatores que existem. `completude` diz quanto do time deles
 * já apareceu — antes de 3 picks deles a análise é parcial e a voz espera.
 */
const ASSASSINOS = new Set(['Zed', 'Talon', "Kha'Zix", 'Rengar', 'Nocturne', 'Kayn', 'Fizz', 'Akali', 'Katarina', 'Qiyana', 'Evelynn', 'Shaco', 'Ekko', 'Yone', 'Yasuo', 'Irelia', 'Camille', 'Jax', 'Vi', 'Jarvan IV', 'Hecarim', 'Diana', 'Naafiri', 'Briar', 'Ambessa', 'Sylas', 'Pyke', 'Master Yi', 'Tryndamere', 'Kled', 'Rell', 'Nautilus', 'Leona', 'Malphite', 'Wukong', 'Lee Sin', 'Xin Zhao', 'Warwick', 'Volibear', 'Sett', 'Renekton', 'Riven', 'Pantheon', 'Zac']);
const TANQUES = new Set(['Ornn', 'Malphite', 'Sion', 'Maokai', 'Shen', 'Sejuani', 'Zac', 'Rammus', 'Amumu', 'Nautilus', 'Leona', 'Braum', 'Tahm Kench', 'Cho\'Gath', 'Mundo', 'Dr. Mundo', 'Nunu & Willump', 'Galio', 'Poppy', 'Alistar', 'Rell', 'Skarner', 'Udyr', 'K\'Sante', 'Gragas', 'Volibear', 'Illaoi', 'Sett', 'Mordekaiser', 'Darius', 'Garen', 'Nasus', 'Singed', 'Taric']);
// adc: mobilidade/autoproteção (0 = parado, 1 = escapa fácil)
const SEGURANCA = { Ezreal: 1, Sivir: 0.9, Tristana: 0.9, Lucian: 0.85, Xayah: 0.8, "Kai'Sa": 0.8, Samira: 0.7, Vayne: 0.7, Caitlyn: 0.6, Nilah: 0.6, Zeri: 0.7, 'Miss Fortune': 0.4, Jhin: 0.35, Ashe: 0.35, Jinx: 0.3, "Kog'Maw": 0.2, Twitch: 0.4, Aphelios: 0.25, Varus: 0.35, Draven: 0.45, Kalista: 0.8, Smolder: 0.5, Yunara: 0.45, Senna: 0.4, Ziggs: 0.5, Seraphine: 0.3, Karthus: 0.2, Swain: 0.4, Corki: 0.7 };
// adc: dano por vida / corte de armadura contra tanque
const ANTITANQUE = { Vayne: 1, "Kog'Maw": 1, "Kai'Sa": 0.8, Varus: 0.8, Kalista: 0.7, Jinx: 0.5, Twitch: 0.6, Aphelios: 0.5, Ezreal: 0.4, Caitlyn: 0.4, Smolder: 0.5, Yunara: 0.6, Draven: 0.3, Lucian: 0.3, Samira: 0.3, Jhin: 0.3, 'Miss Fortune': 0.3, Ashe: 0.4, Sivir: 0.3, Tristana: 0.5, Xayah: 0.4, Nilah: 0.5, Zeri: 0.6, Senna: 0.3, Ziggs: 0.3, Seraphine: 0.2, Karthus: 0.4, Swain: 0.3, Corki: 0.5 };

const pct = (x) => `${Math.round(x * 100)}%`;

export function analisarPick({ rota, candidatos, aliados = [], inimigos = [], parceiro = null, confrontos = new Map(), sinergia = new Map(), historico = {}, meusNumeros = new Map(), perfis = new Map() }) {
  const perfil = (n) => perfis.get(n) ?? null;
  const dano = (n) => perfil(n)?.dano ?? null;
  const tags = (n) => perfil(n)?.tags ?? [];
  const ehAdc = rota === 'bottom';
  // oponente de lane deles (pelo perfil, já que a seleção não diz a rota deles)
  const oponente = inimigos.find((n) => {
    if (rota === 'bottom') return tags(n).includes('Marksman');
    if (rota === 'utility') return tags(n).includes('Support');
    if (rota === 'middle') return tags(n).includes('Mage') || tags(n).includes('Assassin');
    if (rota === 'top') return tags(n).includes('Fighter') || tags(n).includes('Tank');
    return false;
  }) ?? null;
  // o nosso time (sem eu)
  const nossos = aliados.filter(Boolean);
  const nossosAd = nossos.filter((n) => dano(n) === 'ad').length, nossosAp = nossos.filter((n) => dano(n) === 'ap').length;
  const nossosFrente = nossos.filter((n) => TANQUES.has(n) || tags(n).includes('Tank')).length;
  const ameacas = inimigos.filter((n) => ASSASSINOS.has(n));
  const tanquesDeles = inimigos.filter((n) => TANQUES.has(n) || tags(n).includes('Tank'));
  const completude = Math.min(1, inimigos.length / 5);

  const lista = candidatos.map((nome) => {
    const fatores = [];
    // 1. confronto direto
    const c = confrontos.get(nome) ?? [];
    const lane = oponente ? c.find((x) => x.campeao === oponente) : null;
    if (lane) fatores.push({ chave: 'contra', peso: 0.3, nota: lane.taxa, texto: `${pct(lane.taxa)} contra ${oponente}${lane.taxa >= 0.53 ? ' (bom)' : lane.taxa <= 0.47 ? ' (ruim)' : ''}` });
    const outros = c.filter((x) => x.campeao !== oponente);
    if (outros.length) { const m = outros.reduce((s, x) => s + x.taxa, 0) / outros.length; fatores.push({ chave: 'resto', peso: 0.1, nota: m, texto: `${pct(m)} contra o resto deles` }); }
    // 2. duo
    const sin = sinergia.get(nome);
    if (sin?.nota != null && parceiro) fatores.push({ chave: 'duo', peso: 0.2, nota: sin.nota, texto: `com ${parceiro}: ${sin.motivo ?? pct(sin.nota)}` });
    // 3. o que o time precisa
    if (nossos.length >= 3) {
      const meu = dano(nome);
      if (meu === 'ap' && nossosAp === 0) fatores.push({ chave: 'time', peso: 0.12, nota: 0.9, texto: 'time todo AD: seu AP é o único' });
      else if (meu === 'ad' && nossosAd >= 3 && nossosAp === 0) fatores.push({ chave: 'time', peso: 0.12, nota: 0.35, texto: 'time já é todo AD (eles vão de armadura)' });
      else if (meu === 'ad' && nossosAp >= 2) fatores.push({ chave: 'time', peso: 0.12, nota: 0.75, texto: 'dano misto no time' });
      if (nossosFrente === 0 && ehAdc) fatores.push({ chave: 'frente', peso: 0.08, nota: (SEGURANCA[nome] ?? 0.5), texto: 'time sem frontline: pick que se protege sozinho' });
    }
    // 4. ameaça deles
    if (ameacas.length >= 2 && ehAdc) { const seg = SEGURANCA[nome] ?? 0.5; fatores.push({ chave: 'ameaca', peso: 0.2 * Math.min(1, ameacas.length / 3), nota: seg, texto: `${ameacas.length} de dive/assassino (${ameacas.slice(0, 3).join(', ')}): ${seg >= 0.7 ? 'você escapa' : seg <= 0.35 ? 'você fica parado — cuidado' : 'dá pra jogar'}` }); }
    // 5. tanques deles
    if (tanquesDeles.length >= 2 && ehAdc) { const at = ANTITANQUE[nome] ?? 0.4; fatores.push({ chave: 'tanque', peso: 0.12, nota: at, texto: `${tanquesDeles.length} tanques deles: ${at >= 0.7 ? 'você fura' : at <= 0.3 ? 'você não fura' : 'ok'}` }); }
    // 6. conforto
    const meu = meusNumeros.get(nome);
    if (meu?.jogos >= 3) { const t = (meu.vitorias + 1) / (meu.jogos + 2); fatores.push({ chave: 'conforto', peso: 0.15, nota: t, texto: `você: ${meu.vitorias}/${meu.jogos}${meu.jogos >= 10 ? '' : ' (pouco jogo)'}` }); }
    else if (meu?.jogos > 0) fatores.push({ chave: 'conforto', peso: 0.1, nota: 0.4, texto: `você: só ${meu.jogos} jogo${meu.jogos > 1 ? 's' : ''}` });
    else fatores.push({ chave: 'conforto', peso: 0.08, nota: 0.35, texto: 'você nunca jogou com ele aqui' });
    const hist = historico?.[nome];
    if (hist?.jogos >= 2 && parceiro) fatores.push({ chave: 'duo-hist', peso: 0.08, nota: (hist.vitorias + 1) / (hist.jogos + 2), texto: `você com ${parceiro}: ${hist.vitorias}/${hist.jogos}` });
    const peso = fatores.reduce((s, f) => s + f.peso, 0);
    const total = peso ? fatores.reduce((s, f) => s + f.nota * f.peso, 0) / peso : null;
    return { nome, total, fatores, contra: c };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

  const melhor = lista.find((r) => r.total != null) ?? null;
  const avisos = [];
  if (nossos.length >= 3 && nossosAp === 0 && !nossos.some((n) => dano(n) === 'misto')) avisos.push('time todo AD');
  if (ameacas.length >= 3) avisos.push(`${ameacas.length} de dive neles`);
  if (tanquesDeles.length >= 2) avisos.push(`${tanquesDeles.length} tanques neles`);
  const porque = melhor ? melhor.fatores.slice().sort((a, b) => Math.abs(b.nota - 0.5) * b.peso - Math.abs(a.nota - 0.5) * a.peso).slice(0, 3).map((f) => f.texto) : [];
  return { lista, melhor, oponente, completude, avisos, porque, resumoTime: nossos.length ? `${nossosAd} AD · ${nossosAp} AP · ${nossosFrente} frontline` : null };
}
