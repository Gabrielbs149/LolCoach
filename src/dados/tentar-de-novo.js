/**
 * Quando tentar de novo, depois de uma falha que se repete.
 *
 * Isto existe por causa de um estrago medido no registro dele. A release v2.28.219, de
 * 15/10, subiu sem o `latest.yml`. O tratador de erro da atualização agendava uma nova
 * tentativa a cada falha — e o agendamento ANTERIOR continuava de pé, enquanto a busca de
 * 5 em 5 minutos seguia criando correntes novas. As correntes se acumulavam, cada uma se
 * renovando sozinha pra sempre. Resultado: 36 pedidos por minuto ao GitHub, de 2 em 2
 * minutos, por 43 HORAS — 8.957 linhas de uma falha só, 43% do registro inteiro.
 *
 * Três regras, e as três importam:
 *   1. UMA corrente. Quem agenda cancela o agendamento anterior.
 *   2. A espera DOBRA a cada falha, até um teto. Falha que não passa não merece a mesma
 *      insistência da primeira.
 *   3. Deu certo uma vez, zera. Rede que volta não paga pela rede que caiu.
 *
 * E a mesma falha repetida não vira linha nova no registro: vira contagem. Registro que
 * ninguém consegue ler é registro que não serve pra nada.
 */

export const ESPERA_MIN = 2 * 60 * 1000;
export const ESPERA_MAX = 30 * 60 * 1000;

/**
 * @param {object} opcoes
 * @param {number} [opcoes.minimo]  primeira espera, em ms
 * @param {number} [opcoes.maximo]  teto da espera, em ms
 * @param {number} [opcoes.avisarACada]  de quantas em quantas repetições vale avisar
 */
export function quandoTentarDeNovo({ minimo = ESPERA_MIN, maximo = ESPERA_MAX, avisarACada = 10 } = {}) {
  let espera = minimo, ultima = null, repetidas = 0;

  return {
    /** Deu certo: a próxima falha volta a esperar pouco. */
    deuCerto() { espera = minimo; ultima = null; repetidas = 0; },

    /**
     * Falhou. Devolve quanto esperar e se vale escrever no registro.
     * @param {string} falha  a mensagem, usada só pra saber se é a MESMA de antes
     */
    falhou(falha) {
      const mesma = falha === ultima;
      repetidas = mesma ? repetidas + 1 : 1;
      ultima = falha;
      const esperaAgora = espera;
      espera = Math.min(espera * 2, maximo);
      return {
        espera: esperaAgora,
        repetidas,
        // a primeira sempre aparece; as repetidas, de tantas em tantas
        avisar: !mesma || repetidas % avisarACada === 0,
        mesma,
      };
    },

    /** só pra quem quiser olhar de fora (testes, telas) */
    agora() { return { espera, repetidas, ultima }; },
  };
}
