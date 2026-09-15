import { LcuClient } from './lcu/client.js';
import { carregarConfig } from './config.js';
import { autoAceitar } from './features/auto-aceitar.js';
import { autoChampSelect } from './features/champ-select.js';
import { abrirBanco } from './dados/banco.js';
import { coletarPendentes } from './dados/coletor.js';
import { readFile, writeFile } from 'node:fs/promises';
import { caminhoConfig, caminhoCampeoes, pastaBase } from './caminhos.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { release as versaoDoWindows } from 'node:os';
import * as Controle from './dados/controle.js';

/**
 * Liga tudo: aceitar fila, seleção de campeão, runas e coleta.
 * Recebe um `estado` (de src/ui/servidor.js) pra reportar o que está fazendo,
 * e devolve as alças pra quem chamou poder fechar depois.
 */
async function versaoDoApp() {
  try { return JSON.parse(await readFile(resolve(fileURLToPath(import.meta.url), '..', '..', 'package.json'), 'utf8')).version; } catch { return '?'; }
}

export async function iniciarDaemon({ estado, config: configDada, aoSelecionar, aoFase } = {}) {
  const config = configDada ?? await carregarConfig();
  const lcu = new LcuClient();
  const db = abrirBanco();

  // Contadores de uso pro painel admin: quantas vezes o app agiu por você.
  const arquivoUso = () => resolve(pastaBase(), 'dados', 'uso.json');
  let uso = { aceitas: 0, travadas: 0, banidas: 0 };
  readFile(arquivoUso(), 'utf8').then((t) => { uso = { ...uso, ...JSON.parse(t) }; }).catch(() => {});
  const contar = (chave) => { uso[chave] = (uso[chave] ?? 0) + 1; writeFile(arquivoUso(), JSON.stringify(uso), 'utf8').catch(() => {}); };

  const log = (texto) => {
    estado?.log(texto);
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, texto);
    if (texto === 'partida aceita') { contar('aceitas'); estado?.avisar?.('Partida aceita', 'a fila achou partida — volta pro League'); }
    else if (texto.startsWith('travou ')) contar('travadas');
    else if (texto.startsWith('baniu ')) contar('banidas');
  };

  estado?.set('config', config);

  lcu.on('conectado', async (c) => {
    estado?.set('conectado', true);
    log(`conectado ao client (porta ${c.porta})`);
    const eu = await lcu.get('/lol-summoner/v1/current-summoner').catch(() => null);
    if (eu) {
      estado?.set('conta', `${eu.gameName}#${eu.tagLine}`);
      log(`conta: ${eu.gameName}#${eu.tagLine}`);
      // Primeira execução de alguém novo: o config nasce do modelo, sem conta.
      // A conta é a de quem está logado — e fica gravada pra próxima vez.
      if (!config.riot?.gameName) {
        await salvarConfig({ riot: { gameName: eu.gameName, tagLine: eu.tagLine } }).catch(() => {});
        log(`conta ${eu.gameName}#${eu.tagLine} gravada na configuração`);
      }
      // Toda conta que já logou fica com a tag lembrada: o banco só guarda o
      // nome, e a Riot exige nome#tag pra dar o elo de uma conta secundária.
      lembrarTag(eu.gameName, eu.tagLine).catch(() => {});
    }
  });

  const arquivoTags = () => resolve(pastaBase(), 'dados', 'contas.json');
  async function tagsConhecidas() {
    try { return JSON.parse(await readFile(arquivoTags(), 'utf8')); } catch { return {}; }
  }
  async function lembrarTag(nome, tag) {
    if (!nome || !tag) return;
    const tags = await tagsConhecidas();
    if (tags[nome] === tag) return;
    tags[nome] = tag;
    await writeFile(arquivoTags(), JSON.stringify(tags, null, 2), 'utf8');
  }

  lcu.on('desconectado', () => {
    estado?.set('conectado', false);
    log('client fechou — esperando reabrir...');
  });
  lcu.on('falha', (erro) => log(`client não respondeu (${erro.message}) — continuo tentando`));

  /* ----------------------------------------------------------- controle */
  /**
   * O painel admin do Gabriel: um repositório privado no GitHub diz quem
   * pode usar e o que está desligado. Este app lê isso ao abrir e a cada 10
   * minutos, e se apresenta (check-in) ao abrir e a cada hora. Sem token
   * (versão sem chave embutida) nada disso roda e tudo fica liberado.
   */
  const versao = await versaoDoApp();
  const tokenControle = () => config.controle?.githubToken ?? null;
  let avaliacao = Controle.avaliar(Controle.CONTROLE_PADRAO, {});
  const permite = (funcao) => avaliacao.permite(funcao);

  // Id da instalação: nasce uma vez e fica no config, pra bloquear/liberar
  // alguém mesmo antes de ele logar no client.
  if (!config.instalacaoId) {
    config.instalacaoId = randomUUID().slice(0, 8);
    await salvarConfig({ instalacaoId: config.instalacaoId }).catch(() => {});
  }
  const quemSou = () => ({ id: config.instalacaoId, conta: estado?.instantaneo?.().conta ?? null, versao });

  async function sincronizarControle() {
    const token = tokenControle();
    if (!token) return;
    try {
      const controle = await Controle.lerControle(token);
      const antes = avaliacao;
      avaliacao = Controle.avaliar(controle, quemSou());
      estado?.set('controle', {
        bloqueado: avaliacao.bloqueado, aviso: avaliacao.aviso, desligadas: avaliacao.desligadas,
        desatualizado: avaliacao.desatualizado, versaoMinima: avaliacao.versaoMinima,
        textos: avaliacao.textos, tema: avaliacao.tema, estilos: avaliacao.estilos, popup: avaliacao.popup,
      });
      if (avaliacao.bloqueado && !antes.bloqueado) log('acesso desligado pelo painel de controle');
      if (!avaliacao.bloqueado && antes.bloqueado) log('acesso liberado pelo painel de controle');
      if (avaliacao.desligadas.join() !== antes.desligadas.join()) log(avaliacao.desligadas.length ? `desligado pelo painel: ${avaliacao.desligadas.join(', ')}` : 'painel: tudo ligado de novo');
    } catch (erro) {
      log(`controle: não consegui ler (${erro.message})`);
    }
  }

  async function apresentar() {
    const token = tokenControle();
    if (!token || process.env.LOLCOACH_DEV) return;   // o dev server não é um usuário
    try {
      const tags = await tagsConhecidas();
      const partidas = db.prepare('SELECT COUNT(*) n FROM partidas').get().n;
      const eu = quemSou();
      await Controle.checkIn(token, eu.id, {
        conta: eu.conta, versao, vistoEm: new Date().toISOString(),
        contas: [...new Set([eu.conta, ...Object.entries(tags).map(([n, tg]) => `${n}#${tg}`)].filter(Boolean))],
        so: Number(versaoDoWindows().split('.')[2]) >= 22000 ? 'Windows 11' : 'Windows 10', partidas,
        uso, registro: (estado?.instantaneo?.().log ?? []).slice(0, 40).map((l) => `${String(l.em).slice(11, 19)} ${l.texto}`),
      });
    } catch (erro) {
      log(`controle: não consegui me apresentar (${erro.message})`);
    }
  }

  sincronizarControle().then(apresentar);
  setInterval(sincronizarControle, 10 * 60 * 1000);
  setInterval(apresentar, 60 * 60 * 1000);
  // Logou no client: agora sei a conta — reavalia e apresenta de novo.
  lcu.on('conectado', () => setTimeout(() => sincronizarControle().then(apresentar), 5_000));

  /* ---- painel admin (só pra quem tem admin: true no config) ---- */
  const exigirAdmin = () => {
    if (config.admin !== true) throw new Error('só o admin pode fazer isto');
    if (!tokenControle()) throw new Error('sem token do controle nesta versão');
    return tokenControle();
  };
  async function adminUsuarios() {
    const token = exigirAdmin();
    const [usuarios, controle, downloads] = await Promise.all([
      Controle.listarUsuarios(token), Controle.lerControle(token), Controle.downloadsDoInstalador().catch(() => []),
    ]);
    return { usuarios, controle, downloads, eu: quemSou() };
  }
  async function adminEsquecer({ id } = {}) {
    const token = exigirAdmin();
    if (!id || id === config.instalacaoId) throw new Error('id inválido');
    await Controle.esquecerUsuario(token, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
    return { ok: true };
  }
  async function adminGravarControle(novo) {
    const token = exigirAdmin();
    const atual = await Controle.lerControle(token);
    const controle = { ...atual, ...novo };
    await Controle.gravarControle(token, controle);
    log('painel: controle gravado');
    await sincronizarControle();
    return controle;
  }

  // Registrados sempre, lendo a configuração viva: ligar e desligar pela tela
  // não pode exigir reabrir o programa.
  autoAceitar(lcu, {
    ativo: () => config.autoAceitar.ativo !== false && permite('aceitar'),
    atrasoMs: () => config.autoAceitar.atrasoMs ?? 0,
    aoAceitar: (erro) => log(erro ? `falha ao aceitar: ${erro.message}` : 'partida aceita'),
    log,
  });

  autoChampSelect(lcu, config, { log, permite });

  /* ------------------------------------------------------------- coleta */
  let coletando = false;

  // O histórico do client demora alguns segundos pra registrar a partida que
  // acabou, então tentamos algumas vezes antes de desistir.
  async function coletar({ tentativas = 6, esperaMs = 10_000 } = {}) {
    if (coletando || !config.coleta.ativo) return;
    coletando = true;
    try {
      for (let i = 1; i <= tentativas; i++) {
        // Ele usa mais de uma conta e quer as partidas de todas no banco. A conta
        // de cada partida fica em jogadores.nome (do meuId); as telas filtram.
        const salvos = await coletarPendentes(lcu, db, { quantas: 20 });
        if (salvos.length) {
          for (const s of salvos) log(`coletada ${s.gameId}: ${s.campeao} ${s.role} ${s.venci ? 'V' : 'D'} — ${s.achados} achados (${s.graves} graves)`);
          // O elo mudou: relê agora, pra curva de PDL e o saldo do dia.
          setTimeout(() => perfil({ forcar: true }).catch(() => {}), 8_000);
          return salvos;
        }
        if (i < tentativas) await new Promise((r) => setTimeout(r, esperaMs));
      }
    } catch (erro) {
      log(`erro ao coletar: ${erro.message}`);
    } finally {
      coletando = false;
    }
    return [];
  }

  let faseAnterior = null;
  lcu.observar('/lol-gameflow/v1/gameflow-phase', (fase) => {
    if (fase === faseAnterior) return;
    estado?.set('fase', fase);
    log(`fase: ${fase}`);
    // A janela ao vivo abre na seleção, nunca com o jogo rodando: mexer em
    // janela durante a partida rouba o foco e minimiza o jogo em tela cheia.
    if (fase === 'ChampSelect') aoSelecionar?.();
    aoFase?.(fase);
    if (faseAnterior === 'EndOfGame' || (faseAnterior === 'InProgress' && fase === 'None')) coletar();
    faseAnterior = fase;
  });

  const total = db.prepare('SELECT COUNT(*) n FROM partidas').get().n;
  log(`LolCoach v${await versaoDoApp()} — banco com ${total} partidas`);

  /**
   * A conexão com o client NÃO pode bloquear a inicialização.
   *
   * `lcu.conectar()` fica tentando indefinidamente enquanto o League estiver
   * fechado — e isso é o certo pro daemon. Mas dar `await` aqui fazia o app
   * inteiro travar antes de criar a janela: abrir o LolCoach sem o League
   * aberto deixava o processo vivo, sem janela e sem painel, pra sempre.
   *
   * Agora tudo sobe na hora e a conexão acontece em segundo plano.
   */
  lcu.conectar()
    .then(async () => {
      const fase = await lcu.get('/lol-gameflow/v1/gameflow-phase').catch(() => null);
      estado?.set('fase', fase);
      faseAnterior = fase;
      aoFase?.(fase);   // a janela principal espera por isto pra saber se pode aparecer
      if (fase === 'ChampSelect') aoSelecionar?.();
      await coletar({ tentativas: 1 });
    })
    .catch((erro) => log(`não consegui falar com o client: ${erro.message}`));

  /* ------------------------------------------- manutenção sob demanda */
  // Uma tarefa pesada por vez: as duas escrevem no mesmo banco.
  let ocupado = null;

  const tarefa = (nome, fn) => async (...args) => {
    if (ocupado) throw new Error(`já estou ${ocupado} — espere terminar`);
    ocupado = nome;
    estado?.set('tarefa', nome);
    try {
      return await fn(...args);
    } finally {
      ocupado = null;
      estado?.set('tarefa', null);
    }
  };

  const reprocessar = tarefa('reprocessando', async (fila = null) => {
    const { reprocessarTudo } = await import('./dados/reprocessar.js');
    log('reprocessando os detectores em cima do banco...');
    const r = reprocessarTudo(db, { fila, aoProgresso: (p) => log(`reprocessando ${p.feitas}/${p.de}...`) });
    log(`reprocessadas ${r.feitas} partidas, ${r.total} achados, ${r.erros} erros`);
    return r;
  });

  const historico = tarefa('puxando histórico', async (quantas = 250, fila = 420) => {
    if (!config.riot?.apiKey) throw new Error('sem chave da Riot no config.json');
    const [{ RiotApi }, { backfillHistorico }] = await Promise.all([
      import('./dados/riot.js'), import('./dados/historico.js'),
    ]);
    log(`puxando até ${quantas} partidas da fila ${fila} pela API da Riot...`);
    const r = await backfillHistorico(new RiotApi(config.riot), db, {
      quantas, fila,
      gameName: config.riot.gameName, tagLine: config.riot.tagLine,
      aoContar: (c) => log(`${c.naLista} na lista, ${c.aProcessar} a processar`),
      aoSalvar: (s) => { if (s.indice % 25 === 0) log(`histórico ${s.indice}/${s.de}...`); },
    });
    log(`histórico: ${r.ok} salvas, ${r.falhas} falhas`);
    return r;
  });

  /**
   * Análise completa de uma partida, pro painel mostrar mapas e prioridades.
   * Busca na API da Riot porque os campos que dão profundidade (vida por
   * minuto, dano por magia, recompensa) não existem no que o banco guardou.
   * Fica em cache: reabrir a mesma partida não gasta chamada.
   */
  const cacheDetalhe = new Map();

  async function detalhe(gameId) {
    const chave = Number(gameId);
    if (cacheDetalhe.has(chave)) return cacheDetalhe.get(chave);

    const linha = db.prepare('SELECT * FROM partidas WHERE gameId = ?').get(chave);
    if (!linha) throw new Error('partida não está no banco');
    if (!config.riot?.apiKey) throw new Error('sem chave da Riot — o detalhe depende dela');

    const [{ RiotApi, carregarPartidaDaRiot }, { analisar }, { detalharPartida }, { desenharMinimapa }, { zonaRelativa }] =
      await Promise.all([
        import('./dados/riot.js'), import('./analise/detectores.js'),
        import('./analise/detalhe.js'), import('./analise/minimapa.js'), import('./analise/mapa.js'),
      ]);

    const matchId = linha.matchId ?? `${String(config.riot.regiao ?? 'br1').toUpperCase()}_${chave}`;
    const p = await carregarPartidaDaRiot(new RiotApi(config.riot), matchId);
    const eu = p.jogadores.find((j) => j.id === linha.meuId) ?? p.jogadores.find((j) => j.nome === config.riot.gameName);
    if (!eu) throw new Error('não achei você entre os jogadores');

    const d = detalharPartida(p, eu, analisar(p, eu));
    const { preencherResolucoes, fichaDoConfronto } = await import('./analise/resolucao.js');
    const opcoesRes = { regiao: config.runas?.regiao ?? 'br' };
    await preencherResolucoes(p, eu, d.achados, opcoesRes);
    const confronto = await fichaDoConfronto(p, eu, opcoesRes).catch(() => null);

    const resultado = {
      gameId: chave,
      quando: linha.quando,
      fila: linha.fila,
      resumo: d.resumo,
      prioridades: d.prioridades,
      confronto,
      eu: { id: eu.id, campeao: eu.campeao, championId: eu.championId, role: eu.role, time: eu.time },
      jogadores: p.jogadores.map((j) => ({
        id: j.id, time: j.time, campeao: j.campeao, championId: j.championId,
        nome: j.nome, role: j.role,
        kills: j.stats.kills, deaths: j.stats.deaths, assists: j.stats.assists,
        cs: j.stats.totalMinionsKilled + j.stats.neutralMinionsKilled,
        dano: j.stats.totalDamageDealtToChampions, visao: j.stats.visionScore,
      })),
      achados: d.achados.map((a) => {
        const frame = p.frameEm(a.t);
        const i = p.frames.indexOf(frame);
        // frame 0 = todos parados na base no instante inicial; nao serve de origem
        const anterior = i - 1 > 0 ? p.frames[i - 1] : null;
        const mortos = p.jogadores.filter((j) => !p.vivo(j.id, a.t)).map((j) => j.id);
        return {
          t: a.t, tipo: a.tipo, gravidade: a.gravidade, titulo: a.titulo,
          motivos: a.motivos, contexto: a.contexto, narrativa: a.narrativa ?? [], resolucao: a.resolucao ?? null,
          zona: a.pos ? zonaRelativa(a.pos, eu.time) : null,
          mapa: desenharMinimapa({
            pos: frame.pos,
            posAntes: anterior?.pos ?? null,
            jogadores: p.jogadores, eu,
            evento: a.pos, culpados: a.culpados, mortos,
            // Os retratos vêm do próprio client, pela rota que o painel expõe.
            iconeSrc: (id) => `/icone/${id}`,
            legenda: `setas = deslocamento no minuto anterior`,
          }),
        };
      }),
    };

    cacheDetalhe.set(chave, resultado);
    return resultado;
  }

  /* -------------------------------------------------------- partida ao vivo */

  // O perfil sai do banco e não muda durante a partida; refazer a cada 2s seria
  // desperdício. Guardado por role, que é o que muda de jogo pra jogo.
  const perfis = new Map();

  // Tudo que é "desta partida": fichas dos adversários (montadas uma vez) e a
  // memória do rastreio (eventos já lidos, itens e níveis da última leitura).
  // Zera quando o relógio do jogo volta pra trás — é uma partida nova.
  let partidaVivo = null;

  async function vivo() {
    const [{ lerEstado }, { montarPerfil }, { montarConselhos }, { fichasDaPartida }, R] = await Promise.all([
      import('./vivo/jogo-vivo.js'), import('./vivo/perfil.js'), import('./vivo/conselhos.js'),
      import('./vivo/confronto-vivo.js'), import('./vivo/rastreio.js'),
    ]);

    const estado = await lerEstado();
    if (!estado?.eu) { partidaVivo = null; return { emJogo: false }; }

    const role = estado.eu.role || 'geral';
    if (!perfis.has(role)) {
      const mapa = { top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', sup: 'SUPORTE' };
      perfis.set(role, montarPerfil(db, { role: mapa[role] ?? null, campeao: estado.eu.campeao }));
    }
    const perfil = perfis.get(role);

    if (!partidaVivo || estado.tempo < partidaVivo.memoria.ultimoTempo - 5) {
      partidaVivo = { memoria: R.novaMemoria(), fichas: null, montandoFichas: null };
    }

    // As fichas dependem de rede (op.gg, Data Dragon) e do banco: montam uma
    // vez, em segundo plano, e a tela mostra assim que ficarem prontas.
    if (!partidaVivo.fichas && !partidaVivo.montandoFichas) {
      partidaVivo.montandoFichas = fichasDaPartida(db, estado, { regiao: config.runas?.regiao ?? 'br' })
        .then((f) => { partidaVivo.fichas = f; })
        .catch((erro) => { log(`ficha dos adversários falhou: ${erro.message}`); partidaVivo.fichas = []; });
    }

    const { objetivos } = await import('./vivo/objetivos.js');
    const rastreio = R.rastrear(estado, partidaVivo.memoria);
    const conselhos = [...rastreio.avisos, ...montarConselhos(estado, perfil)]
      .sort((a, b) => b.urgencia - a.urgencia);

    return {
      emJogo: true, estado, perfil, conselhos,
      contra: partidaVivo.fichas ?? [],
      vistos: rastreio.vistos,
      objetivos: objetivos(estado),
    };
  }

  /* ------------------------------------------------ configuração pela tela */

  /**
   * Lista de campeões pro seletor. Vem do client, mas fica guardada em disco:
   * assim a tela de configuração funciona com o League fechado, que é
   * justamente quando dá vontade de mexer nas listas de pick e ban.
   */
  async function campeoes() {
    const cache = caminhoCampeoes();
    try {
      const lista = await lcu.get('/lol-game-data/assets/v1/champion-summary.json');
      // O client devolve também as versões de Swarm/Arena, com id inflado
      // (Ahri = 103 e 60103). Sem esse corte a grade vem com tudo em dobro.
      const limpa = lista.filter((c) => c.id > 0 && c.id < 3000)
        .map((c) => ({ id: c.id, nome: c.name }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      await writeFile(cache, JSON.stringify(limpa), 'utf8').catch(() => {});
      return limpa;
    } catch {
      // Sem client: tenta o cache em disco e, por último, os campeões que já
      // apareceram nas partidas coletadas — não é a lista inteira, mas é
      // bem melhor que uma tela vazia.
      try { return JSON.parse(await readFile(cache, 'utf8')); } catch { /* sem cache */ }
      try {
        const { listaDeCampeoes } = await import('./dados/ddragon.js');
        const lista = await listaDeCampeoes();
        if (lista.length) return lista;
      } catch { /* sem Data Dragon também */ }
      try {
        // Partidas de modos alternativos (Arena, Swarm) gravam o mesmo campeão
        // com id inflado (Ahri = 103 e 60103), o que duplicava a grade inteira.
        return db.prepare(`
          SELECT MIN(championId) id, campeao nome FROM jogadores
          WHERE championId BETWEEN 1 AND 3000
          GROUP BY campeao ORDER BY campeao`).all();
      } catch { return []; }
    }
  }

  const lerConfig = async () => carregarConfig();

  /**
   * Grava o config.json e aplica no que já está rodando.
   * Mescla por cima do arquivo existente pra não apagar os campos `_leia`
   * que explicam cada opção.
   */
  async function salvarConfig(novo) {
    const caminho = caminhoConfig();
    let atual = {};
    try { atual = JSON.parse(await readFile(caminho, 'utf8')); } catch { /* arquivo novo */ }

    for (const [chave, valor] of Object.entries(novo ?? {})) {
      if (chave.startsWith('_')) continue;
      atual[chave] = (valor && typeof valor === 'object' && !Array.isArray(valor))
        ? { ...(atual[chave] ?? {}), ...valor }
        : valor;
    }
    await writeFile(caminho, JSON.stringify(atual, null, 2), 'utf8');

    // Muta o MESMO objeto que os recursos leem, senão a mudança só valeria
    // depois de reabrir o app.
    const recarregado = await carregarConfig();
    for (const chave of Object.keys(recarregado)) config[chave] = recarregado[chave];

    log('configuração salva');
    estado?.set('config', config);
    return config;
  }

  /* ------------------------------------------------- perfil e estatísticas */

  /** Elo, PDL, nível e maestria. Nunca lança: sem rede, devolve o último visto. */
  /**
   * O perfil de UMA conta: a pedida pela tela, senão a logada no client, senão
   * a do config. Cada pessoa (e cada conta dele) vê o próprio.
   */
  /** Guarda o elo quando ele muda — uma linha por (conta, fila) por mudança. */
  function anotarElo(perfilObj) {
    try {
      const nome = perfilObj?.conta?.nome; if (!nome) return;
      for (const e of perfilObj.elos ?? []) {
        const chave = e.chave ?? e.fila;
        const ult = db.prepare('SELECT tier, rank, pdl, vitorias, derrotas FROM elo_hist WHERE conta = ? AND fila = ? ORDER BY em DESC LIMIT 1').get(nome, chave);
        if (ult && ult.tier === e.tier && ult.rank === e.rank && ult.pdl === e.pdl && ult.vitorias === e.vitorias && ult.derrotas === e.derrotas) continue;
        db.prepare('INSERT OR IGNORE INTO elo_hist (conta, fila, tier, rank, pdl, vitorias, derrotas, em) VALUES (?,?,?,?,?,?,?,?)')
          .run(nome, chave, e.tier ?? null, e.rank ?? ({ '4': 'IV', '3': 'III', '2': 'II', '1': 'I' }[String(e.nome ?? '').trim().slice(-1)] ?? null), e.pdl ?? 0, e.vitorias ?? 0, e.derrotas ?? 0, new Date().toISOString());
      }
    } catch (erro) { log(`histórico de elo: ${erro.message}`); }
  }

  async function perfil(opcoes = {}) {
    const p = await perfilBruto(opcoes);
    anotarElo(p);
    return p;
  }

  /** Curva de PDL e o dia de hoje: partidas, saldo e sequência de derrotas. */
  function sessao({ conta = null } = {}) {
    const logada = estado?.instantaneo?.().conta ?? null;
    const nome = conta || (logada ? logada.split('#')[0] : null) || config.riot?.gameName || null;
    const hoje = new Date(); hoje.setHours(6, 0, 0, 0);   // o "dia" de quem joga vira às 6h
    if (hoje > new Date()) hoje.setDate(hoje.getDate() - 1);
    const desde = hoje.toISOString();
    const fc = nome ? " AND EXISTS (SELECT 1 FROM jogadores mc WHERE mc.gameId = p.gameId AND mc.participantId = p.meuId AND mc.nome = '" + String(nome).replace(/'/g, "''") + "')" : '';
    const deHoje = db.prepare(`SELECT p.venci, p.quando, p.meuCampeao FROM partidas p WHERE p.duracaoS >= 300 AND p.quando >= ?${fc} ORDER BY p.quando DESC`).all(desde);
    let seguidas = 0; for (const p of deHoje) { if (p.venci) break; seguidas++; }
    const curva = nome ? db.prepare('SELECT tier, rank, pdl, vitorias, derrotas, em FROM elo_hist WHERE conta = ? AND fila = ? ORDER BY em ASC').all(nome, 'RANKED_SOLO_5x5') : [];
    const pontos = (h) => (['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'].indexOf(h.tier)) * 400 + ({ IV: 0, III: 1, II: 2, I: 3 }[h.rank] ?? 0) * 100 + (h.pdl ?? 0);
    const primeiroHoje = curva.find((h) => h.em >= desde);
    const antesDeHoje = [...curva].reverse().find((h) => h.em < desde) ?? primeiroHoje;
    const ultimo = curva.at(-1);
    return {
      conta: nome, desde,
      hoje: { jogos: deHoje.length, vitorias: deHoje.filter((p) => p.venci).length, seguidas,
        saldoPdl: antesDeHoje && ultimo ? pontos(ultimo) - pontos(antesDeHoje) : null },
      curva: curva.slice(-60).map((h) => ({ em: h.em, pontos: pontos(h), tier: h.tier, rank: h.rank, pdl: h.pdl })),
    };
  }

  const marcadas = () => db.prepare('SELECT gameId FROM marcadas').all().map((r) => r.gameId);
  function marcar(gameId) {
    const id = Number(gameId); if (!id) throw new Error('gameId inválido');
    const tem = db.prepare('SELECT 1 FROM marcadas WHERE gameId = ?').get(id);
    if (tem) db.prepare('DELETE FROM marcadas WHERE gameId = ?').run(id);
    else db.prepare('INSERT INTO marcadas (gameId, em) VALUES (?, ?)').run(id, new Date().toISOString());
    return { gameId: id, marcada: !tem };
  }

  async function perfilBruto({ forcar = false, conta = null } = {}) {
    const { perfilDaRiot } = await import('./dados/perfil-riot.js');

    const logada = estado?.instantaneo?.().conta ?? null;   // "nome#tag" ou null
    const alvo = conta || (logada ? logada.split('#')[0] : null) || config.riot?.gameName || null;
    const tagDaLogada = logada && logada.split('#')[0] === alvo ? logada.split('#')[1] : null;

    // Se a conta pedida é a que está no client, o client responde sem chave.
    if (logada && logada.split('#')[0] === alvo && lcu.conectado) {
      const pc = await perfilPeloClient();
      // Com chave, a Riot ainda complementa (maestria); sem, isto já é o perfil.
      if (!config.riot?.apiKey) return pc;
      const pr = await perfilDaRiot({ ...config.riot, gameName: alvo, tagLine: tagDaLogada ?? config.riot.tagLine }, { forcar });
      return pr?.elos?.length ? pr : pc;
    }

    if (config.riot?.apiKey && alvo) {
      // Tag: a do config se for a mesma conta; senão a que ficou lembrada de
      // quando essa conta logou no client. Sem tag conhecida, a Riot não acha.
      const tags = await tagsConhecidas();
      const tag = alvo === config.riot.gameName ? config.riot.tagLine : (tags[alvo] ?? null);
      if (!tag) {
        return { elos: [], maestria: [], conta: { nome: alvo, tag: '' },
          erro: `abra o League com a conta ${alvo} uma vez pra eu aprender a tag dela` };
      }
      return (await perfilDaRiot({ ...config.riot, gameName: alvo, tagLine: tag }, { forcar }))
        ?? { elos: [], maestria: [], erro: `sem dados de ${alvo}` };
    }
    return { elos: [], maestria: [], conta: alvo ? { nome: alvo, tag: '' } : null,
      erro: 'abra o League com essa conta pra ver o elo (ou coloque uma chave da Riot no config)' };
  }

  const TIER_PT = {
    IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina',
    EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante',
  };
  const FILA_PT = { RANKED_SOLO_5x5: 'Ranqueada Solo/Duo', RANKED_FLEX_SR: 'Ranqueada Flex' };

  async function perfilPeloClient() {
    if (!lcu.conectado) return { elos: [], maestria: [], erro: 'abra o League pra ver o elo (ou coloque uma chave da Riot no config)' };
    const [eu, rank] = await Promise.all([
      lcu.get('/lol-summoner/v1/current-summoner').catch(() => null),
      lcu.get('/lol-ranked/v1/current-ranked-stats').catch(() => null),
    ]);
    const elos = (rank?.queues ?? [])
      .filter((q) => FILA_PT[q.queueType] && q.tier && q.tier !== 'NONE')
      .map((q) => {
        const tier = TIER_PT[q.tier] ?? q.tier;
        const semDivisao = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(q.tier);
        const jogos = (q.wins ?? 0) + (q.losses ?? 0);
        return {
          fila: FILA_PT[q.queueType], chave: q.queueType, tier: q.tier,
          nome: semDivisao ? tier : `${tier} ${{ I: '1', II: '2', III: '3', IV: '4' }[q.division] ?? q.division}`,
          pdl: q.leaguePoints ?? 0, vitorias: q.wins ?? 0, derrotas: q.losses ?? 0, jogos,
          taxa: jogos ? q.wins / jogos : 0, sequencia: false,
        };
      })
      .sort((a, b) => (a.chave === 'RANKED_SOLO_5x5' ? -1 : b.chave === 'RANKED_SOLO_5x5' ? 1 : 0));
    return {
      em: Date.now(), fonte: 'client',
      conta: eu ? { nome: eu.gameName, tag: eu.tagLine } : null,
      nivel: eu?.summonerLevel ?? null, icone: eu?.profileIconId ?? null,
      elos, maestria: [], desatualizado: false,
    };
  }

  /**
   * Tudo o que a tela de estatísticas mostra, numa chamada só.
   * São ~10 consultas no banco local; juntas levam menos que um ida-e-volta de
   * rede, e separar isso em dez rotas só faria a tela piscar em dez etapas.
   */
  async function estatisticas({ conta = null } = {}) {
    const E = await import('./analise/estatisticas.js');
    const { classesDosCampeoes } = await import('./dados/ddragon.js');
    const tags = await classesDosCampeoes().catch(() => new Map());
    const o = { conta: conta || null };

    return {
      conta: o.conta,
      contas: E.contas(db),
      geral: E.resumoGeral(db, o),
      participacao: E.participacao(db, o),
      forma: E.formaRecente(db, { n: 20, ...o }),
      roles: E.porRole(db, o),
      campeoes: E.porCampeao(db, { limite: 24, minimo: 2, ...o }),
      classes: E.porClasse(db, tags, o),
      atividade: E.atividade(db, o),
      radar: E.radar(db, o),
    };
  }

  /**
   * Bans e picks sugeridos a partir das partidas dele, por role.
   *
   * `jogados` e `enfrentados` vêm sem corte de amostra: são só os conjuntos que
   * a grade de campeões usa pra filtrar. As listas ordenadas (bans/picks) é que
   * exigem amostra, porque ali o número aparece na tela e precisa significar
   * alguma coisa.
   */
  async function sugestoes({ conta = null } = {}) {
    const E = await import('./analise/estatisticas.js');
    const ids = (sql) => db.prepare(sql).all().map((r) => r.id).filter((x) => x > 0 && x < 3000);
    const daConta = conta ? ` AND meu.nome = '${String(conta).replace(/'/g, "''")}'` : '';

    return {
      bans: E.piores(db, { minimo: 5, conta }),
      picks: E.melhoresCampeoes(db, { minimo: 5, conta }),
      jogados: ids(`
        SELECT DISTINCT meu.championId id
        FROM partidas p JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
        WHERE p.duracaoS >= 300${daConta}`),
      enfrentados: ids(`
        SELECT DISTINCT r.championId id
        FROM partidas p
        JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
        JOIN jogadores r ON r.gameId = p.gameId AND r.time <> meu.time AND r.role = p.minhaRole
        WHERE p.duracaoS >= 300${daConta}`),
    };
  }

  /* ------------------------------------------------------ notas de patch */

  async function patchLista() {
    const { listarAtualizacoes } = await import('./dados/patchnotes.js');
    return listarAtualizacoes({ limite: 12 });
  }

  /**
   * Saiu patch novo que mexe em campeão seu? Confere ao abrir e a cada 6h e
   * avisa na barra (o painel esconde quando você abre a aba Patch).
   */
  async function vigiarPatch() {
    try {
      const lista = await patchLista();
      const ultimo = lista?.[0]; if (!ultimo?.slug) return;
      const nota = await patchNota(ultimo.slug);
      const meus = nota?.meus?.length ?? 0, contra = nota?.contra?.length ?? 0;
      estado?.set('patchNovo', { slug: ultimo.slug, titulo: ultimo.titulo, meus, contra });
      if (meus || contra) estado?.avisar?.('Patch novo', `${ultimo.titulo}: ${meus} campeão(ões) seu(s), ${contra} que te ganham`);
    } catch { /* sem internet: fica pra próxima */ }
  }
  setTimeout(vigiarPatch, 20_000);
  setInterval(vigiarPatch, 6 * 60 * 60 * 1000);

  async function patchNota(slug) {
    const { lerAtualizacao, mudancasDele } = await import('./dados/patchnotes.js');
    const { elencoCompleto } = await import('./dados/ddragon.js');

    // O elenco entra pra reconhecer campeão nas seções de modo, onde o nome vem
    // como texto solto e precisa ser conferido contra a lista de verdade.
    const nota = await lerAtualizacao(slug, { elenco: await elencoCompleto().catch(() => []) });

    // "Seus campeões" = os que ele joga de verdade (3 partidas ou mais; duas
    // partidas de teste não fazem de alguém seu campeão) MAIS os que ele
    // declarou nas listas de pick — um buff no campeão que você pretende pegar
    // hoje à noite importa mesmo que você ainda não o tenha jogado.
    const jogados = db.prepare(`
      SELECT meuCampeao c, COUNT(*) n FROM partidas
      WHERE duracaoS >= 300 GROUP BY meuCampeao HAVING n >= 3`).all().map((r) => r.c);

    const escolhidos = Object.values(config.champSelect?.picks ?? {}).flat();
    const meus = [...new Set([...jogados, ...escolhidos])];

    // O outro lado da moeda: buff no campeão que já te ganha muda o seu jogo
    // tanto quanto buff no seu. Só os confrontos que realmente custaram vitória.
    const E = await import('./analise/estatisticas.js');
    const porRoleMapa = E.piores(db, { minimo: 5 });
    const carrascos = [...new Set(
      Object.values(porRoleMapa).flat().filter((x) => x.custo > 0.5).map((x) => x.campeao),
    )];

    const meusBlocos = mudancasDele(nota, meus);
    const jaListado = new Set(meusBlocos.map((b) => b.ancora));

    return {
      ...nota,
      meus: meusBlocos,
      contra: mudancasDele(nota, carrascos).filter((b) => !jaListado.has(b.ancora)),
    };
  }

  /* ------------------------------------------------------------- builds */

  async function builds({ campeao, role = null } = {}) {
    if (!campeao) throw new Error('faltou o campeão');
    const { buildsDoCampeao } = await import('./dados/builds.js');
    return buildsDoCampeao(campeao, role, { regiao: config.runas?.regiao ?? 'br' });
  }

  /**
   * Aplica no client uma das páginas de runa da tela de builds.
   * Mesma regra de sempre: sobrescreve só a página do LolCoach, nunca apaga.
   */
  async function aplicarRunasDaBuild({ campeao, role = null, indice = 0 } = {}) {
    if (!lcu.conectado) throw new Error('o League precisa estar aberto pra aplicar runas');
    const b = await builds({ campeao, role });
    const pagina = b.runas[indice];
    if (!pagina) throw new Error('essa página não existe');
    const { aplicarRunas } = await import('./features/runas.js');
    await aplicarRunas(lcu, { runas: pagina.lcu }, { paginaAlvo: config.runas?.paginaAlvo ?? null });
    log(`runas de ${campeao} ${b.roleNome} aplicadas pela tela de builds (${pagina.taxa}% em ${pagina.jogos} jogos)`);
    return { ok: true, pagina: `${pagina.primaria.nome} + ${pagina.secundaria.nome}` };
  }

  /**
   * Conjuntos de itens de TODOS os campeões dentro do client (a loja do jogo).
   * Tarefa pesada: ~200 chamadas ao op.gg com pausa. Só com o League aberto.
   */
  const aplicarBuildsNoLol = tarefa('aplicando builds no LoL', async () => {
    if (!lcu.conectado) throw new Error('o League precisa estar aberto pra gravar os conjuntos de itens');
    const { aplicarConjuntosDeTodos } = await import('./features/item-sets.js');

    // As roles em que ELE joga cada campeão (3+ partidas): esses ganham um
    // conjunto por role; o resto do elenco ganha só a role principal.
    const rolesDele = new Map();
    const mapaRole = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'adc', SUPORTE: 'sup' };
    for (const r of db.prepare(`
      SELECT meu.championId id, p.minhaRole role, COUNT(*) n
      FROM partidas p JOIN jogadores meu ON meu.gameId = p.gameId AND meu.participantId = p.meuId
      WHERE p.duracaoS >= 300 GROUP BY meu.championId, p.minhaRole HAVING n >= 3`).all()) {
      const role = mapaRole[r.role];
      if (!role) continue;
      rolesDele.set(r.id, [...(rolesDele.get(r.id) ?? []), role]);
    }

    // Só os campeões que ele joga (3+ partidas) e os das listas de pick: o
    // elenco inteiro dava ~370 conjuntos e o client recusava com HTTP 413.
    // Quem mais precisar ganha o conjunto na hora em que travar o campeão.
    const { tabelaDeCampeoes } = await import('./features/champ-select.js');
    const tabela = await tabelaDeCampeoes(lcu).catch(() => null);
    const apenas = new Set(rolesDele.keys());
    for (const nome of Object.values(config.champSelect?.picks ?? {}).flat()) {
      const id = tabela?.porNome.get(String(nome).toLowerCase());
      if (id) apenas.add(id);
    }

    log(`aplicando builds no LoL: ${apenas.size} campeões (os que você joga + os das listas)…`);
    const r = await aplicarConjuntosDeTodos(lcu, {
      rolesDele, apenas,
      opcoes: { regiao: config.runas?.regiao ?? 'br' },
      podeContinuar: () => estado?.instantaneo?.().fase !== 'InProgress',
      aoProgresso: (p) => { if (p.feitos % 25 === 0) log(`builds no LoL: ${p.feitos}/${p.total} campeões…`); },
    });
    log(`builds no LoL: ${r.campeoes} campeões, ${r.total ?? '?'} conjuntos no client (${r.preservados ?? 0} seus preservados), ${r.falhas} falhas`);
    await writeFile(marcaBuilds(), JSON.stringify({ em: Date.now(), ...r }), 'utf8').catch(() => {});
    return r;
  });

  /**
   * Roda sozinho uma vez por dia, 30s depois que o client conecta — que é
   * quando ele abriu o League e ainda não está em fila. Se falhar (op.gg fora,
   * client fechou), o botão na Atividade continua lá.
   */
  const marcaBuilds = () => resolve(pastaBase(), 'dados', 'builds', 'aplicado-em.json');
  lcu.on('conectado', () => {
    setTimeout(async () => {
      if (!lcu.conectado || ocupado) return;
      const marca = await readFile(marcaBuilds(), 'utf8').then(JSON.parse).catch(() => null);
      if (marca && Date.now() - marca.em < 24 * 60 * 60 * 1000) return;
      if (!permite('builds')) return;
      log('builds no LoL: primeira vez hoje, começando em segundo plano…');
      aplicarBuildsNoLol().catch((erro) => log(`builds no LoL não rodou: ${erro.message}`));
    }, 30_000);
  });

  /* ------------------------------------------------------------- amigos */

  const listaDeAmigos = () => (config.amigos ?? []).filter((a) => a?.nome && a?.tag);

  /**
   * A lista com o que já está em disco de cada um — nunca bate na Riot aqui.
   * Quem atualiza é a tela, um amigo por vez (`amigoPerfil`), pra não estourar
   * o limite da chave. `conta` é a sua conta nas telas: vira o "você" da
   * comparação, com a tag lembrada de quando logou no client.
   */
  async function amigos({ conta } = {}) {
    const { perfilDeAmigo } = await import('./dados/amigos.js');
    const soDisco = { ...config.riot, apiKey: null };
    const lista = await Promise.all(listaDeAmigos().map(async (a) => ({
      nome: a.nome, tag: a.tag,
      perfil: await perfilDeAmigo(soDisco, a, {}).catch(() => null),
    })));

    const tags = await tagsConhecidas();
    const contaLogada = estado?.instantaneo?.().conta ?? null;
    const logada = contaLogada ? String(contaLogada).split('#') : null;
    const meuNome = conta || logada?.[0] || config.riot?.gameName || null;
    const minhaTag = (meuNome && tags[meuNome]) || (logada && logada[0] === meuNome ? logada[1] : null)
      || (meuNome === config.riot?.gameName ? config.riot?.tagLine : null) || null;
    const eu = meuNome && minhaTag
      ? { nome: meuNome, tag: minhaTag, perfil: await perfilDeAmigo(soDisco, { nome: meuNome, tag: minhaTag }, {}).catch(() => null) }
      : { nome: meuNome, tag: null, perfil: null };

    // Quem está online no client agora (lista de amigos do LoL, só disponibilidade).
    let online = new Map();
    if (lcu.conectado) {
      const amigosLol = await lcu.get('/lol-chat/v1/friends').catch(() => []);
      for (const f of amigosLol ?? []) online.set(`${f.gameName}#${f.gameTag}`.toLowerCase(), f.availability);
    }
    for (const a of lista) a.online = online.get(`${a.nome}#${a.tag}`.toLowerCase()) ?? null;

    // Jogos em comum: as últimas dele que também estão no meu banco.
    const meusIds = new Set(db.prepare('SELECT gameId FROM partidas').all().map((r) => r.gameId));
    for (const a of lista) {
      a.emComum = (a.perfil?.recente?.ultimas ?? []).filter((u) => u.gameId && meusIds.has(u.gameId))
        .map((u) => ({ gameId: u.gameId, venci: u.venci, campeao: u.campeao }));
    }
    // Ranking da semana: quanto cada um andou de PDL na solo nos últimos 7 dias.
    const semana = new Date(Date.now() - 7 * 86400_000).toISOString();
    const pontos = (h) => (['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'].indexOf(h.tier)) * 400 + ({ IV: 0, III: 1, II: 2, I: 3 }[h.rank] ?? 0) * 100 + (h.pdl ?? 0);
    const deltaSemana = (nome) => {
      if (!nome) return null;
      const hist = db.prepare('SELECT tier, rank, pdl, em FROM elo_hist WHERE conta = ? AND fila = ? ORDER BY em ASC').all(nome, 'RANKED_SOLO_5x5');
      if (hist.length < 2) return null;
      const antes = [...hist].reverse().find((h) => h.em <= semana) ?? hist[0];
      return pontos(hist.at(-1)) - pontos(antes);
    };
    for (const a of [...lista, eu]) if (a) a.semana = deltaSemana(a.perfil?.conta?.nome ?? a.nome);
    return { amigos: lista, eu, semChave: !config.riot?.apiKey };
  }

  /** Perfil de uma conta (amigo ou você mesmo), buscando na Riot se precisar. */
  async function amigoPerfil({ nome, tag, forcar = false } = {}) {
    if (!nome || !tag) throw new Error('faltou nome#tag');
    if (!permite('amigos')) throw new Error('a aba Amigos está desligada pelo painel de controle');
    const { perfilDeAmigo } = await import('./dados/amigos.js');
    log(`buscando perfil de ${nome}#${tag} na Riot…`);
    const p = await perfilDeAmigo(config.riot, { nome, tag }, { forcar });
    if (!p.doCache) { log(`perfil de ${nome}#${tag} atualizado (${p.recente?.jogos ?? 0} partidas recentes)`); anotarElo(p); }
    return p;
  }

  async function adicionarAmigo({ nome, tag } = {}) {
    nome = String(nome ?? '').trim(); tag = String(tag ?? '').trim().replace(/^#/, '');
    if (!nome || !tag) throw new Error('escreva no formato nome#tag');
    // Confere na Riot antes de guardar: nome errado não vira amigo fantasma.
    const p = await amigoPerfil({ nome, tag });
    const atual = listaDeAmigos().filter((a) => !(a.nome.toLowerCase() === nome.toLowerCase() && a.tag.toLowerCase() === tag.toLowerCase()));
    await salvarConfig({ amigos: [...atual, { nome: p.conta.nome, tag: p.conta.tag }] });
    return { ok: true, perfil: p };
  }

  async function removerAmigo({ nome, tag } = {}) {
    await salvarConfig({ amigos: listaDeAmigos().filter((a) => !(a.nome === nome && a.tag === tag)) });
    return { ok: true };
  }

  const imagem = (fn, tipo) => async (id) => {
    const corpo = await fn(id);
    if (!corpo) throw new Error('sem imagem');
    return { corpo, tipo };
  };

  const app = {
    lcu, db, config, coletar, reprocessar, historico, detalhe,
    campeoes, lerConfig, salvarConfig, vivo,
    perfil, estatisticas, sugestoes, patchLista, patchNota,
    builds, aplicarRunasDaBuild, aplicarBuildsNoLol,
    amigos, amigoPerfil, adicionarAmigo, removerAmigo,
    adminUsuarios, adminGravarControle, adminEsquecer, sessao, marcadas, marcar,
    imagemItem: async (id) => imagem((await import('./dados/ddragon.js')).imagemDeItem, 'image/png')(id),
    imagemRuna: async (id) => imagem((await import('./dados/ddragon.js')).imagemDeRuna, 'image/png')(id),
    imagemFeitico: async (id) => imagem((await import('./dados/ddragon.js')).imagemDeFeitico, 'image/png')(id),
    iconePerfil: async (id) => {
      const { iconeDePerfil } = await import('./dados/ddragon.js');
      const corpo = await iconeDePerfil(id);
      if (!corpo) throw new Error('sem ícone de perfil');
      return { corpo, tipo: 'image/png' };
    },
    arte: async (championId) => {
      const { arteDoCampeao } = await import('./dados/ddragon.js');
      const corpo = await arteDoCampeao(championId);
      if (!corpo) throw new Error('sem arte');
      return { corpo, tipo: 'image/jpeg' };
    },
    // Client primeiro (melhor qualidade e instantâneo); com o League fechado,
    // cai no Data Dragon pra nenhuma tela ficar com quadrado vazio.
    icone: async (championId) => {
      try {
        return await lcu.getBinario(`/lol-game-data/assets/v1/champion-icons/${championId}.png`);
      } catch {
        const { iconeDoCampeao } = await import('./dados/ddragon.js');
        const corpo = await iconeDoCampeao(championId);
        if (!corpo) throw new Error('sem ícone');
        return { corpo, tipo: 'image/png' };
      }
    },
    ocupado: () => ocupado,
    fechar() { try { db.close(); } catch {} lcu.fechar(); },
  };

  /**
   * O que o servidor do painel expõe. Fica aqui, e não repetido em cada ponto
   * de entrada: a lista estava escrita igual no `electron/main.js` e no
   * `scripts/auto.js`, e toda rota nova precisava ser lembrada nos dois.
   */
  app.acoes = Object.fromEntries(ACOES_DO_PAINEL.map((nome) => [nome, app[nome]]));
  return app;
}

const ACOES_DO_PAINEL = [
  'coletar', 'reprocessar', 'historico', 'detalhe', 'icone', 'iconePerfil',
  'vivo', 'arte', 'campeoes', 'lerConfig', 'salvarConfig',
  'perfil', 'estatisticas', 'sugestoes', 'patchLista', 'patchNota',
  'builds', 'aplicarRunasDaBuild', 'aplicarBuildsNoLol', 'imagemItem', 'imagemRuna', 'imagemFeitico',
  'amigos', 'amigoPerfil', 'adicionarAmigo', 'removerAmigo',
  'adminUsuarios', 'adminGravarControle', 'adminEsquecer', 'sessao', 'marcadas', 'marcar',
];
