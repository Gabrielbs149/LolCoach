/**
 * A lição da partida: UMA frase.
 *
 * A análise completa continua embaixo, mas quem abre a tela de uma partida quer
 * saber a coisa mais cara que aconteceu — não uma lista de doze observações. Aqui
 * os candidatos competem por peso e só o maior vira lição. Ganha o que se repetiu,
 * porque erro repetido é hábito, e hábito é o que dá pra treinar no próximo jogo.
 */

const FASE = { lane: 'antes dos 14', meio: 'entre 14 e 25', fim: 'depois dos 25' };

export function licaoDaPartida({ lane = null, situacoes = null, acertos = null, nota = null, venci = false, minhaRole = null } = {}) {
  const mortes = Array.isArray(situacoes) ? situacoes : (situacoes?.mortes ?? []);
  const padrao = Array.isArray(situacoes) ? [] : (situacoes?.padrao ?? []);
  const cands = [];

  /* ---- o mesmo erro mais de uma vez: o mais caro que existe ---- */
  const porFazer = new Map();
  for (const m of mortes) for (const f of m.fazer ?? []) porFazer.set(f, [...(porFazer.get(f) ?? []), m]);
  for (const [f, ms] of porFazer) {
    if (ms.length < 2) continue;
    cands.push({ peso: 40 + 12 * ms.length, chave: 'repetido',
      titulo: `${ms.length} das suas ${mortes.length} mortes foram pelo mesmo motivo`,
      texto: f, quando: ms.map((m) => m.minuto).join(', ') });
  }

  /* ---- o padrão que a própria análise já achou ---- */
  if (padrao.length) cands.push({ peso: 38, chave: 'padrao', titulo: 'O padrão que se repetiu', texto: padrao[0] });

  /* ---- o mesmo algoz ---- */
  const porAlgoz = new Map();
  for (const m of mortes) if (m.algoz) porAlgoz.set(m.algoz, (porAlgoz.get(m.algoz) ?? 0) + 1);
  const [algoz, nAlgoz] = [...porAlgoz].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (nAlgoz >= 3) {
    cands.push({ peso: 35 + 10 * nAlgoz, chave: 'algoz',
      titulo: `${algoz} te matou ${nAlgoz} vezes`,
      texto: `Um inimigo só levou ${nAlgoz} das suas ${mortes.length} mortes. Na próxima contra ele: primeiro confere onde ele está, depois decide o que fazer — não o contrário.` });
  }

  /* ---- tudo cedo: a partida se decidiu na lane ---- */
  const cedo = mortes.filter((m) => m.fase === 'lane').length;
  if (cedo >= 3) {
    cands.push({ peso: 30 + 8 * cedo, chave: 'cedo',
      titulo: `${cedo} mortes ${FASE.lane} minutos`,
      texto: 'O jogo acabou na fase de rota. Sobreviver os primeiros 14 minutos vale mais que qualquer coisa que você faça depois — morrer cedo entrega gold quando ele custa mais.' });
  }

  /* ---- o confronto era ruim e você jogou como se não fosse ---- */
  if (lane?.veredito === 'difícil' && lane?.taxas?.length) {
    const pior = [...lane.taxas].sort((a, b) => a.taxa - b.taxa)[0];
    const perdeu = (lane.ouro ?? []).at(-1)?.diff ?? 0;
    if (perdeu < -300 || mortes.length >= 3) {
      cands.push({ peso: 34, chave: 'confronto',
        titulo: `${pior.meu} contra ${pior.contra} é ${pior.taxa}%`,
        texto: `Esse confronto já começa perdido em ${100 - pior.taxa}% das partidas (${pior.jogos} jogos). Lane assim não é pra ganhar, é pra empatar: farma o que dá, não aceita troca e joga pro mapa.` });
    }
  }

  /* ---- morreu sozinho longe ---- */
  const sozinho = mortes.filter((m) => (m.linhas ?? []).some((l) => /sozinh|1v\d/.test(l))).length;
  if (sozinho >= 2) {
    cands.push({ peso: 28 + 6 * sozinho, chave: 'sozinho',
      titulo: `${sozinho} mortes com você sozinho`,
      texto: 'Sem aliado a menos de uma tela, o lado do mapa deles não é seu. Antes de andar pra frente, procura alguém do teu time na minimapa — se não tem ninguém, a wave espera.' });
  }

  /* ---- vitória limpa: a lição é o que funcionou ---- */
  if (venci && (nota?.nota ?? 0) >= 8 && mortes.length <= 3) {
    const bom = acertos?.momentos?.[0] ?? acertos?.[0] ?? null;
    cands.push({ peso: 26, chave: 'bom',
      titulo: 'Partida bem jogada — guarda o que funcionou',
      texto: bom?.titulo ? `${bom.titulo}: foi isso que abriu o jogo. Repetir é mais fácil que inventar.` : `Nota ${nota.nota.toFixed(1)} com ${mortes.length} morte${mortes.length === 1 ? '' : 's'}. O que ganhou o jogo foi não morrer — leva esse ritmo pro próximo.` });
  }

  /* ---- nada de grave ---- */
  if (!cands.length) {
    if (!mortes.length) return { chave: 'perfeito', titulo: 'Partida sem morrer', texto: 'Nada a corrigir aqui. Olha os acertos embaixo e tenta repetir o ritmo.' };
    const m = mortes[0];
    const f = (m.fazer ?? [])[0];
    if (!f) return null;
    return { chave: 'unica', titulo: `A morte de ${m.minuto} foi a mais cara`, texto: f };
  }

  const escolhida = cands.sort((a, b) => b.peso - a.peso)[0];
  return { chave: escolhida.chave, titulo: escolhida.titulo, texto: escolhida.texto, quando: escolhida.quando ?? null };
}
