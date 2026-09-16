/**
 * A voz lê nome gringo como português: "Jinx" vira "jincs" só se a gente
 * escrever assim. Antes de falar, troca cada nome/gíria pela grafia de como
 * o pessoal fala no BR. Só o áudio muda; na tela fica o nome certo.
 * `config.voz.pronuncia` ({ palavra: 'como falar' }) entra por cima.
 */
const CAMPEOES = {
  'Aatrox': 'Átrocs', 'Ahri': 'Ári', 'Akshan': 'Ákshan', 'Annie': 'Âni', 'Aphelios': 'Afélios',
  'Ashe': 'Éshi', 'Aurelion Sol': 'Aurélion Sol', 'Bard': 'Bárd', "Bel'Veth": 'Bélvéf',
  'Blitzcrank': 'Blitzcrânk', 'Brand': 'Brênd', 'Braum': 'Bráum', 'Briar': 'Bráiar',
  'Caitlyn': 'Kêitlin', 'Camille': 'Camíl', 'Cassiopeia': 'Cassiopéia', "Cho'Gath": 'Chogáf',
  'Corki': 'Córki', 'Darius': 'Dárius', 'Dr. Mundo': 'Doutor Mundo', 'Draven': 'Drêiven',
  'Ekko': 'Éco', 'Elise': 'Elíze', 'Evelynn': 'Évelin', 'Ezreal': 'Ézreal', 'Fiddlesticks': 'Fídolstics',
  'Fiora': 'Fiôra', 'Fizz': 'Fiz', 'Galio': 'Gálio', 'Gangplank': 'Guêngplânk', 'Garen': 'Gáren',
  'Gragas': 'Grágas', 'Graves': 'Grêivs', 'Gwen': 'Guén', 'Hecarim': 'Récarim',
  'Heimerdinger': 'Râimerdinguer', 'Hwei': 'Ruêi', 'Illaoi': 'Ilaói', 'Irelia': 'Irélia',
  'Ivern': 'Áivern', 'Janna': 'Jâna', 'Jarvan IV': 'Jarvan quarto', 'Jax': 'Jács', 'Jayce': 'Jêice',
  'Jhin': 'Jin', 'Jinx': 'Jíncs', "K'Sante": 'Cassânte', "Kai'Sa": 'Cáissa', 'Karthus': 'Cártus',
  'Kayle': 'Kêil', 'Kayn': 'Kêin', 'Kennen': 'Kênen', "Kha'Zix": 'Cazícs', 'Kindred': 'Kíndred',
  'Kled': 'Cléd', "Kog'Maw": 'Cógmó', 'LeBlanc': 'Leblân', 'Lee Sin': 'Li Sin', 'Lucian': 'Lúcian',
  'Lux': 'Lucs', 'Malphite': 'Malfáit', 'Malzahar': 'Malzarár', 'Maokai': 'Maokái',
  'Master Yi': 'Master Í', 'Miss Fortune': 'Miss Fórtune', 'Mordekaiser': 'Mordekáiser',
  'Naafiri': 'Nafíri', 'Nasus': 'Nássus', 'Nautilus': 'Náutilus', 'Neeko': 'Níco', 'Nidalee': 'Nidalí',
  'Nilah': 'Níla', 'Nocturne': 'Nóctarn', 'Nunu & Willump': 'Nunu', 'Nunu e Willump': 'Nunu', 'Ornn': 'Órn',
  'Pantheon': 'Pânteon', 'Poppy': 'Pópi', 'Pyke': 'Páik', 'Qiyana': 'Kiâna', 'Quinn': 'Kuín',
  'Rammus': 'Râmus', "Rek'Sai": 'Recsái', 'Rell': 'Rél', 'Renata Glasc': 'Renata Glásc',
  'Renekton': 'Renécton', 'Rumble': 'Râmbol', 'Ryze': 'Ráiz', 'Seraphine': 'Serafine', 'Sett': 'Sét',
  'Shaco': 'Xáco', 'Shen': 'Xén', 'Shyvana': 'Xivâna', 'Singed': 'Sínged', 'Sion': 'Sáion',
  'Sivir': 'Sivír', 'Smolder': 'Smôlder', 'Swain': 'Suêin', 'Sylas': 'Sáilas', 'Tahm Kench': 'Tam Kench',
  'Taliyah': 'Talía', 'Talon': 'Tálon', 'Teemo': 'Tímo', 'Thresh': 'Trésh', 'Trundle': 'Trândol',
  'Tryndamere': 'Trindamir', 'Twisted Fate': 'Tuísted Fêit', 'Twitch': 'Tuítch', 'Udyr': 'Iúdir',
  'Urgot': 'Úrgot', 'Vayne': 'Vêin', 'Veigar': 'Vêigar', "Vel'Koz": 'Vélcoz', 'Vex': 'Vécs',
  'Volibear': 'Vólibér', 'Warwick': 'Uóruik', 'Wukong': 'Uucong', 'Xayah': 'Záia', 'Xerath': 'Zéraf',
  'Xin Zhao': 'Xin Jáo', 'Yorick': 'Iórik', 'Yuumi': 'Iúmi', 'Zac': 'Zác', 'Ziggs': 'Zígs', 'Zoe': 'Zôi',
  'Alistar': 'Alistár', 'Ambessa': 'Ambéssa', 'Gnar': 'Nár', 'Lillia': 'Lília', 'Milio': 'Mílio', 'Rakan': 'Racân',
  'Rengar': 'Rêngar', 'Riven': 'Ríven', 'Sejuani': 'Sejuâni', 'Senna': 'Sêna', 'Skarner': 'Scárner', 'Varus': 'Várus',
  'Viego': 'Viêgo', 'Viktor': 'Víctor', 'Vladimir': 'Vladimír', 'Yasuo': 'Iássuo', 'Yone': 'Iône',
  'Yunara': 'Iunára', 'Zeri': 'Zéri', 'Mel': 'Mél', 'Kalista': 'Calísta', 'Lissandra': 'Lissândra', 'Olaf': 'Ólaf',
};
const GIRIAS = {
  'jungler': 'jângler', 'jungle': 'jângol', 'gank': 'guênk', 'ganks': 'guênks', 'gankar': 'guenkár',
  'wave': 'uêive', 'waves': 'uêives', 'flash': 'flésh', 'farm': 'fárm', 'farmar': 'farmár', 'farma': 'fárma',
  'farmou': 'farmôu', 'ward': 'uórd', 'wards': 'uórds', 'smite': 'smáite', 'roam': 'rôum', 'spike': 'spáik',
  'buff': 'báf', 'buffs': 'báfs', 'top': 'tóp', 'bot': 'bót', 'adc': 'adecê', 'kill': 'kil', 'kills': 'kils',
  'CC': 'cecê', 'AP': 'apê', 'AD': 'adê', 'PDL': 'pê dê éle', 'KDA': 'cá dê á', 'cs': 'cê ésse',
  'ace': 'êice', 'multikill': 'multikil', 'trade': 'trêid', 'tradar': 'treidár', 'poke': 'pôuk',
  'engage': 'enguêidj', 'all-in': 'ól in', 'all in': 'ól in', 'push': 'púsh', 'freeze': 'fríz', 'reset': 'risét',
  'gold': 'gôld', 'tilt': 'tílt', 'tiltado': 'tiltádo', 'carry': 'kéri', 'carregar': 'carregar', 'main': 'mêin',
  'first blood': 'fêrst blâd', 'pick': 'pík', 'ban': 'bân', 'support': 'sapórt', 'sup': 'sup', 'mid': 'míd',
  'ult': 'ult', 'stun': 'stân', 'slow': 'slôu', 'dash': 'désh', 'hook': 'rúk', 'tank': 'tânk', 'tanque': 'tanque',
  'off': 'óf', 'dive': 'dáiv', 'dar dive': 'dar dáiv', 'backdoor': 'bécdor', 'splitpush': 'split púsh', 'split': 'split',
  'lane': 'lêin', 'lanes': 'lêins', 'TP': 'tê pê', 'recall': 'ricól', 'leash': 'líxe', 'invade': 'invêid', 'bush': 'búxe',
  'cheese': 'chíz', 'swap': 'suóp', 'pit': 'pít', 'nexus': 'nécsus', 'krugs': 'crâgs', 'raptors': 'ráptors', 'gromp': 'grômp',
  'cooldown': 'cúldaun', 'kite': 'cáit', 'kitar': 'caitár', 'burst': 'bârst', 'call': 'cól', 'cleanse': 'clêns', 'ignite': 'ignáit',
  'exhaust': 'ecsáust', 'heal': 'ríl', 'ghost': 'gôust', 'barrier': 'bérier', 'red': 'réd', 'reds': 'réds', 'scuttle': 'scâtol',
  'drake': 'drêik', 'baron': 'bâron', 'nash': 'néxi', 'proc': 'próc', 'stack': 'stéc', 'stacks': 'stécs', 'clear': 'clír', 'cs': 'cê ésse',
};

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let compilado = null, compiladoDe = '';

