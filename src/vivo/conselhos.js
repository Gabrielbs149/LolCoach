/**
 * Transforma o estado da partida em andamento numa lista curta de "faça isso
 * agora". Cada item tem um problema e uma ação — sem ação não entra.
 *
 * O que dá pra saber ao vivo: relógio, ouro, itens, nível, placar e a lista de
 * acontecimentos. **Posição não existe nesta API**, então nada aqui fala de
 * onde alguém está no mapa; isso fica pra análise depois da partida.
 */

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Tempos de renascimento. Depois da primeira morte do objetivo o cálculo é
// exato, porque sai do próprio acontecimento. O primeiro nascimento é o padrão
// conhecido e vai marcado como estimativa.
const RESPAWN_DRAGAO = 5 * 60;
const RESPAWN_BARAO = 6 * 60;
const PRIMEIRO_DRAGAO = 5 * 60;
const PRIMEIRO_BARAO = 20 * 60;

const item = (chave, urgencia, titulo, acao, extra = {}) => ({ chave, urgencia, titulo, acao, ...extra });

/** Quando o próximo objetivo nasce, e se veio de evento ou de estimativa. */
function proximoObjetivo(eventos, tempo, tipoEvento, respawn, primeiro) {
  const ultimo = [...eventos].reverse().find((e) => e.tipo === tipoEvento);
  if (ultimo) return { em: ultimo.t + respawn - tempo, exato: true };
  if (tempo < primeiro) return { em: primeiro - tempo, exato: false };
  return null; // já passou do primeiro e ninguém pegou: está no mapa agora
}

export function montarConselhos(estado, perfil) {
  if (!estado?.eu) return [];

  const { tempo, eu, jogadores, eventos } = estado;
  const meuTime = eu.time;
  const inimigos = jogadores.filter((j) => j.time !== meuTime);
  const aliados = jogadores.filter((j) => j.time === meuTime);
  const fora = [];

  /* ---------------------------------------------------------- objetivos */
  for (const [nome, tipoEvento, respawn, primeiro] of [
    ['Dragão', 'DragonKill', RESPAWN_DRAGAO, PRIMEIRO_DRAGAO],
    ['Barão', 'BaronKill', RESPAWN_BARAO, PRIMEIRO_BARAO],
  ]) {
    const p = proximoObjetivo(eventos, tempo, tipoEvento, respawn, primeiro);
    if (!p) {
      fora.push(item(`obj-${nome}`, 2, `${nome} está no mapa agora`,
        'Se o time tem prio, agrupa. Se não tem, pega o lado oposto em vez de contestar de graça.'));
      continue;
    }
    if (p.em <= 45 && p.em > 0) {
      fora.push(item(`obj-${nome}`, 3, `${nome} em ${mmss(p.em)}`,
        'Comece a rotacionar agora. Chegar depois da briga começar é o mesmo que não ir.',
        { exato: p.exato }));
    } else if (p.em <= 90 && p.em > 0) {
      fora.push(item(`obj-${nome}`, 1, `${nome} em ${mmss(p.em)}`,
        'Limpe a wave e prepare visão antes de descer.', { exato: p.exato }));
    }
  }

  // Placar de dragões: quem está perto da alma.
  const dragoes = eventos.filter((e) => e.tipo === 'DragonKill');
  if (dragoes.length) {
    const meus = dragoes.filter((e) => aliados.some((a) => a.nome === e.autor)).length;
    const deles = dragoes.length - meus;
    if (deles >= 2 && deles > meus) {
      fora.push(item('alma', 3, `Eles estão com ${deles} dragões`,
        deles === 3 ? 'O próximo fecha alma pra eles. Este objetivo vale mais que qualquer torre.'
          : 'Não deixe chegar no terceiro. O próximo dragão vale mais que a wave que você está pegando.'));
    }
  }

  /* ------------------------------------------------------------ economia */
  if (eu.ouro >= 1300 && !eu.morto) {
    fora.push(item('recall', 2, `${eu.ouro} de gold parado`,
      'Volta assim que a wave estiver empurrada. Item na mão ganha troca; gold no bolso não faz nada.'));
  }

  /* -------------------------------------------------------- seu histórico */
  if (perfil) {
    const faixa = perfil.porFaixa.find((f) => tempo >= f.de && tempo < f.ate);
    if (faixa && perfil.piorFaixa && faixa.chave === perfil.piorFaixa.chave && tempo - faixa.de < 90) {
      fora.push(item('janela', 2, `Começou sua faixa de mais mortes (${faixa.chave} min)`,
        `Você morre ${faixa.porJogo.toFixed(1)}x por jogo nesta janela. Antes de andar pra frente, ache um aliado a menos de uma tela.`));
    }

    if (perfil.isoladasPorJogo >= 0.8) {
      fora.push(item('isolada', 1, 'Seu erro mais repetido: morrer sozinho',
        `Acontece ${perfil.isoladasPorJogo.toFixed(1)}x por jogo nas suas ${perfil.partidas} partidas. Sem aliado a uma tela, o lado do mapa deles não é seu.`));
    }

    if (perfil.mortesEmDerrota && eu.mortes >= Math.round(perfil.mortesEmVitoria ?? 4)) {
      fora.push(item('mortes', eu.mortes >= perfil.mortesEmDerrota ? 3 : 2,
        `${eu.mortes} mortes`,
        `Nas suas vitórias você morre ${perfil.mortesEmVitoria.toFixed(1)}x; nas derrotas ${perfil.mortesEmDerrota.toFixed(1)}x. Jogue os próximos minutos pra não morrer, mesmo que custe farm.`));
    }
  }

  /* --------------------------------------------------------------- lane */
  const rival = inimigos.find((j) => j.role && j.role === eu.role);
  if (rival && tempo > 300) {
    const dif = eu.cs - rival.cs;
    if (dif <= -20) {
      fora.push(item('farm', 2, `${Math.abs(dif)} de farm atrás do ${rival.campeao}`,
        'Farm é o ouro garantido. Pegue as waves seguras antes de procurar briga.'));
    }
  }

  /* ------------------------------------------------------------- ameaça */
  const perigoso = [...inimigos].sort((a, b) => (b.kills + b.assists / 2) - (a.kills + a.assists / 2))[0];
  if (perigoso && perigoso.kills >= 4 && perigoso.kills >= perigoso.mortes * 2) {
    fora.push(item('ameaca', 2, `${perigoso.campeao} está alimentado (${perigoso.kills}/${perigoso.mortes}/${perigoso.assists})`,
      'Não fique sozinho onde ele pode aparecer. Se for teu oponente direto, jogue pra empatar a lane, não pra ganhar.'));
  }

  const mortos = inimigos.filter((j) => j.morto);
  if (mortos.length >= 2) {
    const maisTempo = Math.max(...mortos.map((j) => j.renasceEm));
    fora.push(item('janela-aberta', 3, `${mortos.length} inimigos mortos`,
      `Você tem ~${Math.round(maisTempo)}s. Pegue objetivo ou torre agora — é a janela mais barata do jogo.`));
  }

  /* ----------------------------------------------------------- sobreviver */
  if (eu.vidaMax && eu.vida / eu.vidaMax < 0.35 && !eu.morto) {
    fora.push(item('vida', 3, `Você está com ${Math.round((eu.vida / eu.vidaMax) * 100)}% de vida`,
      'Recue ou volte. A maior parte das suas mortes começa com você já machucado.'));
  }

  return fora.sort((a, b) => b.urgencia - a.urgencia);
}

export { mmss };
