import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));

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

  const rotas = {
    '/api/estado': () => estado.instantaneo(),

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

    '/api/partidas': (q) => db.prepare(`
      SELECT p.gameId, p.quando, p.fila, p.duracaoS, p.meuCampeao, p.minhaRole, p.venci,
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
      ORDER BY p.quando DESC`).all(),

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
  };

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
          return enviar(200, 'application/json', JSON.stringify(await acoes.salvarConfig(corpo)));
        } catch (erro) {
          return enviar(400, 'application/json', JSON.stringify({ erro: erro.message }));
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
        return enviar(200, 'application/json', JSON.stringify(await acoes.lerConfig()));
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
      ]) {
        if (url.pathname !== caminho || !acoes[nome]) continue;
        try {
          const opcoes = { forcar: url.searchParams.get('forcar') === '1', conta: url.searchParams.get('conta') || null };
          return enviar(200, 'application/json', JSON.stringify(await acoes[nome](opcoes)));
        } catch (erro) {
          return enviar(503, 'application/json', JSON.stringify({ erro: erro.message }));
        }
      }

      if (rotas[url.pathname]) {
        return enviar(200, 'application/json', JSON.stringify(rotas[url.pathname](url.searchParams)));
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
export function criarEstado() {
  const linhas = [];
  const dados = { conectado: false, conta: null, fase: null, config: null };

  return {
    set(chave, valor) { dados[chave] = valor; },
    log(texto) {
      linhas.unshift({ em: new Date().toISOString(), texto });
      if (linhas.length > 200) linhas.pop();
    },
    instantaneo: () => ({ ...dados, log: linhas.slice(0, 60) }),
  };
}
