import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pastaBase } from '../caminhos.js';
import { slugDoCampeao, ROLE_OPGG } from './opgg.js';
import { tabelaDeItens, tabelaDeRunas, tabelaDeFeiticos } from './ddragon.js';

/**
 * As builds de um campeão, do op.gg, já com nome e ícone de tudo.
 *
 * O op.gg devolve listas separadas — páginas de runa, combinações de itens
 * principais, botas, itens finais, ordens de habilidade, feitiços — cada uma
 * com quantas partidas e quantas vitórias. Aqui viram os **3 melhores de cada**,
 * ordenados por quantidade de jogos (o que mais gente joga), com a taxa de
 * vitória do lado pra você decidir.
 *
 * Buscar os 173 campeões de uma vez seriam ~500 chamadas ao op.gg — é abuso e
 * termina em bloqueio. Então é por demanda, com cache em disco de 12h por
 * campeão/role. A primeira abertura de cada campeão custa uma chamada; as
 * seguintes, zero.
 */

const BASE = 'https://lol-api-champion.op.gg/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const VALIDADE = 12 * 60 * 60 * 1000;
const pasta = () => resolve(pastaBase(), 'dados', 'builds');

const ROLES_PT = { top: 'top', jungle: 'jungle', mid: 'mid', adc: 'adc', support: 'sup' };

async function lerCache(arquivo) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch { return null; }
}
async function gravarCache(arquivo, dados) {
  try { await mkdir(dirname(arquivo), { recursive: true }); await writeFile(arquivo, JSON.stringify(dados), 'utf8'); }
  catch { /* segue só com memória */ }
}

const taxa = (b) => (b?.play ? b.win / b.play : 0);
const pct = (x) => Math.round(x * 100);

/** Os N mais jogados, com o resumo numérico de cada. */
const top = (lista, n = 3) => [...(lista ?? [])]
  .filter((b) => b.play > 0)
  .sort((a, b) => b.play - a.play)
  .slice(0, n)
  .map((b) => ({ ...b, taxa: pct(taxa(b)), jogos: b.play, escolha: pct(b.pick_rate ?? 0) }));

