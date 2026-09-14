/**
 * Onde cada inimigo foi visto por último — só pelo que é público.
 *
 * A API do jogo não dá posição, e ler a tela pra achar o jungler no minimapa é
 * exatamente o tipo de recurso que a Riot proibiu em app de terceiro em 2023
 * (Porofessor e Blitz tiveram que tirar). Então NADA aqui olha o mapa.
 *
 * O que dá pra saber sem trapacear é o que já apareceu no feed de kills de
 * todo mundo: quem matou quem (e quem ajudou), quem pegou dragão/arauto/barão,
 * quem derrubou torre. Cada um desses eventos coloca alguém num lugar num
 * instante. Daí sai "Warwick: matou a Jinx no bot há 0:45" — que é o que você
 * olharia no placar de kills, só que sem tirar o olho da sua lane.
 *
 * O resto do rastreio é igualmente público (está na aba Tab): nível, itens e
 * tempo de renascimento de cada inimigo.
 */

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Onde a vítima estava, pela role dela. Aproximação honesta: quem morre no
// mid geralmente morreu no mid. Quando não dá pra saber, não inventa.
const LANE_DA_ROLE = { top: 'top', jungle: null, mid: 'mid', adc: 'bot', sup: 'bot' };

/** Ordem de spikes que mudam a troca. Vale avisar quando um inimigo fecha. */
const ITENS_QUE_MUDAM = new Map([
  // mítico/legendário caro = poder de fato
  [3153, 'Lâmina do Rei Destruído'], [3031, 'Gume do Infinito'], [6672, 'Kraken'],
  [3157, 'Ampulheta de Zhonya'], [3140, 'Quicksilver'], [3139, 'Cimitarra Mercurial'],
  [3026, 'Anjo Guardião'], [6653, "Tormento de Liandry"], [3089, 'Chapéu de Rabadon'],
  [6692, 'Eclipse'], [3142, 'Lembrete Youmuu'], [6695, 'Ceifador Serpentino'],
  [3074, 'Hidra Voraz'], [6631, 'Vale do Rei'], [3078, 'Trindade'],
  [3071, 'Cutelo Negro'], [3065, 'Véu da Banshee'], [3143, 'Coração de Gelo'],
  [3110, 'Coração Congelado'], [3075, 'Espinhos'], [3742, 'Placa do Homem Morto'],
  [3068, 'Égide Solar'], [3084, 'Coração de Aço'], [2065, 'Lua Crescente'],
  [3011, 'Cetro Químico'], [3124, 'Lâmina da Fúria'], [3036, 'Lembrete Mortal'],
  [3033, 'Lembrete Mortal'], [3135, 'Cajado do Vazio'], [3102, "Véu da Banshee"],
]);

/** Estado zerado de uma partida. */
export function novaMemoria() {
  return {
    processados: new Set(),   // ids de evento já lidos
    vistos: new Map(),        // nome -> { t, onde, como }
    itens: new Map(),         // nome -> Set(itemId) na última leitura
    niveis: new Map(),        // nome -> nível na última leitura
    avisos: [],               // { t, chave, urgencia, titulo, acao } gerados por deltas
    ultimoTempo: 0,
  };
}

function laneDe(jogador) {
  return jogador ? LANE_DA_ROLE[jogador.role] ?? null : null;
}

/**
 * Atualiza a memória com o estado atual e devolve o que há de novo.
 * Chamado a cada leitura (2s). Só olha eventos e deltas; nunca posição.
 */
