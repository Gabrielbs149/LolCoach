import { aplicarBuildDoOpgg } from './runas.js';
import { aplicarConjunto } from './item-sets.js';

/** Mapa nome -> championId, direto dos dados do próprio client. */
export async function tabelaDeCampeoes(lcu) {
  const lista = await lcu.get('/lol-game-data/assets/v1/champion-summary.json');
  const porNome = new Map();
  const porId = new Map();
  for (const c of lista) {
    if (c.id <= 0) continue;
    porNome.set(c.name.toLowerCase(), c.id);
    if (c.alias) porNome.set(c.alias.toLowerCase(), c.id);
    porId.set(c.id, c.name);
  }
  return { porNome, porId };
}

const normalizar = (s) => String(s).toLowerCase().trim();

/** Campeões que já não podem mais ser escolhidos nesta seleção. */
function indisponiveis(sessao) {
  const fora = new Set();
  for (const id of sessao.bans?.myTeamBans ?? []) fora.add(id);
  for (const id of sessao.bans?.theirTeamBans ?? []) fora.add(id);
  for (const grupo of sessao.actions ?? []) {
    for (const a of grupo) {
      if (a.championId > 0 && (a.completed || a.type === 'ban')) fora.add(a.championId);
    }
  }
  for (const c of sessao.myTeam ?? []) if (c.championId > 0) fora.add(c.championId);
  return fora;
}

/** Primeiro campeão da lista de preferência que ainda está livre. */
function primeiroLivre(nomes, tabela, fora, permitidos) {
  for (const nome of nomes ?? []) {
    const id = tabela.porNome.get(normalizar(nome));
    if (!id || fora.has(id)) continue;
    if (permitidos && !permitidos.has(id)) continue;
    return { id, nome: tabela.porId.get(id) ?? nome };
  }
  return null;
}

/**
 * Automatiza banimento e escolha na seleção de campeões, e aplica as runas do
 * op.gg assim que o campeão está definido.
 *
 * Por segurança o pick vem em modo "hover" por padrão: o app declara o campeão
 * mas quem trava é você. Ligar `travarPick` no config faz ele travar sozinho.
 *
 * Duas decisões de robustez, ambas por bug real:
 *
 * 1. **Nada aqui pode falhar calado.** A versão anterior tinha três saídas
 *    silenciosas (tabela de campeões que não carregou, célula não encontrada,
 *    nenhuma ação em andamento) e uma seleção inteira passou sem banir nem
 *    escolher, sem UMA linha no registro dizendo por quê.
 *
 * 2. **Não depende só do WebSocket.** Enquanto a seleção está aberta, a sessão
 *    também é consultada de segundo em segundo. Se um evento do client se
 *    perder, a janela de ~30s do ban continua sendo pega.
 */
