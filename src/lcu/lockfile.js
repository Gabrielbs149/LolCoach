import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Caminhos mais comuns de instalacao. O lockfile so existe enquanto o client
// esta aberto — a simples existencia dele ja diz se o League esta rodando.
const CAMINHOS_PADRAO = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile',
];

/**
 * O processo ainda existe? Sinal 0 nao mata nada, so pergunta.
 * EPERM significa que existe mas nao temos permissao — para o nosso fim, vivo.
 */
function processoVivo(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * O Riot NAO apaga o lockfile ao fechar o client: ele fica no disco apontando
 * pra uma porta morta e pra um PID que ja nao existe. Confiar na existencia do
 * arquivo fazia o app tentar conectar sem parar num client fechado.
 */
export const clienteParecendoAberto = () => CAMINHOS_PADRAO.some((caminho) => {
  if (!existsSync(caminho)) return false;
  try {
    const pid = Number(readFileSync(caminho, 'utf8').split(':')[1]);
    return processoVivo(pid);
  } catch { return false; }
});

// Formato do arquivo: NomeDoProcesso:PID:PORTA:SENHA:PROTOCOLO
function parseLockfile(texto) {
  const partes = texto.trim().split(':');
  if (partes.length < 5) throw new Error('lockfile em formato inesperado');
  return {
    processo: partes[0],
    pid: Number(partes[1]),
    porta: Number(partes[2]),
    senha: partes[3],
    protocolo: partes[4],
    origem: 'lockfile',
  };
}

/**
 * Plano B: a linha de comando do LeagueClientUx.exe carrega a porta e o token.
 *
 * Isto abre um powershell.exe, entao NAO pode ser chamado em laco. Uma versao
 * anterior fazia exatamente isso — tentava de 3 em 3 segundos com o League
 * fechado — e o PC do Gabriel acumulou 39 powershell abertos numa noite.
 * Hoje so roda quando ha indicio real de que o client esta no ar.
 */
async function lerDaLinhaDeComando() {
  const ps = [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
  ];
  const { stdout } = await run('powershell.exe', ps, { windowsHide: true, timeout: 15_000 });
  const porta = stdout.match(/--app-port=(\d+)/);
  const senha = stdout.match(/--remoting-auth-token=([\w-]+)/);
  if (!porta || !senha) throw new Error('LeagueClientUx.exe nao esta rodando');
  return {
    processo: 'LeagueClientUx',
    pid: null,
    porta: Number(porta[1]),
    senha: senha[1],
    protocolo: 'https',
    origem: 'linha de comando',
  };
}

/**
 * Descobre porta + senha do client.
 * `usarProcesso: false` proibe o plano B, pra quem esta em laco de espera.
 */
export async function descobrirCredenciais({ usarProcesso = true } = {}) {
  for (const caminho of CAMINHOS_PADRAO) {
    try {
      const cred = parseLockfile(await readFile(caminho, 'utf8'));
      // Lockfile orfao de uma sessao anterior: o arquivo esta la, o client nao.
      if (!processoVivo(cred.pid)) continue;
      return { ...cred, caminho };
    } catch { /* travado pelo client ou inexistente: tenta o proximo */ }
  }
  if (!usarProcesso) throw new Error('client fechado');
  return await lerDaLinhaDeComando();
}

/**
 * Fica tentando ate o client abrir.
 *
 * Enquanto nao ha sinal do League, so faz checagem de arquivo (custo zero) e
 * espera cada vez mais. O plano B com powershell entra apenas quando existe
 * lockfile, ou de vez em quando, pro caso de uma instalacao fora dos caminhos
 * conhecidos.
 */
export async function esperarClient({ intervaloMs = 3000, intervaloMaxMs = 30_000, aoTentar } = {}) {
  let espera = intervaloMs;
  let voltas = 0;

  for (;;) {
    const temLockfile = clienteParecendoAberto();
    // Uma sondagem por processo a cada ~20 voltas cobre instalacao fora do padrao
    // sem transformar a espera numa fabrica de powershell.
    const usarProcesso = temLockfile || voltas % 20 === 0;

    try {
      const cred = await descobrirCredenciais({ usarProcesso });
      return cred;
    } catch (erro) {
      aoTentar?.(erro);
    }

    voltas++;
    await new Promise((r) => setTimeout(r, espera));
    // Sem sinal nenhum do League, vai espacando ate 30s.
    if (!temLockfile) espera = Math.min(espera * 1.5, intervaloMaxMs);
    else espera = intervaloMs;
  }
}