async function baixar(slug, pos, regiao) {
  const r = await fetch(`${BASE}/${regiao}/champions/ranked/${slug}/${pos}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`op.gg respondeu HTTP ${r.status}`);
  const j = await r.json();
  return j.data ?? j;
}

/**
 * Em que roles o campeão é jogado, com quantos jogos e taxa em cada.
 * Vem no `summary.positions` de qualquer role — então basta uma chamada.
 */
export async function rolesDoCampeao(nome, { regiao = 'br' } = {}) {
  const b = await buildsDoCampeao(nome, null, { regiao });
  return b.roles;
}

/**
 * Builds de um campeão numa role. `role` null = a role principal dele.
 */
export async function buildsDoCampeao(nome, role, { regiao = 'br' } = {}) {
  const slug = slugDoCampeao(nome);

  // Sem role: descobre a principal com uma chamada em qualquer posição, que
  // devolve o summary com todas. Jungle é um chute inicial tão bom quanto outro.
  let pos = role ? (ROLE_OPGG[role] ?? String(role).toLowerCase()) : null;

  const arquivo = (p) => resolve(pasta(), regiao, `${slug}-${p}.json`);

  if (!pos) {
    // Procura qualquer cache do campeão pra achar a role principal sem rede.
    for (const p of ['jungle', 'mid', 'top', 'adc', 'support']) {
      const c = await lerCache(arquivo(p));
      if (c?.roles?.length) { pos = c.roles[0].chave; break; }
    }
    if (!pos) {
      const d = await baixar(slug, 'jungle', regiao);
      const rs = (d.summary?.positions ?? []).sort((a, b) => b.stats.play - a.stats.play);
      pos = rs.length ? ROLE_OPGG[rs[0].name] ?? rs[0].name.toLowerCase() : 'jungle';
    }
  }

  const cache = await lerCache(arquivo(pos));
  if (cache && Date.now() - cache.em < VALIDADE) return cache;

  let d;
  try { d = await baixar(slug, pos, regiao); }
  catch (erro) { if (cache) return cache; throw erro; }

  const [itens, runas, feiticos] = await Promise.all([tabelaDeItens(), tabelaDeRunas(), tabelaDeFeiticos()]);

  const item = (id) => ({ id, ...(itens.get(id) ?? { nome: `item ${id}`, preco: 0 }) });
  const runa = (id) => ({ id, ...(runas.get(id) ?? { nome: `runa ${id}` }) });
  const feitico = (id) => ({ id, ...(feiticos.get(id) ?? { nome: `feitiço ${id}` }) });

  const s = d.summary ?? {};
  const roles = (s.positions ?? [])
    .map((p) => ({
      chave: ROLE_OPGG[p.name] ?? p.name.toLowerCase(),
      nome: ROLES_PT[ROLE_OPGG[p.name] ?? p.name.toLowerCase()] ?? p.name.toLowerCase(),
      jogos: p.stats?.play ?? 0,
      taxa: pct(p.stats?.win_rate ?? 0),
      fatia: pct(p.stats?.role_rate ?? 0),
    }))
    .sort((a, b) => b.jogos - a.jogos);

  const dados = {
    em: Date.now(),
    campeao: nome,
    slug,
    role: pos,
    roleNome: ROLES_PT[pos] ?? pos,
    fonte: `op.gg/${regiao}`,
    resumo: {
      tier: s.average_stats?.tier ?? null,
      posicao: s.average_stats?.rank ?? null,
      taxa: pct(s.average_stats?.win_rate ?? 0),
      escolha: Math.round((s.average_stats?.pick_rate ?? 0) * 1000) / 10,
      banimento: Math.round((s.average_stats?.ban_rate ?? 0) * 1000) / 10,
      jogos: s.average_stats?.play ?? 0,
    },
    roles,

    // Os 3 mais jogados de cada coisa, sempre com taxa e amostra.
    runas: top(d.runes).map((r) => ({
      jogos: r.jogos, taxa: r.taxa, escolha: r.escolha,
      primaria: runa(r.primary_page_id),
      secundaria: runa(r.secondary_page_id),
      principais: (r.primary_rune_ids ?? []).map(runa),
      secundarias: (r.secondary_rune_ids ?? []).map(runa),
      fragmentos: (r.stat_mod_ids ?? []).map(runa),
      // O que a LCU precisa pra aplicar, já no formato certo.
      lcu: {
        primaryStyleId: r.primary_page_id,
        subStyleId: r.secondary_page_id,
        selectedPerkIds: [...(r.primary_rune_ids ?? []), ...(r.secondary_rune_ids ?? []), ...(r.stat_mod_ids ?? [])],
      },
    })),
    itens: {
      iniciais: top(d.starter_items).map((b) => ({ jogos: b.jogos, taxa: b.taxa, itens: b.ids.map(item) })),
      principais: top(d.core_items).map((b) => ({ jogos: b.jogos, taxa: b.taxa, itens: b.ids.map(item) })),
      botas: top(d.boots).map((b) => ({ jogos: b.jogos, taxa: b.taxa, item: item(b.ids[0]) })),
      // Os finais vêm um por linha; os 6 mais jogados dão as opções de 4º/5º/6º.
      finais: top(d.last_items, 6).map((b) => ({ jogos: b.jogos, taxa: b.taxa, item: item(b.ids[0]) })),
    },
    feiticos: top(d.summoner_spells).map((b) => ({ jogos: b.jogos, taxa: b.taxa, feiticos: b.ids.map(feitico) })),
    habilidades: {
      prioridade: top(d.skill_masteries).map((b) => ({ jogos: b.jogos, taxa: b.taxa, ordem: b.ids })),
      ordem: top(d.skills).map((b) => ({ jogos: b.jogos, taxa: b.taxa, ordem: b.order })),
    },
  };

  await gravarCache(arquivo(pos), dados);
  return dados;
}
