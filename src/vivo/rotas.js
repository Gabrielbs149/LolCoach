/**
 * As palavras de cada rota.
 *
 * O mesmo conselho não serve pra quem farma e pra quem não farma: "mantém o
 * farm" pra um suporte é conselho errado, e "pega a torre" pra um jungler
 * atrasado também. Aqui fica, por rota, o recurso que ela protege, o que vale
 * fazer com uma janela aberta, o que fazer quando está atrás e a partir de
 * quanto de gold parado vale a pena voltar pra base — um suporte volta com
 * muito menos que um adc.
 */
export const ROTA = {
  top: {
    recurso: 'farm',
    gastarEm: 1300,
    janela: 'Pega a torre do teu lado ou trava a wave pra descer junto — é a janela mais barata do jogo.',
    atrasado: 'Farm é o gold garantido. Pega as waves seguras antes de procurar briga.',
    semBriga: 'farma e espera o erro deles',
    baseAcao: 'Volta assim que a wave estiver empurrada. Item na mão ganha troca; gold no bolso não faz nada.',
  },
  jungle: {
    recurso: 'campo',
    gastarEm: 1100,
    janela: 'Toma o objetivo ou invade a jungle deles agora — é a janela mais barata do jogo.',
    atrasado: 'Farma o teu lado e o campo livre do lado deles. Campo que nasce e ninguém pega é gold que some.',
    semBriga: 'farma os campos e espera o erro deles',
    baseAcao: 'Volta no fim do clear. Item na mão ganha o próximo objetivo; gold no bolso não faz nada.',
  },
  mid: {
    recurso: 'farm',
    gastarEm: 1300,
    janela: 'Empurra a wave e desce pro objetivo agora — é a janela mais barata do jogo.',
    atrasado: 'Farm é o gold garantido. Pega as waves seguras antes de procurar briga.',
    semBriga: 'farma e espera o erro deles',
    baseAcao: 'Volta assim que a wave estiver empurrada. Item na mão ganha troca; gold no bolso não faz nada.',
  },
  adc: {
    recurso: 'farm',
    gastarEm: 1300,
    janela: 'Pega objetivo ou torre agora — é a janela mais barata do jogo.',
    atrasado: 'Farm é o gold garantido. Pega as waves seguras antes de procurar briga.',
    semBriga: 'farma e espera o erro deles',
    baseAcao: 'Volta assim que a wave estiver empurrada. Item na mão ganha troca; gold no bolso não faz nada.',
  },
  sup: {
    recurso: 'visão',
    gastarEm: 900,
    janela: 'Coloca visão no objetivo que vem e agrupa — é a janela mais barata do jogo.',
    atrasado: 'Sua conta é visão, não CS. Ward no objetivo que vem e só anda com o adc junto.',
    semBriga: 'protege o carry, mantém a visão e espera o erro deles',
    baseAcao: 'Volta cedo: ward e item de suporte na mão ganham a próxima briga; gold no bolso não faz nada.',
  },
};

/** As palavras da rota (mid como padrão quando a partida não informa a posição). */
export const daRota = (role) => ROTA[role] ?? ROTA.mid;
