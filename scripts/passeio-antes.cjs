/**
 * Roda ANTES do script da tela, dentro da página, só durante o passeio.
 *
 * O console do Electron entrega a mensagem do erro, mas não a PILHA — e "Cannot read
 * properties of undefined" sem linha é um erro que não dá pra procurar num arquivo de
 * 5 mil linhas. Guardando aqui, o passeio consegue dizer o arquivo e a linha.
 */
window.__erros = [];
const anotar = (quem, msg, pilha) => {
  window.__erros.push({ quem, msg: String(msg ?? ''), pilha: String(pilha ?? '').split('\n').slice(0, 4).join(' | ') });
};
window.addEventListener('error', (e) => anotar('erro', e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  anotar('promessa', r && r.message ? r.message : r, r && r.stack);
});