export function autoChampSelect(lcu, config, { log = () => {} } = {}) {
  let tabela = null;
  let carregandoTabela = null;
  let fase = { acaoFeita: null, runasDe: null, anunciou: false };
  let sonda = null;
  let avaliando = false;

  const zerarFase = () => { fase = { acaoFeita: null, runasDe: null, anunciou: false }; };
  const pararSonda = () => { if (sonda) { clearInterval(sonda); sonda = null; } };

  /** Uma carga só, mesmo com vários eventos chegando juntos. */
  async function pegarTabela() {
    if (tabela) return tabela;
    carregandoTabela ??= tabelaDeCampeoes(lcu)
      .then((t) => { tabela = t; return t; })
      .finally(() => { carregandoTabela = null; });
    return carregandoTabela;
  }

  async function avaliar(sessao) {
    if (!sessao) return;

    // Lido a cada evento, não capturado uma vez: assim o que você muda na tela
    // de configuração vale já na próxima seleção, sem reabrir o programa.
    const cfg = config.champSelect ?? {};
    await pegarTabela();

    const meuCell = sessao.myTeam?.find((c) => c.cellId === sessao.localPlayerCellId);
    if (!meuCell) {
      if (!fase.anunciou) {
        fase.anunciou = true;
        log(`seleção aberta, mas não me achei no time (célula ${sessao.localPlayerCellId}) — não vou agir`);
      }
      return;
    }

    // assignedPosition vem vazio em modos sem seleção de rota.
    const role = meuCell.assignedPosition || cfg.rolePadrao || 'jungle';

    if (!fase.anunciou) {
      fase.anunciou = true;
      const picks = cfg.picks?.[role] ?? [];
      const bans = cfg.bans?.[role] ?? [];
      log(`seleção aberta como ${role} — banir: ${bans.join(', ') || '(lista vazia)'} | pegar: ${picks.join(', ') || '(lista vazia)'}`);
      if (cfg.ativo === false) log('agir na seleção está DESLIGADO na configuração');
    }

    /* ---- ação em andamento (ban ou pick) ---- */
    if (cfg.ativo !== false) {
      const minha = (sessao.actions ?? []).flat().find(
        (a) => a.actorCellId === sessao.localPlayerCellId && !a.completed && a.isInProgress);

      // A tela tem um interruptor pra escolher e outro pra banir.
      const desligada = minha && (minha.type === 'ban' ? cfg.banir === false : cfg.escolher === false);
      if (minha && desligada && fase.acaoFeita !== minha.id) {
        fase.acaoFeita = minha.id;
        log(`${minha.type === 'ban' ? 'banir' : 'escolher'} está desligado na configuração — deixando com você`);
      }

      if (minha && !desligada && fase.acaoFeita !== minha.id) {
        const fora = indisponiveis(sessao);
        const lista = minha.type === 'ban' ? cfg.bans?.[role] : cfg.picks?.[role];
        const escolha = primeiroLivre(lista, tabela, fora);

        if (!escolha) {
          // Nenhuma preferência disponível: não inventa, deixa pra você.
          fase.acaoFeita = minha.id;
          const motivo = (lista ?? []).length
            ? `todos já foram: ${lista.join(', ')}`
            : `sua lista de ${minha.type === 'ban' ? 'bans' : 'picks'} de ${role} está vazia`;
          log(`é a sua vez de ${minha.type === 'ban' ? 'banir' : 'escolher'} e não agi — ${motivo}`);
        } else {
          fase.acaoFeita = minha.id;
          const travar = minha.type === 'ban' ? cfg.travarBan !== false : cfg.travarPick === true;
          const espera = minha.type === 'ban' ? (cfg.atrasoBanMs ?? 2000) : (cfg.atrasoPickMs ?? 2500);
          log(`minha vez de ${minha.type === 'ban' ? 'banir' : 'escolher'} — ${escolha.nome} em ${espera}ms`);

          setTimeout(async () => {
            try {
              // Dois passos, como o client faz: o PATCH só DECLARA (deixa o
              // campeão em cima do retrato); quem trava de verdade é o
              // POST .../complete. Mandar `completed: true` no PATCH voltava
              // 200 e o registro dizia "travou", mas o campeão ficava só
              // declarado — foi o que ele viu na partida personalizada.
              await lcu.patch(`/lol-champ-select/v1/session/actions/${minha.id}`, { championId: escolha.id });
              if (travar) await lcu.post(`/lol-champ-select/v1/session/actions/${minha.id}/complete`);
              log(`${minha.type === 'ban' ? 'baniu' : (travar ? 'travou' : 'declarou')} ${escolha.nome}`);
              if (minha.type === 'pick' && !travar) {
                log('travar o pick é com você (travarPick está desligado na configuração)');
              }
            } catch (erro) {
              fase.acaoFeita = null;   // deixa tentar de novo no próximo evento
              log(`falhou ao ${minha.type === 'ban' ? 'banir' : 'escolher'} ${escolha.nome}: ${erro.message}`);
            }
          }, espera);
        }
      }
    }

    /* ---- runas, assim que o campeão estiver definido ---- */
    const meuCampeaoId = meuCell.championId || 0;
    if (config.runas?.ativo !== false && meuCampeaoId > 0 && fase.runasDe !== meuCampeaoId) {
      fase.runasDe = meuCampeaoId;
      const nome = tabela.porId.get(meuCampeaoId);
      try {
        const build = await aplicarBuildDoOpgg(lcu, nome, role, {
          regiao: config.runas?.regiao ?? 'br',
          criterio: config.runas?.criterio ?? 'popular',
          aplicarSpells: config.runas?.aplicarSpells === true,
          paginaAlvo: config.runas?.paginaAlvo ?? null,
        });
        log(`runas de ${nome} ${build.role} aplicadas (${build.runas.estatistica}, ${build.fonte})`);
        // O conjunto de itens da loja pra este campeão nesta role — usa o mesmo
        // cache do op.gg, então quase sempre é instantâneo.
        aplicarConjunto(lcu, nome, meuCampeaoId, role, { regiao: config.runas?.regiao ?? 'br' })
          .then((r) => log(`itens de ${r.campeao} ${r.role} gravados na loja (${r.blocos} blocos)`))
          .catch((erro) => log(`não consegui gravar os itens de ${nome}: ${erro.message}`));
      } catch (erro) {
        log(`não consegui aplicar runas de ${nome}: ${erro.message}`);
      }
    }
  }

  /**
   * Casca única de segurança. Duas coisas de uma vez:
   * - nenhuma exceção some (rejeição dentro de callback de evento é invisível);
   * - nunca há duas avaliações ao mesmo tempo, então o evento e a sonda não
   *   podem mandar o mesmo ban duas vezes.
   */
  const avaliarSeguro = async (sessao) => {
    if (avaliando) return;
    avaliando = true;
    try { await avaliar(sessao); }
    catch (erro) { log(`erro na seleção de campeão: ${erro.message}`); }
    finally { avaliando = false; }
  };

  lcu.observar('/lol-champ-select/v1/session', (sessao) => {
    if (!sessao) return zerarFase();
    avaliarSeguro(sessao);
  });

  function ligarSonda() {
    // Rede de segurança: consulta a sessão direto, sem depender do evento.
    if (sonda) return;
    sonda = setInterval(async () => {
      try {
        await avaliarSeguro(await lcu.get('/lol-champ-select/v1/session'));
      } catch (erro) {
        if (erro.status !== 404) log(`não consegui ler a seleção: ${erro.message}`);
      }
    }, 1000);
  }

  lcu.observar('/lol-gameflow/v1/gameflow-phase', (f) => {
    if (f !== 'ChampSelect') { pararSonda(); return zerarFase(); }
    ligarSonda();
  });

  // Se o app subir (ou reconectar) com a seleção já aberta, não existe evento de
  // troca de fase pra ouvir — o estado tem que ser perguntado.
  lcu.on('conectado', async () => {
    try {
      if (await lcu.get('/lol-gameflow/v1/gameflow-phase') === 'ChampSelect') ligarSonda();
    } catch { /* client ainda subindo; o evento de fase resolve */ }
  });

  return lcu;
}
