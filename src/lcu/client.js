import https from 'node:https';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { descobrirCredenciais, esperarClient } from './lockfile.js';

// O client usa um certificado auto-assinado proprio da Riot. Como so falamos com
// 127.0.0.1, desligar a verificacao aqui e seguro e nao afeta o resto do app.
const agente = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export class LcuClient extends EventEmitter {
  #cred = null;
  #ws = null;
  #fechandoDeProposito = false;

  get credenciais() { return this.#cred; }
  get conectado() { return this.#ws?.readyState === WebSocket.OPEN; }

  #auth() {
    return 'Basic ' + Buffer.from(`riot:${this.#cred.senha}`).toString('base64');
  }

  /** Chamada REST crua no client. Devolve JSON, ou null quando a resposta e vazia. */
  request(metodo, caminho, corpo) {
    if (!this.#cred) throw new Error('cliente nao conectado');
    const payload = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));

    return new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1',
        port: this.#cred.porta,
        path: caminho,
        method: metodo,
        agent: agente,
        headers: {
          Authorization: this.#auth(),
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      }, (res) => {
        const pedacos = [];
        res.on('data', (d) => pedacos.push(d));
        res.on('end', () => {
          const texto = Buffer.concat(pedacos).toString('utf8');
          if (res.statusCode >= 400) {
            const erro = new Error(`${metodo} ${caminho} -> HTTP ${res.statusCode}: ${texto.slice(0, 300)}`);
            erro.status = res.statusCode;
            return reject(erro);
          }
          if (!texto) return resolve(null);
          try { resolve(JSON.parse(texto)); } catch { resolve(texto); }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  /**
   * Busca um asset binário do client (ícone de campeão, por exemplo).
   * O `request` normal tenta interpretar tudo como JSON e estragaria a imagem.
   */
  getBinario(caminho) {
    if (!this.#cred) throw new Error('cliente nao conectado');
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1', port: this.#cred.porta, path: caminho, method: 'GET',
        agent: agente, headers: { Authorization: this.#auth() },
      }, (res) => {
        const pedacos = [];
        res.on('data', (d) => pedacos.push(d));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`GET ${caminho} -> HTTP ${res.statusCode}`));
          resolve({ corpo: Buffer.concat(pedacos), tipo: res.headers['content-type'] ?? 'application/octet-stream' });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  get(caminho) { return this.request('GET', caminho); }
  post(caminho, corpo) { return this.request('POST', caminho, corpo); }
  put(caminho, corpo) { return this.request('PUT', caminho, corpo); }
  patch(caminho, corpo) { return this.request('PATCH', caminho, corpo); }
  delete(caminho) { return this.request('DELETE', caminho); }

  /**
   * Conecta e assina o WebSocket de eventos do client.
   * Emite 'evento' com { tipo, caminho, dados } para cada mudanca interna do client,
   * e 'conectado' / 'desconectado' na troca de estado.
   */
  /**
   * Com `esperar`, NUNCA rejeita: fica tentando até o client responder. A
   * versão anterior só reconectava depois de uma conexão que caiu — se a
   * primeira tentativa falhava (lockfile velho, client ainda subindo,
   * ECONNREFUSED), o app ficava a noite inteira "desconectado" com o League
   * aberto do lado, sem aceitar fila nem travar campeão.
   */
  async conectar({ esperar = true } = {}) {
    let avisou = false;
    for (;;) {
      try {
        return await this.#conectarUmaVez({ esperar });
      } catch (erro) {
        if (!esperar) throw erro;
        if (!avisou) { avisou = true; this.emit('falha', erro); }
        const espera = this.#esperaReconexao;
        this.#esperaReconexao = Math.min(espera * 1.5, 30_000);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }

  async #conectarUmaVez({ esperar }) {
    this.#fechandoDeProposito = false;
    this.#cred = esperar ? await esperarClient() : await descobrirCredenciais();

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${this.#cred.porta}/`, 'wamp', {
        agent: agente,
        headers: { Authorization: this.#auth() },
      });
      this.#ws = ws;
      let resolvida = false;

      ws.once('open', () => {
        // "5" = SUBSCRIBE no protocolo WAMP que o client usa.
        // OnJsonApiEvent assina TODAS as rotas de uma vez.
        ws.send(JSON.stringify([5, 'OnJsonApiEvent']));
        resolvida = true;
        this.emit('conectado', this.#cred);
        resolve();
      });

      // Um socket que falha emite 'error' E DEPOIS 'close'. Antes os dois
      // disparavam uma reconexão cada, e cada uma dessas falhava do mesmo jeito:
      // 1 vira 2, 2 vira 4, e em segundos havia 35 conexões abertas ao client
      // (foi exatamente o que apareceu no registro). Agora o 'error' só rejeita
      // a promessa; quem reconecta é sempre e apenas o 'close'.
      ws.on('error', (erro) => {
        if (resolvida) return;
        resolvida = true;
        // Solta o socket antes de rejeitar: o 'close' que vem logo atrás não
        // pode ser lido como "a conexão de agora caiu".
        if (this.#ws === ws) this.#ws = null;
        reject(erro);
      });

      ws.on('message', (bruto) => {
        let quadro;
        try { quadro = JSON.parse(bruto.toString()); } catch { return; }
        // Formato: [8, "OnJsonApiEvent", { eventType, uri, data }]
        if (!Array.isArray(quadro) || quadro[0] !== 8) return;
        const payload = quadro[2];
        this.emit('evento', { tipo: payload.eventType, caminho: payload.uri, dados: payload.data });
      });

      ws.on('close', () => {
        // Socket velho fechando depois que já trocamos de conexão não é motivo
        // pra reconectar — só o socket atual manda nisso.
        if (this.#ws !== ws) return;
        this.emit('desconectado');
        if (!resolvida) { resolvida = true; reject(new Error('conexão fechou antes de abrir')); return; }
        if (!this.#fechandoDeProposito) this.#reconectar();
      });
    });

    return this.#cred;
  }

  #esperaReconexao = 3000;
  #reconectando = false;

  async #reconectar() {
    if (this.#reconectando) return;   // uma reconexão de cada vez, sempre
    this.#reconectando = true;
    this.#cred = null;
    this.#ws = null;
    try {
      await this.conectar({ esperar: true });
      this.#esperaReconexao = 3000;
      this.#reconectando = false;
    } catch {
      // Vai espacando: com o client fechado, insistir de 3 em 3 segundos so
      // gasta CPU (e antes chegava a abrir um powershell por tentativa).
      const espera = this.#esperaReconexao;
      this.#esperaReconexao = Math.min(espera * 1.5, 30_000);
      // A trava só sai no momento da próxima tentativa: enquanto espera, um
      // 'close' atrasado de outro socket não abre uma segunda fila de retry.
      setTimeout(() => { this.#reconectando = false; this.#reconectar(); }, espera);
    }
  }

  /** Atalho: escuta so uma rota do client (ex.: '/lol-champ-select/v1/session'). */
  observar(caminho, callback) {
    const alvo = caminho.endsWith('/') ? caminho.slice(0, -1) : caminho;
    this.on('evento', (e) => {
      if (e.caminho === alvo) callback(e.dados, e.tipo);
    });
    return this;
  }

  fechar() {
    this.#fechandoDeProposito = true;
    this.#ws?.close();
  }
}
