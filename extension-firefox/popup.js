// Versão Firefox — mesma lógica da versão Chrome/Edge (ver /extension), só
// trocando o namespace `chrome.*` (callback) pelo `browser.*` (Promise).
const STORAGE_KEY = 'gdlButtonEnabled';
const toggle = document.getElementById('toggle');

browser.storage.local.get([STORAGE_KEY]).then((res) => {
  toggle.checked = res[STORAGE_KEY] !== false; // padrão: ativado
});

toggle.addEventListener('change', () => {
  browser.storage.local.set({ [STORAGE_KEY]: toggle.checked });
});

// O login (botão "Conectar ao app") não é feito por aqui — mesmo
// comportamento confirmado na versão Chrome: um clique no popup da extensão
// não conta como gesto do usuário pra página nenhuma, então o navegador
// nunca libera a navegação pro protocolo customizado do app nesse caso. O
// botão de verdade fica fixo no canto da página do youtube.com (ver
// content.js), onde o clique é real.
//
// A extensão não sabe o status real de login do app (não existe canal de
// volta) — ela só assume que deu certo assim que o clique dispara a
// navegação, e esconde o botão da página a partir daí (gdlLoginConnected no
// storage). Esse link limpa essa marcação manualmente, pro botão voltar a
// aparecer caso o usuário desconecte (ou troque de conta) direto no app.
const btnResetLogin = document.getElementById('btn-reset-login');
if (btnResetLogin) {
  btnResetLogin.addEventListener('click', () => {
    browser.storage.local.set({ gdlLoginConnected: false });
    btnResetLogin.textContent = 'Pronto! Volte pro YouTube.';
    setTimeout(() => { btnResetLogin.textContent = 'Desconectei no app — mostrar o botão de novo'; }, 2000);
  });
}
