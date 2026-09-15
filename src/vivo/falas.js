/**
 * O que a voz fala durante a partida. Cada fala tem um módulo (pra ligar e
 * desligar na tela), um id (pra falar uma vez só) e dois textos: sério e
 * divertido. Tudo sai de eventos e deltas da API do jogo — nada de posição.
 */

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function novaMemoriaFalas() {
  return { ditas: new Set(), ultimoTempo: 0, ultimoKills: null, ultimoMortes: null };
}

/**
 * `estado`: leitura da API do jogo; `rastreio`: o que rastreio.js viu de novo;
 * `objetivos`: de objetivos.js; `conselhos`: de conselhos.js.
 * Devolve só as falas NOVAS desde a última chamada.
 */
export function falasNovas({ estado, rastreio, objetivos, conselhos }, mem) {
  const { tempo, eu, jogadores, eventos } = estado;
  const novas = [];
  const dizer = (id, modulo, serio, divertido, prioridade = 1) => {
    if (mem.ditas.has(id)) return;
    mem.ditas.add(id);
    novas.push({ id, modulo, serio, divertido: divertido ?? serio, prioridade });
  };
  const inimigos = jogadores.filter((j) => j.time !== eu.time);
  const aliadoNome = (n) => jogadores.some((j) => j.time === eu.time && j.nome === n);

  /* ---- timers: 60s e 30s antes; e quando nasce ---- */
  for (const o of objetivos ?? []) {
    const chave = `${o.nome}-${Math.round((tempo + o.em) / 60)}`;
    if (o.em > 55 && o.em <= 62) dizer(`t60-${chave}`, 'timers', `${o.nome} em um minuto. Limpa a wave e prepara visão.`, `${o.nome} daqui a um minuto. Larga esse minion e vai pro rio, campeão.`, 2);
    else if (o.em > 25 && o.em <= 32) dizer(`t30-${chave}`, 'timers', `${o.nome} em trinta segundos.`, `Trinta segundos pro ${o.nome}. Se chegar depois, nem vai.`, 3);
    else if (o.vivo && o.em > -6) dizer(`nasceu-${chave}`, 'timers', `${o.nome} está no mapa.`, `${o.nome} nasceu. Quem tem prio pega, quem não tem chora.`, 2);
  }
  if (tempo >= 13 * 60 && tempo < 13 * 60 + 8) dizer('placas', 'timers', 'Placas de torre caem em um minuto. Vale pegar o que der de gold.', 'Um minuto pras placas sumirem. Bate na torre que é dinheiro grátis.', 2);

  /* ---- kills e mortes: reage ao que acabou de acontecer ---- */
  for (const e of eventos) {
    if (e.t < mem.ultimoTempo - 1) continue;   // já visto
    if (e.tipo === 'ChampionKill') {
      const souAutor = e.autor === eu.nome, souVitima = e.vitima === eu.nome;
      const vitimaJ = jogadores.find((j) => j.nome === e.vitima);
      const autorJ = jogadores.find((j) => j.nome === e.autor);
      if (souVitima) {
        const quem = autorJ?.campeao ?? 'eles';
        dizer(`morte-${e.id}`, 'kills', `Você morreu pro ${quem}. Antes de voltar, pensa no que deu a abertura.`, `Morreu pro ${quem}. Tá tudo bem, respira, o time ainda te ama.`, 2);
      } else if (souAutor) {
        dizer(`kill-${e.id}`, 'kills', `Boa kill no ${vitimaJ?.campeao ?? 'inimigo'}. Empurra a wave ou pega placa antes de voltar.`, `Abateu o ${vitimaJ?.campeao ?? 'cara'}! Agora não vai morrer de bobeira comemorando.`, 2);
      } else if (autorJ && autorJ.time !== eu.time && autorJ.role === 'jungle' && vitimaJ?.role) {
        // Jungler deles apareceu: a lane oposta está livre por um tempo.
        dizer(`jg-${e.id}`, 'jungler', `Jungler deles, ${autorJ.campeao}, apareceu no ${vitimaJ.role}. Lado oposto está livre por uns quarenta segundos.`, `${autorJ.campeao} tá no ${vitimaJ.role}. Quem está do outro lado: hora de ser abusado.`, 2);
      } else if (e.assistentes?.length && inimigos.some((i) => i.role === 'jungle' && e.assistentes.includes(i.nome)) && vitimaJ && vitimaJ.time === eu.time) {
        const jg = inimigos.find((i) => i.role === 'jungle');
        dizer(`jg-${e.id}`, 'jungler', `Jungler deles, ${jg.campeao}, gankou o ${vitimaJ.role}.`, `${jg.campeao} passou no ${vitimaJ.role}. Anota o horário.`, 1);
      }
    }
    if (e.tipo === 'FirstBlood') dizer(`fb-${e.id}`, 'kills', aliadoNome(e.autor) ? 'Primeiro sangue é nosso.' : 'Primeiro sangue deles. Joga seguro até equilibrar.', aliadoNome(e.autor) ? 'First blood pra gente. Começou bem!' : 'First blood pra eles. Calma, ainda é cedo.', 1);
    if (e.tipo === 'Multikill' && e.autor === eu.nome) dizer(`multi-${e.id}`, 'kills', 'Multikill. Aproveita a vantagem: objetivo ou torre agora.', 'MULTIKILL! Agora pega um objetivo antes que o ego suba.', 2);
    if (e.tipo === 'Ace') dizer(`ace-${e.id}`, 'kills', aliadoNome(e.autor) ? 'Ace. Todo mundo deles morto: barão ou torres, agora.' : 'Ace deles. Defende a base e não dá mais nada de graça.', aliadoNome(e.autor) ? 'ACE! Vai pro barão, vai pro barão!' : 'Levamos ace. Segura a base, ninguém sai sozinho.', 3);
    if (e.tipo === 'DragonKill' && !aliadoNome(e.autor)) dizer(`dg-${e.id}`, 'timers', `Eles pegaram o dragão${e.dragao ? ' ' + e.dragao : ''}.`, 'Perdemos o dragão. Da próxima chega antes.', 1);
    if (e.tipo === 'BaronKill') dizer(`bk-${e.id}`, 'timers', aliadoNome(e.autor) ? 'Barão nosso. Agrupa e empurra três lanes.' : 'Eles pegaram barão. Não briga na frente da torre, só defende.', aliadoNome(e.autor) ? 'BARÃO! Agora vai lá e acaba com isso.' : 'Barão deles. Hora de jogar defensivo e rezar.', 3);
  }

  /* ---- spikes de item e nível vindos do rastreio ---- */
  for (const a of rastreio?.avisos ?? []) {
    if (a.t < mem.ultimoTempo - 1) continue;
    if (String(a.chave).startsWith('item-')) dizer(`fala-${a.chave}`, 'spikes', `${a.titulo}. ${a.acao ?? ''}`.trim(), `${a.titulo}. Cuidado que agora ele bate.`, a.urgencia);
    else if (String(a.chave).startsWith('nv-') && /nível 6/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', `${a.titulo}. Ele tem ult.`, `${a.titulo}. Ult liberada, não dá presente.`, 2);
    else if (String(a.chave).startsWith('nv-') && /níveis na frente/.test(a.titulo)) dizer(`fala-${a.chave}`, 'spikes', a.titulo, a.titulo, 2);
    else if (String(a.chave).startsWith('jg-')) dizer(`fala-${a.chave}`, 'jungler', a.titulo, a.titulo, 2);
  }

  /* ---- conselhos urgentes que ainda não foram ditos ---- */
  for (const c of conselhos ?? []) {
    if (c.urgencia < 2) continue;
    const modulo = /gold/i.test(c.titulo) ? 'economia' : /vida/i.test(c.titulo) ? 'kills' : /dragão|barão|dragões/i.test(c.titulo) ? 'timers' : 'lane';
    dizer(`c-${c.chave ?? c.titulo}`, modulo, `${c.titulo}. ${c.acao}`, `${c.titulo}. ${c.acao}`, c.urgencia);
  }

  mem.ultimoTempo = tempo;
  return novas.sort((a, b) => b.prioridade - a.prioridade);
}

/**
 * Na seleção de campeão: com quem dos seus picks você ganha dos inimigos já
 * travados, pelos confrontos do op.gg. Devolve a lista ordenada e uma fala.
 */
export async function sugerirPick({ candidatos, rota, inimigosIds, confrontoContra, tabela, opcoes }) {
  const resultado = [];
  for (const nome of candidatos) {
    const linhas = [];
    for (const id of inimigosIds) {
      const c = await confrontoContra(nome, rota, id, opcoes).catch(() => null);
      if (c) linhas.push({ id, campeao: tabela.porId.get(id) ?? String(id), taxa: c.taxa, jogos: c.jogos });
    }
    const media = linhas.length ? linhas.reduce((s, l) => s + l.taxa, 0) / linhas.length : null;
    resultado.push({ nome, media, contra: linhas });
  }
  resultado.sort((a, b) => (b.media ?? -1) - (a.media ?? -1));
  const melhor = resultado.find((r) => r.media != null);
  const pior = melhor?.contra.sort((a, b) => a.taxa - b.taxa)[0];
  const fala = melhor
    ? { serio: `Pelos confrontos, ${melhor.nome} é o melhor pick contra o que eles travaram${pior && pior.taxa < 0.47 ? `; cuidado com ${pior.campeao}` : ''}.`,
        divertido: `${melhor.nome} come esse time deles${pior && pior.taxa < 0.47 ? `, menos o ${pior.campeao}, que é chato` : ''}.` }
    : null;
  return { lista: resultado, fala, mmss };
}
