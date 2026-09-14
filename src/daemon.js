import { LcuClient } from './lcu/client.js';
import { carregarConfig } from './config.js';
import { autoAceitar } from './features/auto-aceitar.js';
import { autoChampSelect } from './features/champ-select.js';
import { abrirBanco } from './dados/banco.js';
import { coletarPendentes } from './dados/coletor.js';
import { readFile, writeFile } from 'node:fs/promises';
import { caminhoConfig, caminhoCampeoes, pastaBase } from './caminhos.js';
import { resolve } from 'node:path';

/**
 * Liga tudo: aceitar fila, seleção de campeão, runas e coleta.
 * Recebe um `estado` (de src/ui/servidor.js) pra reportar o que está fazendo,
 * e devolve as alças pra quem chamou poder fechar depois.
 */
export async function iniciarDaemon({ estado, config: configDada, aoSelecionar, aoFase } = {}) {
  const config = configDada ?? await carregarConfig();
  const lcu = new LcuClient();
  const db = abrirBanco();

  const log = (texto) => {
    estado?.log(texto);
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, texto);
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

  // Registrados sempre, lendo a configuração viva: ligar e desligar pela tela
  // não pode exigir reabrir o programa.
  autoAceitar(lcu, {
    ativo: () => config.autoAceitar.ativo !== false,
    atrasoMs: () => config.autoAceitar.atrasoMs ?? 1500,
    aoAceitar: (erro) => log(erro ? `falha ao aceitar: ${erro.message}` : 'partida aceita'),
    log,
  });

  autoChampSelect(lcu, config, { log });

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
  log(`banco com ${total} partidas`);

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

    const rastreio = R.rastrear(estado, partidaVivo.memoria);
    const conselhos = [...rastreio.avisos, ...montarConselhos(estado, perfil)]
      .sort((a, b) => b.urgencia - a.urgencia);

    return {
      emJogo: true, estado, perfil, conselhos,
      contra: partidaVivo.fichas ?? [],
      vistos: rastreio.vistos,
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
  async function perfil({ forcar = false, conta = null } = {}) {
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

    log(`aplicando builds no LoL: ${rolesDele.size} campeões seus com todas as roles, o resto na role principal…`);
    const r = await aplicarConjuntosDeTodos(lcu, {
      rolesDele,
      opcoes: { regiao: config.runas?.regiao ?? 'br' },
      podeContinuar: () => estado?.instantaneo?.().fase !== 'InProgress',
      aoProgresso: (p) => { if (p.feitos % 10 === 0 || p.feitos === p.total) log(`builds no LoL: ${p.feitos}/${p.total} campeões (${p.conjuntos} conjuntos prontos, ${p.falhas} falhas)`); },
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

    return { amigos: lista, eu, semChave: !config.riot?.apiKey };
  }

  /** Perfil de uma conta (amigo ou você mesmo), buscando na Riot se precisar. */
  async function amigoPerfil({ nome, tag, forcar = false } = {}) {
    if (!nome || !tag) throw new Error('faltou nome#tag');
    const { perfilDeAmigo } = await import('./dados/amigos.js');
    log(`buscando perfil de ${nome}#${tag} na Riot…`);
    const p = await perfilDeAmigo(config.riot, { nome, tag }, { forcar });
    if (!p.doCache) log(`perfil de ${nome}#${tag} atualizado (${p.recente?.jogos ?? 0} partidas recentes)`);
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
];
