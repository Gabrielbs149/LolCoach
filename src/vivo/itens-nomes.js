/**
 * Como o pessoal do BR chama os itens na call: "BORK", "Gume", "Kraken",
 * "Zhonya", "Rabadon"… — não a tradução da Riot nem o nome inglês inteiro.
 * O que não está aqui usa o nome que vier (ddragon ou a API do jogo).
 */
const APELIDOS = new Map([
  [3153, 'BORK'], [3031, 'Gume'], [6672, 'Kraken'], [3157, 'Zhonya'], [3140, 'QSS'], [3139, 'Mercurial'],
  [3026, 'GA'], [6653, 'Liandry'], [3089, 'Rabadon'], [6692, 'Eclipse'], [3142, 'Youmuu'], [6695, 'Serpente'],
  [3074, 'Hidra'], [6631, 'Sundered Sky'], [3078, 'Trindade'], [3071, 'Cleaver'], [3065, 'Espírito'],
  [3143, 'Randuin'], [3110, 'Frozen'], [3075, 'Thornmail'], [3742, 'Dead Man'], [3068, 'Sunfire'], [3084, 'Heartsteel'],
  [2065, 'Shurelya'], [3011, 'Putrifier'], [3124, 'Guinsoo'], [3036, 'LDR'], [3033, 'Mortal'], [3135, 'Void Staff'],
  [3102, 'Banshee'], [3072, 'Sede de Sangue'], [3508, 'Colhedor'], [6675, 'Navori'], [3085, 'Furacão'], [3094, 'Rapid Fire'],
  [3046, 'Fantasma'], [3087, 'Statikk'], [3814, 'Edge of Night'], [6676, 'Coletor'], [6694, 'Serylda'], [6698, 'Profane'],
  [6699, 'Voltaic'], [3004, 'Muramana'], [3042, 'Muramana'], [3003, 'Serafina'], [3040, 'Serafina'], [3100, 'Lich Bane'],
  [3115, 'Nashor'], [4645, 'Shadowflame'], [4628, 'Horizon'], [4633, 'Riftmaker'], [3116, 'Rylai'], [3165, 'Morello'],
  [4646, 'Stormsurge'], [3152, 'Hextech'], [6655, 'Luden'], [3118, 'Malignance'], [3137, 'Cryptbloom'], [3053, 'Sterak'],
  [3161, 'Spear of Shojin'], [3181, 'Hullbreaker'], [6333, 'Death Dance'], [6609, 'Chempunk'], [3748, 'Titanic'],
  [6610, 'Sundered Sky'], [3302, 'Terminus'], [3172, 'Zephyr'], [3091, 'Wit'], [6664, 'Hollow Radiance'], [6665, 'Jak Sho'],
  [6667, 'Radiant Virtue'], [3190, 'Locket'], [3107, 'Redenção'], [3222, 'Mikael'], [3504, 'Ardent'], [6616, 'Staff of Flowing'],
  [3050, 'Zeke'], [3109, 'Knight Vow'], [4005, 'Imperial'], [6617, 'Moonstone'], [2504, 'Kaenic'], [2502, 'Unending Despair'],
  [2503, 'Blackfire'], [3119, 'Warmog'], [3083, 'Warmog'], [3111, 'Mercúrio'], [3047, 'Placa'], [3006, 'Berserker'],
  [3009, 'Bota de Velocidade'], [3020, 'Feiticeiro'], [3158, 'Lucidez'], [3010, 'Bota Simbiótica'],
]);

/** Nome falado do item: apelido do BR se tiver, senão o que veio. */
export const nomeItem = (id, nome) => APELIDOS.get(Number(id)) ?? nome;