function compilar(extra) {
  const todos = { ...CAMPEOES, ...GIRIAS, ...(extra ?? {}) };
  // Os mais longos primeiro: "Twisted Fate" antes de "Fate", "Lee Sin" antes de "Sin".
  const chaves = Object.keys(todos).filter((k) => k.trim() && todos[k]).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${chaves.map(escapar).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const mapa = new Map(chaves.map((k) => [k.toLowerCase(), todos[k]]));
  return { re, mapa };
}

/** "3:51" lido pela voz vira "3 horas e 51". Aqui vira "3 minutos e 51 segundos". */
export function tempoPorExtenso(texto) {
  return String(texto ?? '').replace(/(\d{1,2}):(\d{2})/g, (m, mi, se) => {
    const min = Number(mi), seg = Number(se);
    const pm = min === 1 ? '1 minuto' : `${min} minutos`;
    const ps = seg === 1 ? '1 segundo' : `${seg} segundos`;
    if (min === 0) return ps;
    if (seg === 0) return pm;
    return seg === 1 ? `${pm} e 1 segundo` : `${pm} e ${seg}`;
  });
}

/** Texto pronto pra voz. `extra` = correções do config, por cima das nossas. */
export function pronunciar(texto, extra = null) {
  const marca = JSON.stringify(extra ?? {});
  if (!compilado || compiladoDe !== marca) { compilado = compilar(extra); compiladoDe = marca; }
  return tempoPorExtenso(String(texto ?? '')).replace(compilado.re, (m) => {
    const troca = compilado.mapa.get(m.toLowerCase());
    if (troca == null) return m;
    // Mantém a inicial maiúscula se estava assim (começo de frase).
    return m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? troca[0].toUpperCase() + troca.slice(1) : troca;
  });
}
