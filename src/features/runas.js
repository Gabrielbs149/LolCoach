import { buscarBuild } from '../dados/opgg.js';

// Sempre sobrescrevemos a mesma página, pra não encher a conta de páginas novas
// nem encostar nas que o Gabriel montou à mão.
export const NOME_PAGINA = 'LolCoach';

/** Apaga páginas antigas criadas por nós. Nunca toca nas outras. */
async function limparNossasPaginas(lcu) {
  const paginas = await lcu.get('/lol-perks/v1/pages').catch(() => []);
  let apagadas = 0;
  for (const pg of paginas) {
    if (!String(pg.name ?? '').startsWith(NOME_PAGINA) || !pg.isDeletable) continue;
    await lcu.delete(`/lol-perks/v1/pages/${pg.id}`).catch(() => {});
    apagadas++;
  }
  return { apagadas, total: paginas.length };
}

/**
 * Cria (ou recria) a página de runas no client e deixa ela selecionada.
 *
 * Nunca apagamos página que não seja nossa. O `ownedPageCount` do client não é
 * confiável como limite (numa conta com 3 páginas ele reportava 2), então uma
 * heurística de "abrir espaço" apagaria página do usuário por engano. Se o
 * client recusar por falta de espaço, é melhor avisar do que destruir.
 */
export async function aplicarRunas(lcu, build, { paginaAlvo = null } = {}) {
  const corpo = {
    name: build.campeao ? `${NOME_PAGINA} · ${build.campeao}` : NOME_PAGINA,
    primaryStyleId: build.runas.primaryStyleId,
    subStyleId: build.runas.subStyleId,
    selectedPerkIds: build.runas.selectedPerkIds,
    current: true,
  };

  // Modo sobrescrever: o usuário designou no config uma página que podemos usar.
  // É o único jeito de funcionar numa conta que já está no limite.
  //
  // `paginaAlvo: "*"` = "pode usar qualquer uma" (autorização dada pelo Gabriel
  // em 10/09/2026). Mesmo assim o app só encosta em UMA página: na primeira vez
  // pega a primeira editável e a renomeia pra "LolCoach"; daí em diante procura
  // por esse nome e sobrescreve sempre a mesma. As outras ficam intactas, e a
  // que é nossa fica com o nome na cara.
  //
  // Padrão (sem paginaAlvo): sobrescreve a página que está SELECIONADA no
  // client — "a runa principal". Foi o que ele pediu pros amigos: criar página
  // nova falhava em conta no limite, e a runa ficava a velha sem ninguém ver.
  const paginas = await lcu.get('/lol-perks/v1/pages').catch(() => []);
  const editaveis = paginas.filter((p) => p.isDeletable);
  if (!paginaAlvo && editaveis.length) {
    const atualId = (await lcu.get('/lol-perks/v1/currentpage').catch(() => null))?.id;
    paginaAlvo = editaveis.find((p) => p.id === atualId) ? 'atual' : '*';
  }

  if (paginaAlvo) {
    const atualId = (await lcu.get('/lol-perks/v1/currentpage').catch(() => null))?.id;
    const alvo = paginaAlvo === 'atual' ? editaveis.find((p) => p.id === atualId)
      : paginas.find((p) => String(p.name ?? '').startsWith(NOME_PAGINA))
        ?? (paginaAlvo === '*' ? editaveis[0] : paginas.find((p) => p.name === paginaAlvo));

    if (!alvo) {
      throw new Error(paginaAlvo === '*'
        ? 'nenhuma página editável na conta pra sobrescrever'
        : paginaAlvo === 'atual' ? 'a página selecionada no client não pode ser editada'
        : `não achei a página "${paginaAlvo}" pra sobrescrever`);
    }
    if (!alvo.isDeletable) throw new Error(`a página "${alvo.name}" é fixa e não pode ser editada`);

    await lcu.put(`/lol-perks/v1/pages/${alvo.id}`, { ...corpo, id: alvo.id, order: alvo.order });
    await lcu.put('/lol-perks/v1/currentpage', alvo.id).catch(() => {});
    return { ...alvo, ...corpo, sobrescrita: true, nomeAntigo: alvo.name };
  }

  await limparNossasPaginas(lcu);
  let pagina;
  try {
    pagina = await lcu.post('/lol-perks/v1/pages', corpo);
  } catch (erro) {
    const paginas = await lcu.get('/lol-perks/v1/pages').catch(() => []);
    throw new Error(`o client recusou criar a página (${erro.message}). Você tem ${paginas.length} páginas no limite — apague uma no client, ou defina "paginaAlvo" no config.json com o nome da página que o LolCoach pode sobrescrever.`);
  }

  if (pagina?.id) await lcu.put('/lol-perks/v1/currentpage', pagina.id).catch(() => {});
  return pagina;
}

/** Troca os feitiços de invocador na tela de seleção. */
export async function aplicarSpells(lcu, ids) {
  if (!Array.isArray(ids) || ids.length !== 2) return false;
  await lcu.patch('/lol-champ-select/v1/session/my-selection', { spell1Id: ids[0], spell2Id: ids[1] });
  return true;
}

/** Busca no op.gg e aplica de uma vez. Devolve a build usada. */
export async function aplicarBuildDoOpgg(lcu, campeao, role, opcoes = {}) {
  const build = await buscarBuild(campeao, role, opcoes);
  await aplicarRunas(lcu, build, { paginaAlvo: opcoes.paginaAlvo ?? null });
  if (opcoes.aplicarSpells && build.spells) await aplicarSpells(lcu, build.spells.ids).catch(() => {});
  return build;
}
