import http from 'node:http';
import { readFile, appendFile, mkdir, stat, rename } from 'node:fs/promises';
import { pastaBase } from '../caminhos.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { temporadaDe, resumoPorTemporada } from '../dados/temporadas.js';
import { notasDaPartida, laningPct, selosDaPartida } from '../analise/nota.js';
import { elosGuardados } from '../dados/elo-partida.js';
import { temporadasDoOpgg, topPorcento } from '../dados/opgg-perfil.js';

const AQUI = dirname(fileURLToPath(import.meta.url));

// A versão do app, lida do package.json uma vez — vai na barra lateral.
let VERSAO = '?';
readFile(join(AQUI, '..', '..', 'package.json'), 'utf8').then((t) => { VERSAO = JSON.parse(t).version ?? '?'; }).catch(() => {});

/**
 * Servidor local que serve o painel e a API de leitura do banco.
 * Só escuta em 127.0.0.1 — nada disso deve sair da máquina.
 */
export function criarServidor({ db, estado, acoes = {}, porta = 8770 }) {
  /**
   * Filtro de conta pras rotas do banco. A conta de uma partida é o nome do
   * jogador que é o "eu" dela. Sem `conta`, vem tudo — todas as contas dele.
   */
  const filtroConta = (conta) => conta
    ? ` AND EXISTS (SELECT 1 FROM jogadores mc WHERE mc.gameId = p.gameId AND mc.participantId = p.meuId AND mc.nome = '${String(conta).replace(/'/g, "''")}')`
    : '';

  // A chave da Riot nunca sai pro painel: nenhuma tela precisa dela, e o
  // servidor é local mas a página tem iframe e fetch de sobra pra vazar.
  const semChave = (cfg) => {
    if (!cfg) return cfg;
    return {
      ...cfg,
      riot: { ...(cfg.riot ?? {}), apiKey: '', temChave: !!cfg.riot?.apiKey },
      controle: { ...(cfg.controle ?? {}), githubToken: '', temToken: !!cfg.controle?.githubToken },
    };
  };

  const rotas = {
    '/api/estado': () => { const e = estado.instantaneo(); return { ...e, versao: VERSAO, config: semChave(e.config) }; },

    '/api/contas': () => db.prepare(`
      SELECT j.nome nome, COUNT(*) jogos, MAX(p.quando) ultima
      FROM partidas p JOIN jogadores j ON j.gameId = p.gameId AND j.participantId = p.meuId
      WHERE p.duracaoS >= 300 GROUP BY j.nome ORDER BY jogos DESC`).all(),

    '/api/resumo': (q) => {
      const fc = filtroConta(q.get('conta'));
      const g = db.prepare(`
        SELECT COUNT(*) n, SUM(p.venci) v, SUM(p.duracaoS)/3600.0 horas,
               MIN(p.quando) de, MAX(p.quando) ate
        FROM partidas p WHERE p.duracaoS >= 300${fc}`).get();
      const porRole = db.prepare(`
        SELECT p.minhaRole role, COUNT(*) n, SUM(p.venci) v FROM partidas p
        WHERE p.duracaoS >= 300${fc} GROUP BY p.minhaRole ORDER BY n DESC`).all();
      const campeoes = db.prepare(`
        SELECT p.meuCampeao campeao, COUNT(*) n, SUM(p.venci) v,
          (SELECT j.championId FROM jogadores j
           WHERE j.gameId = p.gameId AND j.participantId = p.meuId) championId,
          (SELECT COUNT(*) FROM achados a JOIN partidas p2 ON p2.gameId = a.gameId
           WHERE p2.meuCampeao = p.meuCampeao AND a.gravidade = 3) graves
        FROM partidas p WHERE p.duracaoS >= 300${fc}
        GROUP BY p.meuCampeao ORDER BY n DESC LIMIT 10`).all();
      return { geral: g, porRole, campeoes };
    },

    // Com quem você jogou (mesmo time) nas últimas N partidas: jogos e V-D com cada um; e contra quem mais jogou
    // Temporadas passadas (op.gg) + top X% estimado
    // Estatísticas de campeão por rota (a página "Champions" do op.gg): taxa, pick, ban, KDA, tier e ranking.
    '/api/meta': async (q) => {
      try { const { metaPorPosicao } = await import('../dados/meta.js'); return await metaPorPosicao({ regiao: q.get('regiao') || 'br', tier: q.get('tier') || 'emerald_plus' }); }
      catch (e) { return { erro: e.message }; }
    },
    /**
     * O meta cruzado com o seu histórico: dos campeões que você joga, quais estão
     * fortes agora, quais pioraram, e o que subiu na sua rota principal e você
     * ainda não pegou. Sem isso a tabela de meta é igual pra todo mundo.
     */
    '/api/meta-voce': async (q) => {
      try {
        const { metaPorPosicao } = await import('../dados/meta.js');
        const d = await metaPorPosicao({ regiao: q.get('regiao') || 'br', tier: q.get('tier') || 'emerald_plus' });
        const fc = filtroConta(q.get('conta'));
        const desde = new Date(Date.now() - 200 * 86400_000).toISOString();
        const linhas = db.prepare(`SELECT p.meuCampeao nome, p.minhaRole role, COUNT(*) n, SUM(p.venci) v, MAX(p.quando) ultima
          FROM partidas p WHERE p.duracaoS >= 300 AND p.quando >= ?${fc} GROUP BY p.meuCampeao, p.minhaRole`).all(desde);
        if (!linhas.length) return { vazio: true, patch: d.patch };
        const POS = { ADC: 'ADC', BOT: 'ADC', SUPORTE: 'SUPPORT', SUP: 'SUPPORT', MID: 'MID', TOP: 'TOP', JUNGLE: 'JUNGLE' };
        const chave = (s) => String(s ?? '').replace(/[^a-z]/gi, '').toLowerCase();
        // meta por rota indexado pela chave do campeão
        const porRota = {};
        for (const [pos, lista] of Object.entries(d.posicoes)) { porRota[pos] = new Map(); for (const c of lista) { porRota[pos].set(chave(c.chave ?? c.nome), c); porRota[pos].set(chave(c.nome), c); } }
        // rota principal: a mais jogada nos últimos jogos
        const porRotaMinha = {};
        for (const l of linhas) { const p = POS[l.role]; if (!p) continue; porRotaMinha[p] = (porRotaMinha[p] ?? 0) + l.n; }
        const principal = Object.entries(porRotaMinha).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'ADC';
        const manda = [], cuidado = [], jogados = new Set();
        for (const l of linhas) {
          const pos = POS[l.role]; if (!pos) continue;
          const m = porRota[pos]?.get(chave(l.nome)); if (!m) continue;
          jogados.add(`${pos}:${chave(m.chave ?? m.nome)}`);
          if (l.n < 3) continue;
          const minha = Math.round(1000 * l.v / l.n) / 10;
          const item = { id: m.id, nome: m.nome, posicao: pos, meus: { n: l.n, v: l.v, taxa: minha }, taxa: m.taxa, pick: m.pick, tier: m.tier, rank: m.rank, subiu: m.rankAntes && m.rank ? m.rankAntes - m.rank : 0 };
          const forte = (m.tier <= 1 || m.taxa >= 51.5 || (item.subiu >= 5 && m.taxa >= 49.5)) && m.tier <= 3;
          if (forte) manda.push(item);
          else if ((m.tier >= 4 || m.taxa <= 48) && l.n >= 5) cuidado.push(item);
        }
        manda.sort((a, b) => (b.meus.taxa - 50) * Math.min(b.meus.n, 20) - (a.meus.taxa - 50) * Math.min(a.meus.n, 20));
        cuidado.sort((a, b) => a.taxa - b.taxa);
        // pra testar: o que subiu ou está nível 0/1 na sua rota principal e você não joga
        const testar = (d.posicoes[principal] ?? [])
          .filter((c) => !jogados.has(`${principal}:${chave(c.chave ?? c.nome)}`) && c.pick >= 1 && (c.tier === 0 || (c.rankAntes && c.rank && c.rankAntes - c.rank >= 5)))
          .slice(0, 4)
          .map((c) => ({ id: c.id, nome: c.nome, posicao: principal, taxa: c.taxa, pick: c.pick, tier: c.tier, rank: c.rank, subiu: c.rankAntes && c.rank ? c.rankAntes - c.rank : 0 }));
        return { patch: d.patch, principal, manda: manda.slice(0, 5), cuidado: cuidado.slice(0, 4), testar };
      } catch (e) { return { erro: e.message }; }
    },

    // Quem está abusando: subindo no patch, o que o KR Mestre+ joga e aqui ninguém joga, e os coreanos.
    '/api/radar': async () => {
      try { const { radarDeAbuso } = await import('../dados/meta.js'); return await radarDeAbuso(); }
      catch (e) { return { erro: e.message }; }
    },

    '/api/temporadas-elo': async (q) => {
      const nome = q.get('nome'), tag = q.get('tag');
      if (!nome || !tag) return { temporadas: [] };
      const temporadas = await temporadasDoOpgg(nome, tag, 'br').catch(() => []);
      return { temporadas, top: topPorcento(q.get('tier'), q.get('rank')) };
    },
    // Sua página de um campeão: por split, KDA/CS, confrontos (rival), duos (parceiro de bot), itens que você mais fecha
    '/api/meu-campeao': (q) => {
      const nome = q.get('nome'); if (!nome) return { erro: 'campeão?' };
      const fc = filtroConta(q.get('conta'));
      const ps = db.prepare(`SELECT p.gameId, p.quando, p.duracaoS, p.venci, p.minhaRole, p.meuId, j.kills, j.deaths, j.assists, j.cs, j.dano, j.visao FROM partidas p JOIN jogadores j ON j.gameId = p.gameId AND j.participantId = p.meuId WHERE p.meuCampeao = ? AND p.duracaoS >= 300${fc} ORDER BY p.quando DESC`).all(nome);
      if (!ps.length) return { nome, jogos: 0 };
      const soma = (k) => ps.reduce((s, p) => s + (p[k] ?? 0), 0);
      const min = soma('duracaoS') / 60;
      const porSplit = {};
      for (const p of ps) { const t = temporadaDe(p.quando); const r = porSplit[t] ??= { temporada: t, n: 0, v: 0, k: 0, d: 0, a: 0 }; r.n++; r.v += p.venci; r.k += p.kills; r.d += p.deaths; r.a += p.assists; }
      const rivais = new Map(), duos = new Map();
      const rivalStmt = db.prepare('SELECT r.campeao FROM jogadores r JOIN jogadores eu ON eu.gameId = r.gameId AND eu.participantId = ? WHERE r.gameId = ? AND r.time <> eu.time AND r.role = eu.role LIMIT 1');
      const duoStmt = db.prepare("SELECT d.campeao FROM jogadores d JOIN jogadores eu ON eu.gameId = d.gameId AND eu.participantId = ? WHERE d.gameId = ? AND d.time = eu.time AND d.participantId <> eu.participantId AND ((eu.role = 'ADC' AND d.role = 'SUPORTE') OR (eu.role = 'SUPORTE' AND d.role = 'ADC')) LIMIT 1");
      for (const p of ps) {
        const rv = rivalStmt.get(p.meuId, p.gameId)?.campeao; if (rv) { const r = rivais.get(rv) ?? { campeao: rv, n: 0, v: 0 }; r.n++; r.v += p.venci; rivais.set(rv, r); }
        const du = duoStmt.get(p.meuId, p.gameId)?.campeao; if (du) { const r = duos.get(du) ?? { campeao: du, n: 0, v: 0 }; r.n++; r.v += p.venci; duos.set(du, r); }
      }
      const ids = ps.map((p) => p.gameId);
      const itens = ids.length ? db.prepare(`SELECT e.itemId, COUNT(DISTINCT e.gameId) n FROM eventos e JOIN partidas p ON p.gameId = e.gameId AND e.autorId = p.meuId WHERE e.tipo = 'ITEM_PURCHASED' AND e.gameId IN (${ids.map(() => '?').join(',')}) GROUP BY e.itemId ORDER BY n DESC LIMIT 40`).all(...ids) : [];
      const lista = (m) => [...m.values()].filter((r) => r.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
      return { nome, jogos: ps.length, vitorias: soma('venci'), kda: soma('deaths') ? Math.round(10 * (soma('kills') + soma('assists')) / soma('deaths')) / 10 : null, media: { k: soma('kills') / ps.length, d: soma('deaths') / ps.length, a: soma('assists') / ps.length }, csm: min ? Math.round(10 * soma('cs') / min) / 10 : null, dpm: min ? Math.round(soma('dano') / min) : null,
        porSplit: Object.values(porSplit), rivais: lista(rivais), duos: lista(duos), itens, ultimas: ps.slice(0, 10).map((p) => ({ gameId: p.gameId, venci: !!p.venci, kda: `${p.kills}/${p.deaths}/${p.assists}`, quando: p.quando })) };
    },
    '/api/companheiros': (q) => {
      const n = Math.max(5, Math.min(200, Number(q.get('n')) || 20));
      const fc = filtroConta(q.get('conta'));
      const ids = db.prepare(`SELECT p.gameId, p.meuId, p.venci FROM partidas p WHERE p.duracaoS >= 300${fc} ORDER BY p.quando DESC LIMIT ?`).all(n);
      const com = new Map(), contra = new Map();
      const sel = db.prepare('SELECT participantId, time, nome, tag, championId FROM jogadores WHERE gameId = ?');
      for (const p of ids) {
        const js = sel.all(p.gameId); const eu = js.find((j) => j.participantId === p.meuId); if (!eu) continue;
        for (const j of js) {
          if (j.participantId === p.meuId || !j.nome || j.nome === '?') continue;
          const k = `${j.nome}#${j.tag ?? ''}`;
          const m = j.time === eu.time ? com : contra;
          const r = m.get(k) ?? { nome: j.nome, tag: j.tag ?? '', jogos: 0, vitorias: 0, championId: j.championId };
          r.jogos++; if (p.venci) r.vitorias++; m.set(k, r);
        }
      }
      const lista = (m) => [...m.values()].filter((r) => r.jogos >= 2).sort((a, b) => b.jogos - a.jogos || b.vitorias - a.vitorias).slice(0, 12);
      return { n: ids.length, com: lista(com), contra: lista(contra) };
    },
    '/api/partidas': (q) => partidas(q),
    // Evolução por split: winrate, KDA, cs/min, participação, erros graves.
    '/api/temporadas': (q) => resumoPorTemporada(partidas(q)),
  };
  const partidas = (q) => db.prepare(`
      SELECT p.gameId, p.quando, p.fila, p.duracaoS, p.meuCampeao, p.minhaRole, p.venci, p.meuId,
             (SELECT COUNT(*) FROM achados a WHERE a.gameId = p.gameId) achados,
             (SELECT COUNT(*) FROM achados a WHERE a.gameId = p.gameId AND a.gravidade = 3) graves,
             (SELECT kills || '/' || deaths || '/' || assists FROM jogadores j
              WHERE j.gameId = p.gameId AND j.participantId = p.meuId) kda,
             (SELECT j.championId FROM jogadores j
              WHERE j.gameId = p.gameId AND j.participantId = p.meuId) championId,
             (SELECT j.cs FROM jogadores j
              WHERE j.gameId = p.gameId AND j.participantId = p.meuId) cs,
             (SELECT ROUND(100.0 * (j.kills + j.assists) /
                     NULLIF((SELECT SUM(t.kills) FROM jogadores t
                             WHERE t.gameId = p.gameId AND t.time = j.time), 0))
              FROM jogadores j
              WHERE j.gameId = p.gameId AND j.participantId = p.meuId) participacao,
             (SELECT r.campeao FROM jogadores r
              JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
              WHERE r.gameId = p.gameId AND r.time <> meu.time AND r.role = p.minhaRole
              LIMIT 1) rival,
             (SELECT r.championId FROM jogadores r
              JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
              WHERE r.gameId = p.gameId AND r.time <> meu.time AND r.role = p.minhaRole
              LIMIT 1) rivalId,
             (SELECT j.nome FROM jogadores j
              WHERE j.gameId = p.gameId AND j.participantId = p.meuId) conta
      FROM partidas p WHERE p.duracaoS >= 300${filtroConta(q.get('conta'))}
      ORDER BY p.quando DESC`).all().map((p, i, arr) => { if (i === 0) { faltantesNaChamada = 0; try { elosLista = elosGuardados(db); } catch { elosLista = new Map(); } } return { ...p, temporada: temporadaDe(p.quando), eloMedio: elosLista.get(p.gameId) ?? null, ...extrasDaPartida(p) }; });
  let elosLista = new Map();
  // pré-cálculo de fundo: 20 partidas por vez, sem travar o servidor
  setTimeout(function fundo() {
    try {
      const ids = db.prepare('SELECT gameId, meuId, minhaRole, duracaoS, venci FROM partidas WHERE duracaoS >= 300 ORDER BY quando DESC').all().filter((p) => !cacheExtras.has(p.gameId)).slice(0, 20);
      faltantesNaChamada = -1000;
      for (const p of ids) extrasDaPartida(p);
      if (ids.length === 20) setTimeout(fundo, 300);
    } catch { /* banco ocupado */ }
  }, 12000);
  // Nota (0–10, MVP/ACE), fase de lane em % e selos — calculados uma vez por partida e guardados em memória.
  const cacheExtras = new Map();
  let faltantesNaChamada = 0;
  function extrasDaPartida(p) {
    if (cacheExtras.has(p.gameId)) return cacheExtras.get(p.gameId);
    if (++faltantesNaChamada > 40) return {};   // o resto vem no pré-cálculo de fundo
    let r = {};
    try {
      const jogadores = db.prepare('SELECT participantId, time, role, campeao, kills, deaths, assists, cs, ouro, dano, visao FROM jogadores WHERE gameId = ?').all(p.gameId);
      const meu = jogadores.find((j) => j.participantId === p.meuId);
      if (!meu || jogadores.length < 10) { cacheExtras.set(p.gameId, r); return r; }
      const vencedor = db.prepare('SELECT vencedor FROM partidas WHERE gameId = ?').get(p.gameId)?.vencedor ?? null;
      const eventos = db.prepare("SELECT t, tipo, autorId FROM eventos WHERE gameId = ? AND tipo IN ('BUILDING_KILL','ELITE_MONSTER_KILL','CHAMPION_KILL')").all(p.gameId);
      const notas = notasDaPartida(jogadores, { duracaoS: p.duracaoS, vencedor, eventos });
      const minha = notas.get(p.meuId);
      const f15 = db.prepare('SELECT participantId, ouroTotal FROM frames WHERE gameId = ? AND minuto = (SELECT MIN(minuto) FROM frames WHERE gameId = ? AND t >= 900000)').all(p.gameId, p.gameId);
      const laning = laningPct(f15, p.meuId, jogadores, p.minhaRole);
      const danoTime = jogadores.filter((j) => j.time === meu.time).reduce((s, j) => s + (j.dano ?? 0), 0);
      const selos = selosDaPartida({ eu: { id: p.meuId }, eventos, duracaoS: p.duracaoS, venci: !!p.venci, nota: minha?.nota ?? null, dano: meu.dano ?? 0, danoTime });
      // sorte de time: nota média dos 4 aliados contra a dos 5 inimigos
      const media = (lista) => lista.length ? Math.round(10 * lista.reduce((s, x) => s + x, 0) / lista.length) / 10 : null;
      const aliados = media(jogadores.filter((j) => j.time === meu.time && j.participantId !== p.meuId).map((j) => notas.get(j.participantId)?.nota ?? 0));
      const inimigos = media(jogadores.filter((j) => j.time !== meu.time).map((j) => notas.get(j.participantId)?.nota ?? 0));
      r = { nota: minha?.nota ?? null, mvp: !!minha?.mvp, ace: !!minha?.ace, laning, selos, aliados, inimigos };
    } catch { /* partida velha sem dado */ }
    cacheExtras.set(p.gameId, r);
    return r;
  }
  Object.assign(rotas, {
    '/api/padroes': (q) => {
      const fc = filtroConta(q.get('conta'));
      const ids = `SELECT p.gameId FROM partidas p WHERE p.duracaoS >= 300${fc}`;
      return {
        tipos: db.prepare(`
          SELECT tipo, COUNT(*) n, COUNT(DISTINCT gameId) jogos FROM achados
          WHERE gameId IN (${ids}) GROUP BY tipo ORDER BY n DESC`).all(),
        zonas: db.prepare(`
          SELECT zona, COUNT(*) n FROM achados
          WHERE tipo = 'morte' AND zona IS NOT NULL AND gameId IN (${ids})
          GROUP BY zona ORDER BY n DESC LIMIT 8`).all(),
        faixas: db.prepare(`
          SELECT CASE WHEN t < 600000 THEN '0-10' WHEN t < 1200000 THEN '10-20'
                      WHEN t < 1800000 THEN '20-30' ELSE '30+' END faixa, COUNT(*) n
          FROM achados WHERE tipo = 'morte' AND gameId IN (${ids}) GROUP BY faixa`).all(),
        total: db.prepare(`SELECT COUNT(*) n FROM partidas p WHERE p.duracaoS >= 300${fc}`).get().n,
      };
    },
  });

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const enviar = (codigo, tipo, corpo) => {
      res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
      res.end(corpo);
    };

    try {
      /**
       * Ações de manutenção. Disparam e respondem na hora: puxar histórico
       * leva minutos e nenhum navegador espera tanto por uma resposta — o
       * andamento aparece na aba Atividade.
       */
      // Salvar configuração é o único POST que precisa de corpo e de resposta:
      // a tela só pode dizer "salvo" depois que o arquivo realmente foi escrito.
      if (req.method === 'POST' && url.pathname === '/api/config') {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try {
          const corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
          return enviar(200, 'application/json', JSON.stringify(semChave(await acoes.salvarConfig(corpo))));
        } catch (erro) {
          return enviar(400, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // O olho (janela escondida) viu o minimapa: posições dos inimigos.
      // Amostra do minimapa (png) pra ajustar o reconhecimento em casa.
      if (req.method === 'POST' && url.pathname === '/api/olho/foto' && acoes.olhoFoto) {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        let meta = {}; try { meta = JSON.parse(url.searchParams.get('meta') || '{}'); } catch { /* sem meta */ }
        try { await acoes.olhoFoto(Buffer.concat(pedacos), meta); } catch { /* disco cheio? segue */ }
        return enviar(200, 'application/json', '{"ok":true}');
      }
      if (req.method === 'POST' && url.pathname === '/api/olho' && acoes.olho) {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try { Promise.resolve(acoes.olho(JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}'))).catch(() => {}); } catch { /* leitura torta */ }
        return enviar(200, 'application/json', '{"ok":true}');
      }

      // O vigia de teclas viu uma tecla configurada.
      if (req.method === 'POST' && url.pathname === '/api/tecla' && acoes.tecla) {
        try { acoes.tecla(url.searchParams.get('acao')); } catch { /* ação sem efeito agora */ }
        return enviar(200, 'application/json', '{"ok":true}');
      }

      // Marcar flash de um inimigo (posição 1..5 ou nome).
      if (req.method === 'POST' && url.pathname === '/api/flash' && acoes.marcarFlash) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.marcarFlash({ posicao: url.searchParams.get('posicao'), nome: url.searchParams.get('nome') }))); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }

      // Marcar/desmarcar partida pra estudar depois.
      const mk = req.method === 'POST' && url.pathname.match(/^\/api\/marcar\/(\d+)$/);
      if (mk && acoes.marcar) return enviar(200, 'application/json', JSON.stringify(acoes.marcar(Number(mk[1]))));

      // Painel admin: quem usa e o controle. Só responde pra quem é admin
      // (o daemon confere) — pra todo o resto é 403.
      // Situações gravadas (admin): lista de partidas, uma partida, avaliação.
      if (url.pathname === '/api/situacoes/resumo' && acoes.situacoesResumo) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.situacoesResumo())); }
        catch (erro) { return enviar(403, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/novidades') {
        try {
          const txt = await readFile(join(AQUI, '..', '..', 'docs', 'melhorias.md'), 'utf8');
          const itens = txt.split(/\r?\n/).filter((l) => /^- v\d/.test(l)).slice(-15).reverse().map((l) => { const m = l.match(/^- (v[\d.]+)\s*[—-]\s*(.*)$/); return m ? { versao: m[1], texto: m[2] } : { versao: '', texto: l.slice(2) }; });
          return enviar(200, 'application/json', JSON.stringify({ itens }));
        } catch { return enviar(200, 'application/json', JSON.stringify({ itens: [] })); }
      }
      if (url.pathname === '/api/situacoes/ids' && acoes.situacoesIds) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.situacoesIds())); } catch (erro) { return enviar(500, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/situacoes' && acoes.situacoesPartidas) {
        try { const pasta = url.searchParams.get('pasta'), gameId = url.searchParams.get('gameId'); return enviar(200, 'application/json', JSON.stringify(pasta || gameId ? await acoes.situacoesDe({ pasta, gameId }) : await acoes.situacoesPartidas())); }
        catch (erro) { return enviar(403, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/overlay/ajustar' && acoes.overlayAjustar) return enviar(200, 'application/json', JSON.stringify(acoes.overlayAjustar({ ligar: url.searchParams.get('ligar') })));
      if (url.pathname === '/api/overlay/mover' && acoes.overlayMover) return enviar(200, 'application/json', JSON.stringify(acoes.overlayMover(Object.fromEntries(url.searchParams))));
      if (url.pathname === '/api/overlay/estado' && acoes.overlayEstado) return enviar(200, 'application/json', JSON.stringify(acoes.overlayEstado()));
      if (req.method === 'POST' && url.pathname === '/api/amigos/convidar' && acoes.convidarAmigo) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.convidarAmigo({ nome: url.searchParams.get('nome'), tag: url.searchParams.get('tag') }))); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (req.method === 'POST' && url.pathname === '/api/overlay/tamanho' && acoes.overlayTamanho) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.overlayTamanho(Object.fromEntries(url.searchParams)))); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (req.method === 'POST' && url.pathname === '/api/situacoes/avaliar-ultima' && acoes.avaliarUltima) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.avaliarUltima(Number(url.searchParams.get('nota'))))); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (req.method === 'POST' && url.pathname === '/api/situacoes/avaliar' && acoes.avaliarSituacao) {
        const pedacos = []; for await (const p of req) pedacos.push(p);
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.avaliarSituacao(JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}')))); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/admin/usuarios' && acoes.adminUsuarios) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.adminUsuarios())); }
        catch (erro) { return enviar(403, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/esquecer' && acoes.adminEsquecer) {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try {
          const corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
          return enviar(200, 'application/json', JSON.stringify(await acoes.adminEsquecer(corpo)));
        } catch (erro) {
          return enviar(403, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/controle' && acoes.adminGravarControle) {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try {
          const corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
          return enviar(200, 'application/json', JSON.stringify(await acoes.adminGravarControle(corpo)));
        } catch (erro) {
          return enviar(403, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // Amigos: adicionar/remover precisam de corpo e resposta.
      const am = req.method === 'POST' && url.pathname.match(/^\/api\/amigo\/(adicionar|remover)$/);
      if (am) {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try {
          const corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
          const acao = am[1] === 'adicionar' ? acoes.adicionarAmigo : acoes.removerAmigo;
          return enviar(200, 'application/json', JSON.stringify(await acao(corpo)));
        } catch (erro) {
          return enviar(400, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }
      if (url.pathname === '/api/amigo' && acoes.amigoPerfil) {
        try {
          return enviar(200, 'application/json', JSON.stringify(await acoes.amigoPerfil({
            nome: url.searchParams.get('nome'), tag: url.searchParams.get('tag'), forcar: url.searchParams.get('forcar') === '1',
          })));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // Aplicar uma página da tela de builds: precisa do corpo e da resposta,
      // porque o botão tem que dizer se deu certo ou por que não deu.
      if (req.method === 'POST' && url.pathname === '/api/aplicar-runas') {
        const pedacos = [];
        for await (const p of req) pedacos.push(p);
        try {
          const corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
          return enviar(200, 'application/json', JSON.stringify(await acoes.aplicarRunasDaBuild(corpo)));
        } catch (erro) {
          return enviar(400, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      if (req.method === 'POST' && (url.pathname === '/api/backup' || url.pathname === '/api/restaurar' || url.pathname === '/api/diagnostico')) {
        const fn = acoes[url.pathname.slice(5)];
        if (!fn) return enviar(404, 'application/json', JSON.stringify({ erro: 'só no app instalado' }));
        try { return enviar(200, 'application/json', JSON.stringify(await fn())); }
        catch (erro) { return enviar(500, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (req.method === 'POST' && url.pathname === '/api/atualizar' && acoes.atualizar) {
        return enviar(200, 'application/json', JSON.stringify(await acoes.atualizar()));
      }

      if (req.method === 'POST') {
        const nome = url.pathname.replace('/api/', '');
        const acao = acoes[nome];
        if (!acao) return enviar(404, 'application/json', JSON.stringify({ erro: 'ação desconhecida' }));

        const args = nome === 'historico'
          ? [Number(url.searchParams.get('quantas') ?? 250), Number(url.searchParams.get('fila') ?? 420)]
          : [];

        Promise.resolve(acao(...args)).catch((erro) => estado?.log(`falhou: ${erro.message}`));
        return enviar(202, 'application/json', JSON.stringify({ iniciado: nome }));
      }

      // Ícone redondo do minimapa da skin (o olho usa esse; o quadrado do campeão base não bate com skin)
      const cc = url.pathname.match(/^\/circulo\/(\d+)\/(\d+)(?:\/(ass|slay))?$/);
      if (cc && acoes.circulo) {
        try {
          const corpo = await acoes.circulo(Number(cc[1]), Number(cc[2]), cc[3] ?? '');
          if (!corpo) return enviar(404, 'text/plain', 'sem ícone');
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
          return res.end(corpo);
        } catch { return enviar(404, 'text/plain', 'sem ícone'); }
      }
      // Ícone de campeão, servido pelo próprio client — nada vem da internet.
      const ic = url.pathname.match(/^\/icone\/(\d+)$/);
      if (ic && acoes.icone) {
        try {
          const { corpo, tipo } = await acoes.icone(Number(ic[1]));
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=86400' });
          return res.end(corpo);
        } catch {
          return enviar(404, 'text/plain', 'sem ícone');
        }
      }

      // Imagens de item, runa e feitiço (Data Dragon, guardadas em disco).
      const im = url.pathname.match(/^\/(item|runa|feitico)\/(\d+)$/);
      if (im) {
        const acao = { item: 'imagemItem', runa: 'imagemRuna', feitico: 'imagemFeitico' }[im[1]];
        try {
          const { corpo, tipo } = await acoes[acao](Number(im[2]));
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=604800' });
          return res.end(corpo);
        } catch {
          return enviar(404, 'text/plain', 'sem imagem');
        }
      }

      // Builds de um campeão: /api/builds?campeao=Rengar&role=jungle
      if (url.pathname === '/api/builds' && acoes.builds) {
        try {
          return enviar(200, 'application/json', JSON.stringify(await acoes.builds({
            campeao: url.searchParams.get('campeao'), role: url.searchParams.get('role') || null,
          })));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // Voz do coach (neural do Edge): lista de vozes e o mp3 de uma frase.
      if (url.pathname === '/api/voz/falas' && acoes.vozFalas) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.vozFalas())); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/voz/vozes' && acoes.vozVozes) {
        try { return enviar(200, 'application/json', JSON.stringify(await acoes.vozVozes())); }
        catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }
      if (url.pathname === '/api/voz/falar' && acoes.vozFalar) {
        try {
          const { corpo, tipo } = await acoes.vozFalar({ texto: url.searchParams.get('texto') ?? '', voz: url.searchParams.get('voz') || null, ritmo: url.searchParams.get('ritmo') || null, perigo: url.searchParams.get('perigo') === '1' });
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
          return res.end(corpo);
        } catch (erro) { return enviar(400, 'application/json', JSON.stringify({ erro: erro.message })); }
      }

      // Retrato do perfil (ícone de invocador).
      const ip = url.pathname.match(/^\/iconeperfil\/(\d+)$/);
      if (ip && acoes.iconePerfil) {
        try {
          const { corpo, tipo } = await acoes.iconePerfil(Number(ip[1]));
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=604800' });
          return res.end(corpo);
        } catch {
          return enviar(404, 'text/plain', 'sem ícone de perfil');
        }
      }

      // Uma nota de atualização específica: /api/patch/{slug}
      const pn = url.pathname.match(/^\/api\/patch\/([a-zA-Z0-9-]+)$/);
      if (pn && acoes.patchNota) {
        try {
          return enviar(200, 'application/json', JSON.stringify(await acoes.patchNota(pn[1])));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // Arte do campeão, pro visual das telas. Baixada uma vez e guardada.
      const ar = url.pathname.match(/^\/arte\/(\d+)$/);
      if (ar && acoes.arte) {
        try {
          const { corpo, tipo } = await acoes.arte(Number(ar[1]));
          res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'max-age=604800' });
          return res.end(corpo);
        } catch {
          return enviar(404, 'text/plain', 'sem arte');
        }
      }

      // Análise completa de uma partida: mapas, contexto e prioridades.
      const det = url.pathname.match(/^\/api\/detalhe\/(\d+)$/);
      if (det && acoes.detalhe) {
        try {
          return enviar(200, 'application/json', JSON.stringify(await acoes.detalhe(Number(det[1]))));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      // Detalhe de uma partida: /api/partida/{gameId}
      const m = url.pathname.match(/^\/api\/partida\/(\d+)$/);
      if (m) {
        const gameId = Number(m[1]);
        return enviar(200, 'application/json', JSON.stringify({
          partida: db.prepare('SELECT * FROM partidas WHERE gameId = ?').get(gameId),
          jogadores: db.prepare('SELECT * FROM jogadores WHERE gameId = ? ORDER BY participantId').all(gameId),
          achados: db.prepare('SELECT * FROM achados WHERE gameId = ? ORDER BY t').all(gameId),
        }));
      }

      // Rotas que dependem do daemon (arquivo em disco ou client) são async.
      if (url.pathname === '/api/config' && acoes.lerConfig) {
        return enviar(200, 'application/json', JSON.stringify(semChave(await acoes.lerConfig())));
      }
      if (url.pathname === '/api/vivo' && acoes.vivo) {
        return enviar(200, 'application/json', JSON.stringify(await acoes.vivo()));
      }
      if (url.pathname === '/api/campeoes' && acoes.campeoes) {
        return enviar(200, 'application/json', JSON.stringify(await acoes.campeoes()));
      }

      // Rotas que dependem de rede respondem erro em JSON em vez de derrubar a
      // tela: sem internet o painel continua servindo tudo o que é local.
      for (const [caminho, nome] of [
        ['/api/perfil', 'perfil'],
        ['/api/estatisticas', 'estatisticas'],
        ['/api/sugestoes', 'sugestoes'],
        ['/api/patch', 'patchLista'],
        ['/api/amigos', 'amigos'],
        ['/api/sessao', 'sessao'],
        ['/api/nicks', 'nicks'],
        ['/api/marcadas', 'marcadas'],
      ]) {
        if (url.pathname !== caminho || !acoes[nome]) continue;
        try {
          const opcoes = { forcar: url.searchParams.get('forcar') === '1', conta: url.searchParams.get('conta') || null, q: url.searchParams.get('q') || '' };
          return enviar(200, 'application/json', JSON.stringify(await acoes[nome](opcoes)));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      if (rotas[url.pathname]) {
        return enviar(200, 'application/json', JSON.stringify(await rotas[url.pathname](url.searchParams)));
      }

      // Emblemas de elo recortados do client (scripts/emblemas.cjs), no pacote.
      const em = url.pathname.match(/^\/emblema\/([a-z]+)\.png$/);
      if (em) {
        try {
          const png = await readFile(join(AQUI, 'emblemas', `${em[1]}.png`));
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
          return res.end(png);
        } catch { return enviar(404, 'text/plain', 'sem emblema'); }
      }
      if (url.pathname === '/olho') {
        return enviar(200, 'text/html; charset=utf-8', await readFile(join(AQUI, 'olho.html'), 'utf8'));
      }
      if (url.pathname === '/identidade.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(await readFile(join(AQUI, 'identidade.css'), 'utf8'));
      }
      if (url.pathname === '/minimapa.png') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
        return res.end(await readFile(join(AQUI, 'minimapa.png')));
      }
      if (url.pathname === '/overlay') {
        return enviar(200, 'text/html; charset=utf-8', await readFile(join(AQUI, 'overlay.html'), 'utf8'));
      }
      if (url.pathname === '/voz') {
        return enviar(200, 'text/html; charset=utf-8', await readFile(join(AQUI, 'voz.html'), 'utf8'));
      }
      if (url.pathname === '/vivo') {
        return enviar(200, 'text/html; charset=utf-8', await readFile(join(AQUI, 'vivo.html'), 'utf8'));
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return enviar(200, 'text/html; charset=utf-8', await readFile(join(AQUI, 'painel.html'), 'utf8'));
      }
      enviar(404, 'text/plain; charset=utf-8', 'não encontrado');
    } catch (erro) {
      enviar(500, 'application/json', JSON.stringify({ erro: erro.message }));
    }
  });

  // Se a porta estiver ocupada (uma instância anterior que não morreu direito,
  // por exemplo), sobe na próxima em vez de derrubar o app inteiro.
  return new Promise((resolve, reject) => {
    let tentativa = porta;

    const tentar = () => {
      servidor.once('error', (erro) => {
        if (erro.code === 'EADDRINUSE' && tentativa < porta + 10) {
          tentativa++;
          setImmediate(tentar);
        } else {
          reject(erro);
        }
      });
      servidor.listen(tentativa, '127.0.0.1', () => {
        resolve({ servidor, porta: tentativa, url: `http://127.0.0.1:${tentativa}` });
      });
    };
    tentar();
  });
}

/** Estado ao vivo do daemon, pra UI mostrar o que está acontecendo. */
export function criarEstado({ aoAvisar } = {}) {
  const linhas = [];
  const dados = { conectado: false, conta: null, fase: null, config: null };

  const fila = []; let gravando = false;
  return {
    set(chave, valor) { dados[chave] = valor; },
    // Notificação do Windows — quem decide se pode (fora de partida) é o main.
    avisar(titulo, texto) { try { aoAvisar?.(titulo, texto, dados.fase); } catch { /* sem notificação */ } },
    log(texto) {
      const em = new Date().toISOString();
      linhas.unshift({ em, texto });
      if (linhas.length > 200) linhas.pop();
      // Também em disco (dados/registro.log, vira registro.1.log com 2 MB): o registro na memória some quando o app
      // reinicia, e é ele que explica o que aconteceu numa partida de ontem
      try {
        const arq = join(pastaBase(), 'dados', 'registro.log');
        fila.push(`${em} ${texto}\n`);
        if (!gravando) { gravando = true; setTimeout(async () => { const bloco = fila.join(''); fila.length = 0; try { await mkdir(dirname(arq), { recursive: true }); const st = await stat(arq).catch(() => null); if (st && st.size > 2 * 1024 * 1024) await rename(arq, arq.replace(/.log$/, '.1.log')).catch(() => {}); await appendFile(arq, bloco); } catch { /* disco */ } gravando = false; }, 1500); }
      } catch { /* sem disco */ }
    },
    instantaneo: () => ({ ...dados, log: linhas.slice(0, 60) }),
  };
}
