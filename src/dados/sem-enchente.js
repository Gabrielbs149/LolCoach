/**
 * O guarda contra enchente no registro.
 *
 * MEDIDO no registro dele: de 21.066 linhas, 18.009 — 85% — eram DUAS mensagens se
 * alternando por causa de uma release quebrada: "procurando atualização…" 9.027 vezes e
 * a falha do `latest.yml` 8.982. O registro gira com 2 MB, então o que sobrou dessa
 * enchente empurrou pra fora semanas de histórico de verdade: justamente o que serve pra
 * entender o que aconteceu numa partida de ontem.
 *
 * Juntar linha repetida SEGUIDA não resolveria nada aqui, e isso importa: as duas se
 * ALTERNAVAM (procura, falha, procura, falha). O que resolve é limitar por MENSAGEM:
 * a mesma frase só entra algumas vezes dentro de uma janela de tempo; passando disso,
 * vira contagem, e quando a janela fecha sai uma linha dizendo quantas foram seguradas.
 *
 * Isto NÃO apaga informação: a primeira sempre entra, e o total sempre aparece. Só para
 * de repetir a mesma coisa mil vezes.
 */

export const LIMITE = 5;
export const JANELA = 10 * 60 * 1000;

export function guardaDeEnchente({ limite = LIMITE, janela = JANELA } = {}) {
  const vistos = new Map();   // texto -> { n, desde, segurou }

  return {
    /**
     * Esta linha deve ir pro registro?
     * @returns {{escrever: boolean, aviso: string|null}} `aviso` é uma linha EXTRA pra
     *   escrever junto — ou dizendo que vai começar a segurar, ou fechando a conta.
     */
    deixar(texto, agora = Date.now()) {
      const v = vistos.get(texto);

      // primeira vez, ou a janela anterior já fechou
      if (!v || agora - v.desde >= janela) {
        const aviso = v && v.segurou ? `↑ "${curto(texto)}" repetiu mais ${v.segurou}× nos últimos ${Math.round((agora - v.desde) / 60000)} min` : null;
        vistos.set(texto, { n: 1, desde: agora, segurou: 0 });
        this.limpar(agora);
        return { escrever: true, aviso };
      }

      v.n++;
      if (v.n <= limite) return { escrever: true, aviso: null };

      v.segurou++;
      // avisa UMA vez que vai começar a segurar, pra ninguém achar que a linha sumiu
      if (v.segurou === 1) {
        return { escrever: false, aviso: `↑ esta linha está se repetindo muito — vou segurar as próximas por ${Math.round(janela / 60000)} min` };
      }
      return { escrever: false, aviso: null };
    },

    /** joga fora o que já saiu da janela, pra memória não crescer sem fim */
    limpar(agora = Date.now()) {
      if (vistos.size < 200) return;
      for (const [t, v] of vistos) if (agora - v.desde >= janela) vistos.delete(t);
    },

    quantos: () => vistos.size,
  };
}

const curto = (t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