export function rastrear(estado, mem) {
  const { tempo, eu, jogadores, eventos } = estado;
  const porNome = new Map(jogadores.map((j) => [j.nome, j]));
  const inimigos = jogadores.filter((j) => j.time !== eu.time);
  const novos = [];

  const marcar = (nome, t, onde, como) => {
    const j = porNome.get(nome);
    if (!j || j.time === eu.time) return;              // só rastreamos o outro lado
    const antes = mem.vistos.get(nome);
    if (antes && antes.t > t) return;                  // evento mais velho que o registro
    mem.vistos.set(nome, { t, onde, como });
  };

  /* ---- 1. eventos públicos → última posição conhecida ---- */
  for (const e of eventos) {
    if (mem.processados.has(e.id)) continue;
    mem.processados.add(e.id);

    if (e.tipo === 'ChampionKill') {
      const vitima = porNome.get(e.vitima);
      const onde = laneDe(vitima);
      const quem = [e.autor, ...e.assistentes].filter(Boolean);
      for (const nome of quem) {
        marcar(nome, e.t, onde, `matou ${vitima?.campeao ?? e.vitima}${onde ? ` no ${onde}` : ''}`);
      }
      // Morreu = está na base por um tempo. É posição certa, não estimada.
      if (vitima && vitima.time !== eu.time) marcar(e.vitima, e.t, 'base', 'morreu');
    } else if (e.tipo === 'DragonKill' || e.tipo === 'HeraldKill' || e.tipo === 'BaronKill' || e.tipo === 'AtakhanKill') {
      const objetivo = e.tipo === 'DragonKill' ? 'dragão' : e.tipo === 'HeraldKill' ? 'arauto'
        : e.tipo === 'BaronKill' ? 'barão' : 'atakhan';
      const onde = objetivo === 'dragão' ? 'pit do dragão' : 'pit do barão';
      for (const nome of [e.autor, ...e.assistentes].filter(Boolean)) {
        marcar(nome, e.t, onde, `pegou ${objetivo}`);
      }
    } else if (e.tipo === 'TurretKilled' && e.autor) {
      // O nome da torre diz a lane: Turret_T1_C_05_A → C = mid; L/R são as
      // laterais e variam de lado, então só o mid é afirmado com certeza.
      const lane = /_C_/.test(e.torre ?? '') ? 'mid' : null;
      marcar(e.autor, e.t, lane, `derrubou torre${lane ? ` no ${lane}` : ''}`);
    }
  }

  /* ---- 2. deltas de item, nível e morte ---- */
  for (const j of inimigos) {
    const agora = new Set(j.itens.map((i) => i.id));
    const antes = mem.itens.get(j.nome);
    if (antes) {
      for (const id of agora) {
        if (antes.has(id) || !ITENS_QUE_MUDAM.has(id)) continue;
        const nomeItem = j.itens.find((i) => i.id === id)?.nome ?? ITENS_QUE_MUDAM.get(id);
        novos.push({
          t: tempo, chave: `item-${j.nome}-${id}`, urgencia: j.role === eu.role || j.role === 'jungle' ? 2 : 1,
          titulo: `${j.campeao} fechou ${nomeItem}`,
          acao: j.role === eu.role
            ? 'Ele acabou de ficar mais forte que há um minuto. Não aceite a mesma troca que aceitava antes.'
            : 'Vale saber antes da próxima briga de time.',
        });
      }
    }
    mem.itens.set(j.nome, agora);

    const nivelAntes = mem.niveis.get(j.nome) ?? 0;
    if (nivelAntes && j.nivel > nivelAntes) {
      if ([6, 11, 16].includes(j.nivel) && (j.role === eu.role || j.role === 'jungle')) {
        novos.push({
          t: tempo, chave: `nv-${j.nome}-${j.nivel}`, urgencia: j.nivel === 6 ? 3 : 2,
          titulo: `${j.campeao} chegou no nível ${j.nivel}`,
          acao: j.nivel === 6
            ? 'Ult liberada. Os próximos 60 segundos são a janela de gank ou all-in dele.'
            : 'Ult mais forte. O que era troca segura antes deixou de ser.',
        });
      }
    }
    mem.niveis.set(j.nome, j.nivel);

    // Morto agora: a "última posição" é a base, com hora exata de volta.
    if (j.morto) marcar(j.nome, tempo, 'base', `morto, volta em ${Math.round(j.renasceEm)}s`);
  }

  /* ---- 3. vantagem de nível de quem divide a lane com você ---- */
  const laner = inimigos.find((j) => j.role && j.role === eu.role);
  if (laner && laner.nivel - eu.nivel >= 2) {
    const chave = `lvl-${laner.nome}-${laner.nivel - eu.nivel}`;
    if (!mem.avisos.some((a) => a.chave === chave)) {
      novos.push({
        t: tempo, chave, urgencia: 2,
        titulo: `${laner.campeao} está ${laner.nivel - eu.nivel} níveis na frente`,
        acao: 'Não é hora de trocar. Farme de longe e espere gank ou o nível igualar.',
      });
    }
  }

  /* ---- 4. janela do primeiro gank: o jungler deles termina o clear ~3:15 ---- */
  // Sem posição não dá pra dizer ONDE ele vai, mas dá pra dizer QUANDO: todo
  // jungler termina a primeira volta entre 3:00 e 3:45, e o primeiro gank vem
  // logo em seguida. Se ele ainda não apareceu em nada público, é agora.
  const jungler = inimigos.find((j) => j.role === 'jungle');
  if (jungler && tempo >= 180 && tempo <= 270 && !mem.vistos.has(jungler.nome)) {
    const chave = 'primeiro-clear';
    if (!mem.avisos.some((a) => a.chave === chave)) {
      novos.push({
        t: tempo, chave, urgencia: 2,
        titulo: `${jungler.campeao} deve estar terminando o primeiro clear`,
        acao: 'Primeiro gank chega entre agora e 4:00. Se sua wave está empurrada pra frente, recua até ele aparecer em algum lugar.',
      });
    }
  }

  mem.avisos.push(...novos);
  mem.ultimoTempo = tempo;

  /* ---- 4. a lista de "visto por último", pra tela ---- */
  const vistos = inimigos.map((j) => {
    const v = mem.vistos.get(j.nome);
    const ha = v ? tempo - v.t : null;
    return {
      nome: j.nome, campeao: j.campeao, role: j.role, nivel: j.nivel,
      morto: j.morto, renasceEm: j.renasceEm,
      onde: v?.onde ?? null, como: v?.como ?? null,
      ha, haTexto: ha == null ? 'sem sinal' : `há ${mmss(ha)}`,
      // O jungler manda no rastreio: é ele que aparece onde você não espera.
      prioridade: j.role === 'jungle' ? 0 : j.role === eu.role ? 1 : 2,
    };
  }).sort((a, b) => a.prioridade - b.prioridade);

  // Avisos recentes (últimos 45s) — o resto já passou.
  const recentes = mem.avisos.filter((a) => tempo - a.t <= 45);

  return { vistos, avisos: recentes };
}
