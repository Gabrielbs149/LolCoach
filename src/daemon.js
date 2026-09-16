import { LcuClient } from './lcu/client.js';
import { carregarConfig } from './config.js';
import { autoAceitar } from './features/auto-aceitar.js';
import { autoChampSelect } from './features/champ-select.js';
import { abrirBanco } from './dados/banco.js';
import { coletarPendentes } from './dados/coletor.js';
import { readFile, writeFile, mkdir, readdir, rm, appendFile } from 'node:fs/promises';
import { caminhoConfig, caminhoCampeoes, pastaBase } from './caminhos.js';
import { resolve, basename } from 'node:path';
import { F, render as renderFala, personalizar as personalizarFalas } from './vivo/texto.js';
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

export async function iniciarDaemon({ estado, config: configDada, aoSelecionar, aoFase, aoConfig } = {}) {
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
  /* ---- situações gravadas: ver e avaliar (base do aprendizado) ---- */
  const pastaSituacoes = () => resolve(pastaBase(), 'dados', 'situacoes');
  const lerJsonl = async (arquivo) => (await readFile(arquivo, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  async function situacoesPartidas() {
    if (config.admin !== true) throw new Error('só pra admin');
    const pastas = (await readdir(pastaSituacoes()).catch(() => [])).sort().reverse();
    const saida = [];
    for (const p of pastas.slice(0, 30)) {
      const info = (await lerJsonl(resolve(pastaSituacoes(), p, 'partida.json')))[0] ?? {};
      const n = (await lerJsonl(resolve(pastaSituacoes(), p, 'situacoes.jsonl'))).length;
      saida.push({ pasta: p, inicio: info.inicio ?? null, campeao: info.eu?.campeao ?? null, role: info.eu?.role ?? null, situacoes: n });
    }
    return saida;
  }
  async function situacoesDe({ pasta, gameId } = {}) {
    if (gameId && !pasta) {
      for (const p of (await readdir(pastaSituacoes()).catch(() => []))) { const info = (await lerJsonl(resolve(pastaSituacoes(), p, 'partida.json')))[0]; if (info?.gameId === Number(gameId)) { pasta = p; break; } }
      if (!pasta) return { partida: null, situacoes: [], falas: [] };
    } else if (config.admin !== true) throw new Error('só pra admin');
    if (!pasta || /[\\/]/.test(pasta)) throw new Error('pasta inválida');
    const base = resolve(pastaSituacoes(), pasta);
    const [partida, situacoes, falas, avaliacoes, acertos] = await Promise.all([lerJsonl(resolve(base, 'partida.json')), lerJsonl(resolve(base, 'situacoes.jsonl')), lerJsonl(resolve(base, 'falas.jsonl')), lerJsonl(resolve(base, 'avaliacoes.jsonl')), lerJsonl(resolve(base, 'acertos.jsonl'))]);
    const notas = new Map(avaliacoes.map((a) => [`${a.t}|${a.chave}`, a.nota]));
    const conferidas = new Map(acertos.map((a) => [`${a.t}|${a.chave}`, a.acertou]));
    const mortes = await mortesCruzadas(base, partida[0]).catch(() => null);
    return { partida: partida[0] ?? null, situacoes: situacoes.map((s) => ({ ...s, nota: notas.get(`${s.t}|${s.chave}`) ?? null, acertou: conferidas.get(`${s.t}|${s.chave}`) ?? null })), falas, mortes };
  }
  /**
   * Pós-jogo que ensina: cada morte sua cruzada com o que o olho via na hora —
   * jungler deles sumido há quanto tempo (e onde foi visto), quantos deles
   * estavam perto, se você estava avançado (lado deles). Só dado gravado.
   */
  async function mortesCruzadas(base, partida) {
    if (!partida?.eu) return null;
    const [estados, leituras] = await Promise.all([lerJsonl(resolve(base, 'estado.jsonl')), lerJsonl(resolve(base, 'leituras.jsonl'))]);
    if (!estados.length || !leituras.length) return null;
    const { lugar } = await import('./vivo/olho.js');
    const meuTime = partida.eu.time, meuC = partida.eu.campeao;
    const jgDeles = partida.jogadores.find((j) => j.time !== meuTime && j.role === 'jungle')?.campeao ?? null;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mortes = [];
    let antes = 0;
    for (const e of estados) {
      const eu = e.jogadores?.find((j) => j.c === meuC && j.time === meuTime); if (!eu) continue;
      if (eu.m > antes) {
        antes = eu.m;
        // a leitura de uns 3 s antes da morte (a morte em si já tira você do mapa)
        const l = leituras.filter((x) => x.t <= e.t - 2).at(-1) ?? leituras.find((x) => x.t >= e.t - 8);
        if (!l) { mortes.push({ n: eu.m, t: e.t }); continue; }
        const me = l.campeoes.find((c) => c.c === meuC && c.time === meuTime);
        const minhaPos = me?.x != null && me.ha != null && me.ha <= 6 ? { x: me.x, y: me.y } : null;
        const jg = jgDeles ? l.campeoes.find((c) => c.c === jgDeles) : null;
        const perto = minhaPos ? l.campeoes.filter((c) => c.time !== meuTime && c.x != null && c.ha != null && c.ha <= 5 && dist(c, minhaPos) < 0.16).map((c) => c.c) : [];
        const onde = minhaPos ? lugar(minhaPos.x, minhaPos.y, meuTime) : null;
        mortes.push({ n: eu.m, t: e.t,
          onde: onde?.texto ?? null, avancado: onde?.lado === 'deles' && onde.lane !== 'base',
          jg: jg ? { campeao: jg.c, morto: jg.morto, ha: jg.ha, regiao: jg.regiao } : null,
          perto });
      }
    }
    const semJg = mortes.filter((m) => m.jg && !m.jg.morto && (m.jg.ha == null || m.jg.ha >= 30)).length;
    const avancado = mortes.filter((m) => m.avancado).length;
    const emNumero = mortes.filter((m) => m.perto.length >= 2).length;
    return { lista: mortes, total: mortes.length, semJg, avancado, emNumero };
  }
/**
   * Auto-avaliação: situação que PREVÊ algo ("jungler indo pro bot", "Ahri
   * indo pro mid", "X a 6 s de você", "jungler começou… aparece no top") é
   * conferida depois contra as leituras: aconteceu ou não? Vai pra
   * acertos.jsonl e vira precisão por tipo — o cérebro aprende sem ninguém
   * clicar em nada.
   */
  async function conferirPrevisoes(base) {
    const [partida, situacoes, leituras] = await Promise.all([lerJsonl(resolve(base, 'partida.json')), lerJsonl(resolve(base, 'situacoes.jsonl')), lerJsonl(resolve(base, 'leituras.jsonl'))]);
    const p = partida[0]; if (!p?.eu || !leituras.length) return null;
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
      if ((m = s.chave.match(/^jg-indo-(top|mid|bot)$/)) && jgDeles) acertou = chegouNaLane(jgDeles, m[1], s.t, s.t + 30);
      else if ((m = s.chave.match(/^roam-(.+)-(top|mid|bot)$/))) { const c = campeaoDe.get(m[1]); if (c) acertou = chegouNaLane(c, m[2], s.t, s.t + 35); }
      else if ((m = s.chave.match(/^perto-(.+)$/))) { const c = campeaoDe.get(m[1]); if (c) acertou = aproximou(c, s.t, s.t + 10); }
      else if (s.chave === 'jg-vindo' && jgDeles) acertou = aproximou(jgDeles, s.t, s.t + 12);
      else if (s.chave === 'jg-inicio' && jgDeles && s.dados?.laneGank) acertou = chegouNaLane(jgDeles, s.dados.laneGank, 170, 250);
      else if (s.chave === 'jg-sumido' && jgDeles && ['top', 'mid', 'bot'].includes(s.dados?.rumo)) acertou = chegouNaLane(jgDeles, s.dados.rumo, s.t, s.t + 45);
      else if (s.chave === 'jg-gank-previsto' && jgDeles && s.dados?.lane) acertou = chegouNaLane(jgDeles, s.dados.lane, s.t - 10, s.t + 40);
      if (acertou == null) continue;
      saida.push({ t: s.t, chave: s.chave, falada: !!s.falada, acertou });
    }
    if (!saida.length) return null;
    await writeFile(resolve(base, 'acertos.jsonl'), saida.map((a) => JSON.stringify(a)).join('\n') + '\n');
    const porTipo = new Map();
    for (const a of saida) { const k = baseChave(a.chave); const r = porTipo.get(k) ?? porTipo.set(k, { n: 0, ok: 0 }).get(k); r.n++; if (a.acertou) r.ok++; }
    const certas = saida.filter((a) => a.acertou).length;
    log(`previsões: ${certas}/${saida.length} certas (${[...porTipo].map(([k, r]) => `${k} ${r.ok}/${r.n}`).join(', ')})`);
    return { total: saida.length, certas };
  }
  // Partidas gravadas antes disso existir: confere uma vez, aos poucos, depois de abrir
  setTimeout(async () => {
    for (const p of (await readdir(pastaSituacoes()).catch(() => []))) {
      const base = resolve(pastaSituacoes(), p);
      if ((await lerJsonl(resolve(base, 'acertos.jsonl'))).length) continue;
      if (!(await lerJsonl(resolve(base, 'leituras.jsonl'))).length) continue;
      await conferirPrevisoes(base).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 90_000).unref?.();
  /** Resumo por tipo de situação em todas as partidas gravadas: quantas, quantas faladas, 👍/👎. */
  const { baseChave } = await import('./vivo/cerebro.js');
  async function situacoesResumo() {
    if (config.admin !== true) throw new Error('só pra admin');
    return resumoInterno();
  }
  let cacheRemotas = { em: 0, lista: [] };
  async function avaliacoesRemotas() {
    if (!tokenControle()) return [];
    if (Date.now() - cacheRemotas.em < 10 * 60_000) return cacheRemotas.lista;
    cacheRemotas = { em: Date.now(), lista: await Controle.listarAvaliacoes(tokenControle()).catch(() => cacheRemotas.lista) };
    return cacheRemotas.lista;
  }
  async function resumoInterno() {
    const pastas = (await readdir(pastaSituacoes()).catch(() => []));
    const porChave = new Map();
    const base = baseChave;
    // o que os amigos avaliaram (só admin junta; pra eles conta só o próprio)
    if (config.admin === true) for (const a of await avaliacoesRemotas()) {
      if (a.de === config.instalacaoId) continue;   // as minhas já estão nas pastas
      const k = base(a.chave);
      const r = porChave.get(k) ?? porChave.set(k, { chave: k, tipo: a.tipo ?? '?', n: 0, faladas: 0, bom: 0, ruim: 0, exemplo: a.texto }).get(k);
      if (a.nota === 1) r.bom++; else if (a.nota === -1) r.ruim++;
    }
    for (const p of pastas) {
      const [situacoes, avaliacoes, acertos] = await Promise.all([lerJsonl(resolve(pastaSituacoes(), p, 'situacoes.jsonl')), lerJsonl(resolve(pastaSituacoes(), p, 'avaliacoes.jsonl')), lerJsonl(resolve(pastaSituacoes(), p, 'acertos.jsonl'))]);
      const notas = new Map(avaliacoes.map((a) => [`${a.t}|${a.chave}`, a.nota]));
      // precisão só das últimas 8 partidas: as regras mudam e o passado velho não pode puxar pra baixo
      const recente = pastas.slice().sort().slice(-8).includes(p);
      for (const a of recente ? acertos : []) { const k = base(a.chave); const r = porChave.get(k) ?? porChave.set(k, { chave: k, tipo: '?', n: 0, faladas: 0, bom: 0, ruim: 0, exemplo: '' }).get(k); r.previstas = (r.previstas ?? 0) + 1; if (a.acertou) r.certas = (r.certas ?? 0) + 1; }
      for (const s of situacoes) {
        const k = base(s.chave);
        const r = porChave.get(k) ?? porChave.set(k, { chave: k, tipo: s.tipo, n: 0, faladas: 0, bom: 0, ruim: 0, exemplo: s.texto }).get(k);
        r.n++; if (s.falada) r.faladas++;
        const nota = notas.get(`${s.t}|${s.chave}`); if (nota === 1) r.bom++; else if (nota === -1) r.ruim++;
      }
    }
    const tipos = [...porChave.values()].sort((a, b) => b.n - a.n);
    // Aprendizado v0: tipo com 3+ 👎 e nenhum 👍 deixa de ser falado (continua gravado).
    for (const t of tipos) { t.silenciada = t.ruim >= 3 && t.bom === 0; if (t.previstas >= 5) t.precisao = Math.round(100 * (t.certas ?? 0) / t.previstas) / 100; }
    return { partidas: pastas.length, tipos };
  }
  async function avaliarSituacao({ pasta, chave, t, nota, texto, tipo } = {}) {
    const atual = partidaVivo?.pastaSitu ? basename(partidaVivo.pastaSitu) : null;
    if (config.admin !== true && pasta !== atual) throw new Error('só a partida atual');
    if (!pasta || /[\\/]/.test(pasta)) throw new Error('pasta inválida');
    await appendFile(resolve(pastaSituacoes(), pasta, 'avaliacoes.jsonl'), JSON.stringify({ t, chave, nota, em: new Date().toISOString() }) + '\n');
    subirAvaliacoes(pasta, { t, chave, nota, texto, tipo }).catch((erro) => log(`avaliação não subiu: ${erro.message}`));
    return { ok: true };
  }
  /** Tecla no jogo: 👍/👎 na última fala do minimapa (a que acabou de sair). */
  async function avaliarUltima(nota) {
    if (![1, -1].includes(nota) || !partidaVivo?.pastaSitu) return { ok: false };
    const ult = (partidaVivo.situacoesRecentes ?? []).filter((s) => s.falada).at(-1);
    if (!ult || (partidaVivo.ultimoEstado?.tempo ?? 0) - ult.t > 45) return { ok: false };   // só vale nos 45 s seguintes
    const pasta = basename(partidaVivo.pastaSitu);
    await avaliarSituacao({ pasta, chave: ult.chave, t: ult.t, nota, texto: ult.texto, tipo: ult.tipo });
    ult.aval = nota;
    partidaVivo.avaliadaAgora = { t: Date.now(), nota, texto: ult.texto };
    log(`${nota === 1 ? '👍' : '👎'} "${ult.texto}"`);
    return { ok: true, texto: ult.texto };
  }
  // Avaliações vão pro repositório de controle (uma gravação por vez, juntando o que chegou no meio)
  const filaAval = new Map();   // pasta → lista pendente
  let subindoAval = null;
  async function subirAvaliacoes(pasta, item) {
    if (!tokenControle()) return;
    (filaAval.get(pasta) ?? filaAval.set(pasta, []).get(pasta)).push(item);
    if (subindoAval) return subindoAval;
    subindoAval = (async () => {
      await new Promise((r) => setTimeout(r, 3000));   // junta cliques seguidos
      for (const [p, itens] of [...filaAval]) {
        filaAval.delete(p);
        const gameId = (await lerJsonl(resolve(pastaSituacoes(), p, 'partida.json')))[0]?.gameId ?? p;
        const todas = (await lerJsonl(resolve(pastaSituacoes(), p, 'avaliacoes.jsonl'))).map((a) => ({ ...a, de: config.instalacaoId, conta: quemSou().conta }));
        const textos = new Map(itens.map((i) => [`${i.t}|${i.chave}`, i]));
        for (const a of todas) { const i = textos.get(`${a.t}|${a.chave}`); if (i) { a.texto = i.texto; a.tipo = i.tipo; } }
        await Controle.gravarAvaliacoes(tokenControle(), config.instalacaoId, gameId, todas);
      }
    })().finally(() => { subindoAval = null; });
    return subindoAval;
  }
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

  // Últimas runas aplicadas na seleção — a voz anuncia (pedra angular e árvores).
  let ultimasRunas = null;
  autoChampSelect(lcu, config, {
    log, permite,
    aoRunas: async ({ campeao, build }) => {
      try {
        const [{ tabelaDeRunas }, { ESTILO }] = await Promise.all([import('./dados/ddragon.js'), import('./vivo/falas.js')]);
        const t = await tabelaDeRunas();
        ultimasRunas = { campeao, chave: t.get(build.runas.selectedPerkIds?.[0])?.nome ?? null,
          primaria: ESTILO[build.runas.primaryStyleId] ?? null, secundaria: ESTILO[build.runas.subStyleId] ?? null };
      } catch { ultimasRunas = { campeao }; }
    },
  });
  let seqFalas = 0;

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
  let sala = { gameId: null, etag: null, vistos: new Set(), ultimaLeitura: 0 };   // flash compartilhado (partidas/<gameId>.json)
  lcu.observar('/lol-gameflow/v1/gameflow-phase', (fase) => {
    if (fase === faseAnterior) return;
    estado?.set('fase', fase);
    log(`fase: ${fase}`);
    // A janela ao vivo abre na seleção, nunca com o jogo rodando: mexer em
    // janela durante a partida rouba o foco e minimiza o jogo em tela cheia.
    if (fase === 'ChampSelect') aoSelecionar?.();
    aoFase?.(fase);
    if (faseAnterior === 'EndOfGame' || (faseAnterior === 'InProgress' && fase === 'None')) coletar();
    // Acabou: resumo do que o olho viu e falou, pra conferir no registro.
    if (faseAnterior === 'InProgress' && fase !== 'InProgress' && partidaVivo?.contSitu) {
      const c = partidaVivo.contSitu;
      const top = [...c.porTipo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} ${n}`).join(', ');
      log(`olho: partida gravada — ${c.total} situações, ${c.faladas} faladas, ${c.leituras} leituras (${top})`);
      if (partidaVivo.pastaSitu) conferirPrevisoes(partidaVivo.pastaSitu).catch((erro) => log(`previsões: ${erro.message}`));
    }
    if (fase !== 'InProgress' && fase !== 'GameStart') sala = { gameId: null, etag: null, vistos: new Set(), ultimaLeitura: 0 };
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
  // Toda fala passa por aqui antes de ir pra tela: aplica o texto que o admin
  // personalizou (config.voz.falas) e preenche os {n}.
  const prontaFala = (f) => {
    personalizarFalas(config.voz?.falas ?? {});
    const pronta = { ...f, serio: renderFala(f.serio), divertido: renderFala(f.divertido ?? f.serio) };
    // Tudo que a voz diz fica gravado junto com as situações: material pra aprender o que vale falar.
    if (partidaVivo?.pastaSitu && pronta.seq) appendFile(resolve(partidaVivo.pastaSitu, 'falas.jsonl'), JSON.stringify({ t: Math.round((pronta.t ?? 0) * 10) / 10, modulo: pronta.modulo, prioridade: pronta.prioridade, serio: pronta.serio, divertido: pronta.divertido }) + '\n').catch(() => {});
    return pronta;
  };
  let ultimoRetrato = 0;
  /** Pasta da partida em dados/situacoes: criada na primeira leitura, com o elenco. */
  async function garantirPastaSitu(e) {
    if (!partidaVivo || partidaVivo.pastaSitu) return;
    resumoInterno().then((r) => { partidaVivo.notas = new Map(r.tipos.map((t) => [t.chave, { bom: t.bom, ruim: t.ruim, precisao: t.precisao ?? null }])); partidaVivo.silenciadas = new Set(r.tipos.filter((t) => t.silenciada).map((t) => t.chave)); if (partidaVivo.silenciadas.size) log(`olho: ${partidaVivo.silenciadas.size} tipo(s) de situação silenciados pelas suas avaliações`); }).catch(() => {});
    partidaVivo.pastaSitu = resolve(pastaBase(), 'dados', 'situacoes', `${new Date().toISOString().slice(0, 16).replace(':', '-')}-${String(e.eu?.campeao ?? 'x').toLowerCase()}`);
    await mkdir(partidaVivo.pastaSitu, { recursive: true }).catch(() => {});
    const gameId = await lcu.get('/lol-gameflow/v1/session').then((s) => s?.gameData?.gameId ?? null).catch(() => null);
    await appendFile(resolve(partidaVivo.pastaSitu, 'partida.json'), JSON.stringify({ inicio: new Date().toISOString(), gameId, eu: e.eu, jogadores: e.jogadores.map((j) => ({ nome: j.nome, campeao: j.campeao, time: j.time, role: j.role })), modo: e.modo }) + '\n').catch(() => {});
    // limpa partidas velhas (fica com 30)
    const pastas = (await readdir(resolve(pastaBase(), 'dados', 'situacoes')).catch(() => [])).sort();
    for (const velha of pastas.slice(0, -30)) await rm(resolve(pastaBase(), 'dados', 'situacoes', velha), { recursive: true, force: true }).catch(() => {});
  }

  async function vivo() {
    const [{ lerEstado }, { montarPerfil }, { montarConselhos }, { fichasDaPartida }, R] = await Promise.all([
      import('./vivo/jogo-vivo.js'), import('./vivo/perfil.js'), import('./vivo/conselhos.js'),
      import('./vivo/confronto-vivo.js'), import('./vivo/rastreio.js'),
    ]);

    const estado = await lerEstado();
    if (!estado?.eu) { partidaVivo = null; return { emJogo: false, selecao: await selecaoAtual() }; }

    const role = estado.eu.role || 'geral';
    if (!perfis.has(role)) {
      const mapa = { top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', sup: 'SUPORTE' };
      perfis.set(role, montarPerfil(db, { role: mapa[role] ?? null, campeao: estado.eu.campeao }));
    }
    const perfil = perfis.get(role);

    if (!partidaVivo || estado.tempo < partidaVivo.memoria.ultimoTempo - 5) {
      const { novaMemoriaFalas } = await import('./vivo/falas.js');
      partidaVivo = { memoria: R.novaMemoria(), fichas: null, montandoFichas: null, memFalas: novaMemoriaFalas(), falas: [], seq: 0, flashes: new Map(), ultimoEstado: null, extras: null, montandoExtras: null, olho: null, memOlho: null, olhoLog: 0, mundo: null, pastaSitu: null, ultimoInstantaneo: 0, memCerebro: null, notas: null };
    }

    // Extras da voz (build, tipo de dano deles, quem está de main): uma vez
    // por partida, em segundo plano.
    if (!partidaVivo.extras && !partidaVivo.montandoExtras) {
      partidaVivo.montandoExtras = (async () => {
        const X = await import('./vivo/extras.js');
        const inimigos = estado.jogadores.filter((j) => j.time !== estado.eu.time);
        const role = estado.eu.role || 'jungle';
        const [build, dano] = await Promise.all([
          X.buildDaPartida(estado.eu.campeao, role, { regiao: config.runas?.regiao ?? 'br' }),
          X.perfilDeDano(inimigos),
        ]);
        partidaVivo.extras = { build, dano, mains: [] };
        // Mains: só sua lane e o jungler, pra não gastar chave à toa.
        const { tabelaDeCampeoes } = await import('./features/champ-select.js');
        const tabela = await tabelaDeCampeoes(lcu).catch(() => null);
        const alvos = inimigos.filter((j) => j.role === role || j.role === 'jungle');
        partidaVivo.extras.mains = await X.mainsDosInimigos(config.riot, alvos, tabela).catch(() => []);
      })().catch((erro) => { log(`extras da voz falharam: ${erro.message}`); partidaVivo.extras = { build: null, dano: null, mains: [] }; });
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
    const objs = objetivos(estado);
    // A voz: só o que é novo desde a última leitura, numerado pra tela
    // falar uma vez só.
    const { falasNovas } = await import('./vivo/falas.js');
    partidaVivo.ultimoEstado = estado;
    await garantirPastaSitu(estado);
    for (const ev of estado.eventos ?? []) {
      if (ev.tipo !== 'TurretKilled' || !ev.torre || /Turret_T\d_[LRC]_\d\d/.test(ev.torre)) continue;
      (partidaVivo.torresEstranhas ??= new Set());
      if (!partidaVivo.torresEstranhas.has(ev.torre)) { partidaVivo.torresEstranhas.add(ev.torre); log(`torre com nome desconhecido: ${ev.torre} (por ${ev.autor})`); }
    }
    // Retrato da API do jogo a cada 5 s (placar, itens, níveis, gold): contexto pras situações.
    if (partidaVivo.pastaSitu && Date.now() - ultimoRetrato >= 5000) {
      ultimoRetrato = Date.now();
      appendFile(resolve(partidaVivo.pastaSitu, 'estado.jsonl'), JSON.stringify({ t: Math.round(estado.tempo), eu: { ouro: estado.eu.ouro, vida: estado.eu.vida, vidaMax: estado.eu.vidaMax },
        jogadores: estado.jogadores.map((j) => ({ c: j.campeao, time: j.time, role: j.role, nivel: j.nivel, k: j.kills, m: j.mortes, a: j.assists, cs: j.cs, morto: j.morto, renasce: j.renasceEm, itens: (j.itens ?? []).map((i) => i.id) })),
        eventos: (estado.eventos ?? []).length }) + '\n').catch(() => {});
    }
    for (const f of [...falasNovas({ estado, rastreio, objetivos: objs, conselhos, extras: partidaVivo.extras }, partidaVivo.memFalas), ...falasDeFlash(estado.tempo)]) {
      partidaVivo.falas.push(prontaFala({ ...f, seq: ++seqFalas, t: estado.tempo }));
    }

    return {
      emJogo: true, estado, perfil, conselhos,
      contra: partidaVivo.fichas ?? [],
      vistos: rastreio.vistos,
      objetivos: objs,
      falas: partidaVivo.falas.slice(-12),
      flashes: [...partidaVivo.flashes.values()].map((f) => ({ campeao: f.campeao, volta: f.volta, em: Math.max(0, Math.round(f.volta - estado.tempo)) })),
      // O olho: minimapa achado? onde cada um foi visto pela última vez.
      olho: resumoDoOlho(estado),
      situacoes: (partidaVivo.situacoesRecentes ?? []).slice(-10), pastaSitu: partidaVivo.pastaSitu ? basename(partidaVivo.pastaSitu) : null,
      // Pro overlay: cada inimigo com a tecla que marca o flash dele.
      inimigos: estado.jogadores.filter((j) => j.time !== estado.eu.time).map((j, i) => {
        const f = partidaVivo.flashes.get(j.nome);
        const r = partidaVivo.memOlho?.porCampeao.get(j.nome);
        return { posicao: i + 1, campeao: j.campeao, role: j.role, morto: j.morto, nivel: j.nivel,
          tecla: config.atalhos?.flashes?.[['top', 'jungle', 'mid', 'adc', 'sup'].indexOf(j.role) >= 0 ? ['top', 'jungle', 'mid', 'adc', 'sup'].indexOf(j.role) : i] ?? null, flashEm: f ? Math.max(0, Math.round(f.volta - estado.tempo)) : null, flashMarcado: !!f,
          visto: r?.vistoEm ? { texto: r.texto, lane: r.lane, lado: r.lado, ha: Math.round((Date.now() - r.vistoEm) / 1000), x: r.x, y: r.y } : null };
      }),
    };
  }

  /**
   * Timer de flash: a API do jogo não diz quando alguém usou, então é você
   * quem marca (Ctrl+Alt+1..5 pela ordem dos inimigos na tela, ou botão na
   * janela ao vivo). Flash volta em 5:00 — 4:28 com bota da Ionia.
   */
  const IONIA = 3158;
  async function marcarFlash({ posicao, nome } = {}) {
    if (!partidaVivo?.ultimoEstado) await vivo().catch(() => null);
    if (!partidaVivo?.ultimoEstado) throw new Error('sem partida rodando');
    const e = partidaVivo.ultimoEstado;
    const inimigos = e.jogadores.filter((j) => j.time !== e.eu.time);
    // Tecla por FUNÇÃO (1 top, 2 jungle, 3 mid, 4 adc, 5 sup), não pela ordem da lista.
    const ROTA_DA_TECLA = ['top', 'jungle', 'mid', 'adc', 'sup'];
    const rota = ROTA_DA_TECLA[Number(posicao) - 1];
    const alvo = nome ? inimigos.find((j) => j.nome === nome || j.campeao === nome) : (inimigos.find((j) => j.role === rota) ?? inimigos[Number(posicao) - 1]);
    if (!alvo) throw new Error('inimigo não achado');
    // Aceleração de feitiço: bota da Ionia (+12) e Percepção Cósmica (+18, se
    // ele tem a árvore Inspiração — a API só mostra a árvore, não a runa; assume
    // que tem, porque errar pra menos é pior: o flash volta ANTES do avisado).
    const temIonia = (alvo.itens ?? []).some((i) => i.id === IONIA);
    const temInspiracao = [alvo.runas?.primaria, alvo.runas?.secundaria].some((a) => /inspira/i.test(a ?? ''));
    const haste = (temIonia ? 12 : 0) + (temInspiracao ? 18 : 0);
    const cd = Math.round(300 / (1 + haste / 100));
    const volta = e.tempo + cd;
    const cdTxt = `${Math.floor(cd / 60)}:${String(cd % 60).padStart(2, '0')}`;
    partidaVivo.flashes.set(alvo.nome, { campeao: alvo.campeao, nomeJogador: alvo.nome, usadoEm: e.tempo, volta, avisado60: false, avisadoVolta: false });
    compartilharFlash(alvo, e).catch((erro) => log(`flash compartilhado falhou: ${erro.message}`));
    partidaVivo.falas.push(prontaFala({ seq: ++seqFalas, t: e.tempo, modulo: 'flash', prioridade: 2,
      serio: F`Flash do ${alvo.campeao} marcado. Volta em ${cdTxt}${temInspiracao ? ', se tiver Percepção Cósmica' : ''}.`,
      divertido: F`${alvo.campeao} sem flash por ${cdTxt}.` }));
    log(`flash do ${alvo.campeao} marcado aos ${Math.floor(e.tempo / 60)}:${String(Math.floor(e.tempo % 60)).padStart(2, '0')} (volta em ${cdTxt}: ionia ${temIonia ? 'sim' : 'não'}, inspiração ${temInspiracao ? 'sim' : 'não'})`);
    return { ok: true, campeao: alvo.campeao, volta };
  }
  /**
   * O olho (janela escondida olho.html) manda 5x por segundo o que viu no
   * minimapa. As falas do jungler saem daqui na hora, sem esperar a próxima
   * leitura da janela ao vivo.
   */
  /** Guarda o recorte do minimapa em dados/olho/<partida>/ — no máximo 40 por partida, 6 partidas. */
  async function olhoFoto(png, meta) {
    const id = partidaVivo?.ultimoEstado ? `${new Date().toISOString().slice(0, 10)}-${(partidaVivo.ultimoEstado.eu?.campeao ?? 'x').toLowerCase()}` : 'sem-partida';
    const pasta = resolve(pastaBase(), 'dados', 'olho', id);
    await mkdir(pasta, { recursive: true });
    const n = String(Math.floor((partidaVivo?.ultimoEstado?.tempo ?? 0))).padStart(4, '0');
    await writeFile(resolve(pasta, `${n}.png`), png);
    await writeFile(resolve(pasta, `${n}.json`), JSON.stringify({ ...meta, tempo: partidaVivo?.ultimoEstado?.tempo ?? null, jogadores: partidaVivo?.ultimoEstado?.jogadores?.map((j) => ({ campeao: j.campeao, time: j.time, role: j.role, morto: j.morto })) ?? [] }));
    // limpa partidas velhas
    const pastas = (await readdir(resolve(pastaBase(), 'dados', 'olho')).catch(() => [])).sort();
    for (const velha of pastas.slice(0, -6)) await rm(resolve(pastaBase(), 'dados', 'olho', velha), { recursive: true, force: true }).catch(() => {});
  }
  async function receberOlho(dados) {
    if (dados?.erro) { log(`olho: ${dados.erro}`); return; }
    if (!partidaVivo?.ultimoEstado) return;
    if (!partidaVivo.memOlho) {
      const { novaMemoriaOlho } = await import('./vivo/olho.js');
      partidaVivo.memOlho = novaMemoriaOlho();
    }
    const antes = partidaVivo.olho;
    partidaVivo.olho = { ...dados, recebidoEm: Date.now() };
    if (dados.calib && (!antes?.calib || antes.calib.s !== dados.calib.s)) log(`olho: minimapa ${dados.calib.s}px (score ${dados.calib.score})${dados.escala ? `, ícone ${dados.escala.d}px` : ''}`);
    if (!dados.calib && antes?.calib !== null && Date.now() - partidaVivo.olhoLog > 30000) { partidaVivo.olhoLog = Date.now(); log('olho: não achei o minimapa (jogo em tela cheia exclusiva? overlay por cima?)'); }
    // Cego (nada reconhecido há 15 s+ com o minimapa achado, depois de 1:00 de jogo): avisa uma vez por episódio
    const eAgora = partidaVivo.ultimoEstado;
    const cegoAgora = !!dados.calib && (dados.cego ?? 0) >= 15 && (eAgora?.tempo ?? 0) > 60;
    if (cegoAgora && !partidaVivo.cegoAvisado) {
      partidaVivo.cegoAvisado = true;
      partidaVivo.falas.push(prontaFala({ seq: ++seqFalas, t: eAgora.tempo, modulo: 'mapa', prioridade: 2, serio: F`Olho cego: tem janela na frente do jogo.`, divertido: F`Olho cego: tira a janela da frente do jogo.` }));
      log('olho: cego — avisei');
    } else if (!cegoAgora && partidaVivo.cegoAvisado && (dados.vistos?.length || dados.aliados?.length || dados.eu)) {
      partidaVivo.cegoAvisado = false;
      log('olho: voltou a enxergar');
    }
    // O mundo: posições, direções, quem sumiu → situações (todas gravadas,
    // parte falada). É a matéria-prima pra depois aprender o que vale falar.
    const S = await import('./vivo/situacoes.js');
    const { objetivos } = await import('./vivo/objetivos.js');
    const e = partidaVivo.ultimoEstado;
    if (!partidaVivo.mundo) partidaVivo.mundo = S.novoMundo();
    await garantirPastaSitu(e);
    const objs = objetivos(e);
    (partidaVivo.contSitu ??= { total: 0, faladas: 0, leituras: 0, porTipo: new Map() }).leituras++;
    // Onde você mais morre nessa rota (banco, últimas 60 partidas): entra como contexto das situações.
    if (partidaVivo.mortesZona === undefined) {
      partidaVivo.mortesZona = null;
      try {
        const role = { top: 'TOP', jungle: 'JUNGLE', mid: 'MID', adc: 'ADC', sup: 'SUPORTE' }[e.eu.role] ?? null;
        const jogos = db.prepare(`SELECT gameId FROM partidas WHERE duracaoS >= 300${role ? ' AND minhaRole = ?' : ''} ORDER BY quando DESC LIMIT 60`).all(...(role ? [role] : []));
        if (jogos.length >= 10) {
          const ids = jogos.map((r) => r.gameId);
          const linhas = db.prepare(`SELECT zona, COUNT(*) n FROM achados WHERE tipo = 'morte' AND gameId IN (${ids.map(() => '?').join(',')}) GROUP BY zona`).all(...ids);
          partidaVivo.mortesZona = { jogos: jogos.length, porZona: Object.fromEntries(linhas.map((l) => [l.zona, l.n])) };
        }
      } catch { /* sem banco, sem contexto */ }
    }
    const situacoes = S.processar(partidaVivo.mundo, { vistos: dados.vistos ?? [], aliados: dados.aliados ?? [], eu: dados.eu ?? null, waves: dados.waves ?? null, wards: dados.wards ?? null, mortesZona: partidaVivo.mortesZona }, e, objs);
    const gravar = (arquivo, obj) => appendFile(resolve(partidaVivo.pastaSitu, arquivo), JSON.stringify(obj) + '\n').catch(() => {});
    const Cb = await import('./vivo/cerebro.js');
    partidaVivo.memCerebro ??= Cb.novaMemoriaCerebro();
    const LANE_DE = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'bot', sup: 'bot' };
    Cb.decidir(situacoes, { t: e.tempo, minhaLane: LANE_DE[e.eu.role] ?? null, minhaRole: e.eu.role, notas: partidaVivo.notas, silenciadas: partidaVivo.silenciadas }, partidaVivo.memCerebro);
    for (const sit of situacoes) {
      const pronta = prontaFala({ modulo: sit.modulo, prioridade: sit.prioridade, serio: sit.serio, divertido: sit.divertido, seq: sit.falar ? ++seqFalas : 0, t: e.tempo });
      gravar('situacoes.jsonl', { t: Math.round(e.tempo * 10) / 10, chave: sit.chave, tipo: sit.tipo, prioridade: sit.prioridade, nota: sit.nota, modulo: sit.modulo, falada: sit.falar, texto: pronta.serio, dados: sit.dados,
        contexto: { kills: e.eu.kills, mortes: e.eu.mortes, ouro: e.eu.ouro, nivel: e.eu.nivel, vida: e.vidaMax ? Math.round(100 * e.eu.vida / e.eu.vidaMax) : null, eu: dados.eu ?? null } });
      if (sit.falar) partidaVivo.falas.push(pronta);
      const cs = (partidaVivo.contSitu ??= { total: 0, faladas: 0, leituras: 0, porTipo: new Map() });
      cs.total++; if (sit.falar) cs.faladas++; cs.porTipo.set(sit.tipo, (cs.porTipo.get(sit.tipo) ?? 0) + 1);
      (partidaVivo.situacoesRecentes ??= []).push({ t: Math.round(e.tempo * 10) / 10, chave: sit.chave, tipo: sit.tipo, prioridade: sit.prioridade, texto: pronta.serio, falada: sit.falar });
      if (partidaVivo.situacoesRecentes.length > 20) partidaVivo.situacoesRecentes.splice(0, partidaVivo.situacoesRecentes.length - 20);
    }
    // foto do mundo 1x por segundo
    if (Date.now() - partidaVivo.ultimoInstantaneo >= 1000) {
      partidaVivo.ultimoInstantaneo = Date.now();
      gravar('leituras.jsonl', S.instantaneo(partidaVivo.mundo, e));
    }
  }
  function resumoDoOlho(estado) {
    const o = partidaVivo?.olho;
    if (!o) return { ligado: false };
    const velho = Date.now() - o.recebidoEm > 5000;
    const pg = partidaVivo.mundo?.previsaoGank;
    return { ligado: !velho, minimapa: !!o.calib, icone: o.escala?.d ?? null, confiavel: !!o.escala?.confiavel,
      gankPrevisto: pg && !pg.dito && (estado?.tempo ?? 0) < pg.ate + 30 ? { lane: pg.lane, de: pg.de, ate: pg.ate } : null,
      // buffs e camps deles vistos com o jungler: quando renascem
      timers: [...(partidaVivo.mundo?.buffs ?? []).map((b) => ({ nome: b.nome === 'red' ? 'Red deles' : 'Azul deles', em: b.em + 300 })), ...(partidaVivo.mundo?.camps ?? []).map((c) => ({ nome: `${c.nome} deles`, em: c.em + 135 }))].filter((x) => x.em - (estado?.tempo ?? 0) > -20 && x.em - (estado?.tempo ?? 0) < 300).map((x) => ({ nome: x.nome, em: Math.round(x.em - (estado?.tempo ?? 0)) })),
      eu: o.eu ?? null, cego: !!o.calib && (o.cego ?? 0) >= 15,
      avaliada: partidaVivo.avaliadaAgora && Date.now() - partidaVivo.avaliadaAgora.t < 4000 ? partidaVivo.avaliadaAgora : null,
      vistos: (o.vistos ?? []).map((v) => ({ campeao: v.campeao, x: v.x, y: v.y })),
      ha: Math.round((Date.now() - o.recebidoEm) / 1000) };
  }
  /** Aceleração de feitiço de um jogador agora (bota da Ionia + árvore Inspiração). */
  const hasteDe = (j) => ((j.itens ?? []).some((i) => i.id === IONIA) ? 12 : 0) + ([j.runas?.primaria, j.runas?.secundaria].some((x) => /inspira/i.test(x ?? '')) ? 18 : 0);
  /**
   * Flash compartilhado: quem marca avisa os amigos que estão na MESMA
   * partida e no MESMO time com o app. Passa pelo repositório de controle
   * (arquivo partidas/<gameId>.json), lido a cada 8 s com ETag — barato e
   * sem servidor. Atraso de uns 10 s no pior caso.
   */

  async function salaDaPartida() {
    if (!tokenControle() || !lcu.conectado) return null;
    if (!sala.gameId) sala.gameId = await lcu.get('/lol-gameflow/v1/session').then((s) => s?.gameData?.gameId ?? null).catch(() => null);
    return sala.gameId ? `partidas/${sala.gameId}.json` : null;
  }
  async function compartilharFlash(alvo, e) {
    const caminho = await salaDaPartida(); if (!caminho) return;
    const C = await import('./dados/controle.js');
    const eu = estado?.instantaneo?.().conta ?? config.riot?.gameName ?? 'alguém';
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const atual = await C.lerArquivo(tokenControle(), caminho).catch(() => null);
      const dados = atual?.dados ?? { flashes: {} };
      dados.flashes[alvo.nome] = { campeao: alvo.campeao, usadoEm: Math.round(e.tempo), time: e.eu.time, por: String(eu).split('#')[0], em: new Date().toISOString() };
      try { await C.gravarArquivo(tokenControle(), caminho, dados, `flash ${alvo.campeao}`); sala.vistos.add(`${alvo.nome}|${Math.round(e.tempo)}`); return; }
      catch (erro) { if (tentativa) throw erro; }   // sha velho: lê de novo e tenta uma vez
    }
  }
  async function receberFlashes() {
    if (!partidaVivo?.ultimoEstado || Date.now() - sala.ultimaLeitura < 8000) return;
    sala.ultimaLeitura = Date.now();
    const caminho = await salaDaPartida(); if (!caminho) return;
    const C = await import('./dados/controle.js');
    const r = await C.lerArquivoSeMudou(tokenControle(), caminho, sala.etag).catch(() => null);
    if (!r || r.igual) return;
    sala.etag = r.etag;
    const e = partidaVivo.ultimoEstado;
    for (const [nome, f] of Object.entries(r.dados?.flashes ?? {})) {
      const chave = `${nome}|${f.usadoEm}`;
      if (sala.vistos.has(chave) || f.time !== e.eu.time) continue;
      sala.vistos.add(chave);
      const alvo = e.jogadores.find((j) => j.nome === nome); if (!alvo) continue;
      const local = partidaVivo.flashes.get(nome);
      if (local && Math.abs(local.usadoEm - f.usadoEm) < 20) continue;   // eu já tinha marcado
      const cd = Math.round(300 / (1 + hasteDe(alvo) / 100));
      partidaVivo.flashes.set(nome, { campeao: alvo.campeao, nomeJogador: nome, usadoEm: f.usadoEm, volta: f.usadoEm + cd, avisado60: false, avisadoVolta: false });
      partidaVivo.falas.push(prontaFala({ seq: ++seqFalas, t: e.tempo, modulo: 'flash', prioridade: 1, serio: F`Flash do ${alvo.campeao} marcado pelo ${f.por}.`, divertido: F`${f.por} marcou o flash do ${alvo.campeao}.` }));
      log(`flash do ${alvo.campeao} veio do ${f.por}`);
    }
  }
  function falasDeFlash(tempo) {
    receberFlashes().catch(() => {});
    const novas = [];
    // Comprou a bota depois de marcar? O tempo de volta acompanha.
    for (const f of partidaVivo.flashes.values()) {
      const j = partidaVivo.ultimoEstado?.jogadores.find((x) => x.nome === f.nomeJogador);
      if (j) f.volta = f.usadoEm + Math.round(300 / (1 + hasteDe(j) / 100));
    }
    for (const f of partidaVivo.flashes.values()) {
      const em = f.volta - tempo;
      if (!f.avisado60 && em <= 60 && em > 0) { f.avisado60 = true; novas.push({ modulo: 'flash', prioridade: 1, serio: F`Flash do ${f.campeao} volta em um minuto.`, divertido: F`Um minuto e o ${f.campeao} tem flash de novo. Aproveita agora.` }); }
      if (!f.avisadoVolta && em <= 0) { f.avisadoVolta = true; novas.push({ modulo: 'flash', prioridade: 2, serio: F`Flash do ${f.campeao} está de volta.`, divertido: F`${f.campeao} tem flash de novo. Acabou a farra.` }); }
    }
    return novas;
  }

  /**
   * Seleção de campeão pra tela ao vivo: quem eles já travaram e, pelos
   * confrontos do op.gg, qual dos seus picks da rota ganha mais deles.
   */
  let selecaoCache = { chave: null, sugestao: null };
  let selecaoMem = { gameId: null, ditas: new Set(), falas: [] };
  async function selecaoAtual() {
    if (!lcu.conectado) return null;
    const s = await lcu.get('/lol-champ-select/v1/session').catch(() => null);
    if (!s?.myTeam || (s.localPlayerCellId ?? -1) < 0) return null;
    const meu = s.myTeam.find((c) => c.cellId === s.localPlayerCellId);
    const rota = meu?.assignedPosition || config.champSelect?.rolePadrao || 'jungle';
    const { tabelaDeCampeoes } = await import('./features/champ-select.js');
    const tabela = await tabelaDeCampeoes(lcu).catch(() => null);
    const nomeDe = (id) => tabela?.porId.get(id) ?? null;
    const inimigos = (s.theirTeam ?? []).map((c) => c.championId).filter((id) => id > 0);
    const aliados = (s.myTeam ?? []).map((c) => c.championId || c.championPickIntent).filter((id) => id > 0);
    const candidatos = (config.champSelect?.picks?.[rota] ?? []).filter(Boolean);
    const chave = `${rota}|${inimigos.join(',')}|${candidatos.join(',')}`;
    if (inimigos.length && candidatos.length && tabela && selecaoCache.chave !== chave) {
      selecaoCache = { ...selecaoCache, chave, sugestao: null };
      const [{ confrontoContra }, { sugerirPick }] = await Promise.all([import('./dados/confrontos.js'), import('./vivo/falas.js')]);
      selecaoCache.sugestao = await sugerirPick({ candidatos, rota, inimigosIds: inimigos, confrontoContra, tabela, opcoes: { regiao: config.runas?.regiao ?? 'br' } }).catch(() => null);
    }
    const meuCampeao = nomeDe(meu?.championId || meu?.championPickIntent) ?? null;
    // Seleção nova: zera o que já foi dito.
    if (selecaoMem.gameId !== (s.gameId ?? null)) selecaoMem = { gameId: s.gameId ?? null, ditas: new Set(), falas: [] };
    // Sugestão de ban pela SUA história: quem mais te ganha nesta rota.
    let sugestaoBan = [];
    try {
      const E = await import('./analise/estatisticas.js');
      const chaveDb = { top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', utility: 'SUPORTE' }[rota];
      const logada = estado?.instantaneo?.().conta ?? null;
      sugestaoBan = (E.piores(db, { minimo: 5, conta: logada ? logada.split('#')[0] : null })[chaveDb] ?? []).filter((x) => x.custo > 0.5).slice(0, 2);
    } catch { /* sem histórico */ }
    const { falasDaSelecao } = await import('./vivo/falas.js');
    const runas = ultimasRunas && meuCampeao && ultimasRunas.campeao === meuCampeao ? ultimasRunas : null;
    // Contexto útil: confronto do seu campeão com cada um deles, jungler deles, tipo de dano.
    let confrontos = [], junglerDeles = null, dano = null;
    try {
      const nomesIni = inimigos.map((id) => nomeDe(id)).filter(Boolean);
      const { JUNGLERS } = await import('./vivo/junglers.js');
      const jgNome = nomesIni.find((n) => JUNGLERS[n]);
      if (jgNome) junglerDeles = { nome: jgNome, dica: JUNGLERS[jgNome] };
      if (meuCampeao && inimigos.length) {
        const chaveC = `${meuCampeao}|${rota}|${inimigos.join(',')}`;
        if (selecaoCache.chaveConfrontos !== chaveC) {
          const { confrontoContra } = await import('./dados/confrontos.js');
          const lista = [];
          for (const id of inimigos) { const c = await confrontoContra(meuCampeao, rota, id, { regiao: config.runas?.regiao ?? 'br' }).catch(() => null); if (c) lista.push({ id, campeao: nomeDe(id), taxa: c.taxa, jogos: c.jogos }); }
          selecaoCache.chaveConfrontos = chaveC; selecaoCache.confrontos = lista;
        }
        confrontos = selecaoCache.confrontos ?? [];
      }
      if (nomesIni.length >= 4) { const X = await import('./vivo/extras.js'); dano = await X.perfilDeDano(nomesIni.map((n) => ({ campeao: n }))); }
    } catch { /* sem contexto, segue com o básico */ }
    for (const f of falasDaSelecao({ rota, inimigos: inimigos.map((id) => ({ id, nome: nomeDe(id) })), aliados, meuCampeao, sugestaoBan, runas, confrontos, junglerDeles, dano }, selecaoMem)) {
      selecaoMem.falas.push(prontaFala({ ...f, seq: ++seqFalas }));
    }
    return {
      fase: s.timer?.phase ?? '', rota, meuCampeao,
      inimigos: inimigos.map((id) => ({ id, nome: nomeDe(id) })), aliados: aliados.map((id) => ({ id, nome: nomeDe(id) })),
      sugestao: selecaoCache.chave === chave && selecaoCache.sugestao ? { ...selecaoCache.sugestao, fala: selecaoCache.sugestao.fala ? prontaFala(selecaoCache.sugestao.fala) : null } : null,
      sugestaoBan, falas: selecaoMem.falas.slice(-8),
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
    aoConfig?.(config);
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

  /* ------------------------------------------------------------- voz */
  // Vozes neurais do Edge (grátis). Texto entra, mp3 sai; cache em dados/voz.
  const vozCfg = () => ({ motor: config.voz?.motor ?? 'edge', vozId: config.voz?.vozId || 'pt-BR-AntonioNeural', ritmo: config.voz?.ritmo || '+5%' });
  async function vozVozes() {
    if (config.admin !== true) throw new Error('só pra admin');
    const { VOZES } = await import('./vivo/voz.js');
    return { vozes: VOZES, ...vozCfg() };
  }
  /** Catálogo de todas as falas (lido do próprio código) + o que o admin mudou. */
  async function vozFalas() {
    if (config.admin !== true) throw new Error('só pra admin');
    const { catalogo } = await import('./vivo/texto.js');
    const fontes = [];
    for (const [arquivo, opcoes] of [['./vivo/falas.js', {}], ['./vivo/olho.js', { secaoFixa: 'olho no minimapa' }], ['./vivo/situacoes.js', { secaoFixa: 'olho no minimapa' }], ['./daemon.js', { moduloFixo: 'flash', secaoFixa: 'flash' }]]) {
      fontes.push({ src: await readFile(new URL(arquivo, import.meta.url), 'utf8'), arquivo, ...opcoes });
    }
    return { catalogo: catalogo(fontes), personalizadas: config.voz?.falas ?? {} };
  }
  const vozEmAndamento = new Map();
  /** `voz`/`ritmo` opcionais servem pra ouvir uma voz antes de escolher. */
  async function vozFalar({ texto, voz, ritmo } = {}) {
    const [{ falarEdge }, { pronunciar }] = await Promise.all([import('./vivo/voz.js'), import('./vivo/pronuncia.js')]);
    texto = pronunciar(texto, config.voz?.pronuncia ?? null);   // "Kha'Zix" vira "Cazícs" só no áudio
    const v = { ...vozCfg(), ...(voz ? { vozId: voz } : {}), ...(ritmo ? { ritmo } : {}) };
    const chave = `${v.vozId}|${v.ritmo}|${texto}`;
    if (!vozEmAndamento.has(chave)) {
      vozEmAndamento.set(chave, falarEdge({ ...v, texto, pasta: resolve(pastaBase(), 'dados') }).finally(() => vozEmAndamento.delete(chave)));
    }
    return { corpo: await vozEmAndamento.get(chave), tipo: 'audio/mpeg' };
  }

  /**
   * Sugestões de nick enquanto ele digita (como o op.gg, só que com o que a
   * gente tem): amigos do client, amigos já adicionados e todo mundo que já
   * jogou com ou contra ele. A Riot não tem busca por nome; o op.gg usa um
   * índice próprio que não é público.
   */
  async function nicks({ q = '' } = {}) {
    const termo = String(q).trim().toLowerCase();
    if (termo.length < 2) return [];
    const norm = (s) => String(s ?? '').toLowerCase();
    const saida = new Map();
    const chaveDe = (nome, tag) => `${norm(nome)}#${norm(tag) || '?'}`;
    const poe = (x) => { const k = chaveDe(x.nome, x.tag); const antes = saida.get(k); saida.set(k, { ...(antes ?? {}), ...x, origens: [...new Set([...(antes?.origens ?? []), x.origem])] }); };

    if (lcu.conectado) {
      const amigosLol = await lcu.get('/lol-chat/v1/friends').catch(() => []);
      for (const f of amigosLol ?? []) {
        if (!norm(f.gameName).includes(termo)) continue;
        poe({ nome: f.gameName, tag: f.gameTag, icone: f.icon ?? null, online: f.availability ?? null, origem: 'client' });
      }
    }
    for (const a of listaDeAmigos()) if (norm(a.nome).includes(termo)) poe({ nome: a.nome, tag: a.tag, origem: 'amigo' });

    // Do banco: jogos com ele, última vez, último campeão. Sem tag pra partidas
    // antigas até o completarTags passar por elas.
    const linhas = db.prepare(`
      SELECT j.nome nome, MAX(j.tag) tag, COUNT(*) jogos, MAX(p.quando) ultima,
             (SELECT j2.championId FROM jogadores j2 JOIN partidas p2 ON p2.gameId = j2.gameId
              WHERE j2.nome = j.nome ORDER BY p2.quando DESC LIMIT 1) championId,
             SUM(CASE WHEN j.time = (SELECT m.time FROM jogadores m WHERE m.gameId = p.gameId AND m.participantId = p.meuId) THEN 1 ELSE 0 END) juntos
      FROM jogadores j JOIN partidas p ON p.gameId = j.gameId
      WHERE j.participantId <> p.meuId AND LOWER(j.nome) LIKE ? ESCAPE '\\'
      GROUP BY j.nome ORDER BY jogos DESC LIMIT 40`).all('%' + termo.replace(/[%_\\]/g, (c) => '\\' + c) + '%');
    for (const l of linhas) poe({ nome: l.nome, tag: l.tag || null, jogos: l.jogos, juntos: l.juntos, ultima: l.ultima, championId: l.championId, origem: 'partidas' });

    const peso = (x) => (norm(x.nome).startsWith(termo) ? 1000 : 0) + (x.origens.includes('client') ? 500 : 0) + (x.origens.includes('amigo') ? 300 : 0) + Math.min(200, (x.jogos ?? 0) * 5) + (x.tag ? 50 : 0);
    return [...saida.values()].sort((a, b) => peso(b) - peso(a)).slice(0, 8);
  }

  /**
   * Partidas antigas guardaram só o nome de cada jogador, sem a #tag. O
   * histórico do client entrega a tag de graça (sem gastar a chave da Riot),
   * então, com o client aberto e fora de partida, completa aos poucos.
   */
  let completandoTags = false;
  async function completarTags() {
    if (completandoTags || !lcu.conectado) return;
    completandoTags = true;
    try {
      const pendentes = db.prepare(`SELECT DISTINCT gameId FROM jogadores WHERE tag IS NULL ORDER BY gameId DESC LIMIT 60`).all();
      if (!pendentes.length) return;
      const upd = db.prepare('UPDATE jogadores SET tag = ?, puuid = ? WHERE gameId = ? AND participantId = ?');
      let feitas = 0;
      for (const { gameId } of pendentes) {
        if (!lcu.conectado || faseAnterior === 'InProgress' || faseAnterior === 'ChampSelect') break;
        const jogo = await lcu.get(`/lol-match-history/v1/games/${gameId}`).catch(() => null);
        if (!jogo?.participantIdentities) { db.prepare("UPDATE jogadores SET tag = '' WHERE gameId = ? AND tag IS NULL").run(gameId); continue; }
        for (const pi of jogo.participantIdentities) upd.run(pi.player?.tagLine ?? '', pi.player?.puuid ?? null, gameId, pi.participantId);
        feitas++;
        await new Promise((r) => setTimeout(r, 350));
      }
      if (feitas) log(`tags completadas em ${feitas} partidas`);
      if (pendentes.length === 60) setTimeout(completarTags, 5_000);
    } catch (erro) { log(`completar tags: ${erro.message}`); }
    finally { completandoTags = false; }
  }
  lcu.on('conectado', () => setTimeout(completarTags, 45_000));
  setInterval(completarTags, 30 * 60 * 1000);

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
    amigos, amigoPerfil, adicionarAmigo, removerAmigo, nicks, vozVozes, vozFalar, vozFalas, olhoFoto,
    adminUsuarios, adminGravarControle, adminEsquecer, sessao, marcadas, marcar, marcarFlash, olho: receberOlho, situacoesPartidas, situacoesDe, avaliarSituacao, avaliarUltima, situacoesResumo,
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
  'amigos', 'amigoPerfil', 'adicionarAmigo', 'removerAmigo', 'nicks', 'vozVozes', 'vozFalar', 'vozFalas',
  'adminUsuarios', 'adminGravarControle', 'adminEsquecer', 'sessao', 'marcadas', 'marcar', 'marcarFlash', 'olho', 'olhoFoto', 'situacoesPartidas', 'situacoesDe', 'avaliarSituacao', 'avaliarUltima', 'situacoesResumo',
];
