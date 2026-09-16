/**
 * Confere as previsões do olho contra o que aconteceu depois (leituras):
 * "jungler indo pro bot" → apareceu no bot em 30 s? "X a 6 s de você" →
 * chegou mais perto? Usado no fim da partida (acertos.jsonl) e no replay.
 * Devolve [{ t, chave, falada, acertou }] só das situações que preveem algo.
 */
export function conferir(situacoes, leituras, p) {
  if (!p?.eu || !leituras.length) return [];
  const meuTime = p.eu.time, meuC = p.eu.campeao;
  const campeaoDe = new Map(p.jogadores.map((j) => [j.nome, j.campeao]));
  const jgDeles = p.jogadores.find((j) => j.time !== meuTime && j.role === 'jungle')?.campeao ?? null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const janela = (t0, t1) => leituras.filter((l) => l.t > t0 && l.t <= t1);
  const chegouNaLane = (campeao, lane, t0, t1) => janela(t0, t1).some((l) => l.campeoes.some((c) => c.c === campeao && c.ha != null && c.ha <= 3 && String(c.regiao ?? '').startsWith(lane)));
  // "X vindo em cima de você": acertou se ele chegou de fato mais perto do que estava na hora (mesmo você recuando)
  const distDeMim = (l, campeao) => { const me = l.campeoes.find((c) => c.c === meuC && c.time === meuTime), o = l.campeoes.find((c) => c.c === campeao); return me?.x != null && o?.x != null && o.ha <= 3 ? dist(me, o) : null; };
  const aproximou = (campeao, t0, t1) => {
    const na = janela(t0 - 2, t0 + 0.5).map((l) => distDeMim(l, campeao)).filter((d) => d != null); if (!na.length) return null;
    const depois = janela(t0 + 0.5, t1).map((l) => distDeMim(l, campeao)).filter((d) => d != null); if (!depois.length) return false;
    return Math.min(...depois) < na[na.length - 1] - 0.03 || Math.min(...depois) < 0.07;
  };
  const saida = [];
  for (const s of situacoes) {
    let acertou = null;
    let m;
    if ((m = s.chave.match(/^jg-indo-(top|mid|bot)$/)) && jgDeles) acertou = chegouNaLane(jgDeles, m[1], s.t, s.t + 40);
    else if ((m = s.chave.match(/^roam-(.+)-(top|mid|bot)$/))) { const c = campeaoDe.get(m[1]); if (c) acertou = chegouNaLane(c, m[2], s.t, s.t + 45); }
    else if ((m = s.chave.match(/^perto-(.+)$/))) { const c = campeaoDe.get(m[1]); if (c) acertou = aproximou(c, s.t, s.t + 10); }
    else if (s.chave === 'jg-vindo' && jgDeles) acertou = aproximou(jgDeles, s.t, s.t + 12);
    else if (s.chave === 'jg-inicio' && jgDeles && s.dados?.laneGank) acertou = chegouNaLane(jgDeles, s.dados.laneGank, 170, 250);
    else if (s.chave === 'jg-sumido' && jgDeles && ['top', 'mid', 'bot'].includes(s.dados?.rumo)) acertou = chegouNaLane(jgDeles, s.dados.rumo, s.t, s.t + 45);
    else if (s.chave === 'jg-gank-previsto' && jgDeles && s.dados?.lane) acertou = chegouNaLane(jgDeles, s.dados.lane, s.t - 10, s.t + 40);
    if (acertou == null) continue;
    saida.push({ t: s.t, chave: s.chave, falada: !!s.falada, acertou });
  }
  return saida;
}
