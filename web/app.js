const tg = window.Telegram.WebApp;
const $ = (s) => document.querySelector(s);

function chamar(nome, entrada) {
  return new Promise((ok, falha) => {
    tg.Serverless.call(nome, entrada, (err, resultado) => (err ? falha(err) : ok(resultado)));
  });
}

function aplicarTema() {
  document.documentElement.dataset.theme = tg.colorScheme;
}
aplicarTema();
tg.onEvent("themeChanged", aplicarTema);
tg.ready();

const botoes = [...document.querySelectorAll("#grid button")];
let ocupado = false;

function aviso(texto) {
  $("#toast").textContent = texto;
  $("#toast").hidden = false;
}

function mostrarFaixa(t) {
  const capa = t.covers[0];
  if (capa) {
    $("#bg").style.backgroundImage = `url(${t.covers[t.covers.length - 1]})`;
    $("#art").style.backgroundImage = `url(${capa})`;
  } else {
    $("#art").classList.add("sem-capa");
  }
  $("#live").textContent = t.nowPlaying ? "● AGORA" : "ÚLTIMA";
  $("#live").hidden = false;
  $("#titulo").textContent = t.name;
  $("#artista").textContent = t.artist;
  $("#titulo").hidden = false;
  $("#artista").hidden = false;
  if (t.plays > 0) {
    $("#plays").textContent = `${t.plays} ${t.plays === 1 ? "play" : "plays"}`;
    $("#plays").hidden = false;
  }
  $("#status").hidden = true;
}

const textoSemFaixa = (home) => (home.linked ? "Nenhuma faixa no seu histórico." : "Vincule o Last.fm no chat: /lastfm seu_usuario");

async function abrir() {
  try {
    const home = await chamar("home", {});
    $("#who").textContent = home.name;
    $("#mosaico").disabled = !home.owner;
    if (home.track) mostrarFaixa(home.track);
    else {
      $("#art").classList.add("sem-capa");
      $("#status").textContent = textoSemFaixa(home);
    }
  } catch (erro) {
    $("#art").classList.add("sem-capa");
    $("#status").textContent = erro.message;
  }
}

async function executar(comando) {
  if (ocupado) return;
  ocupado = true;
  for (const b of botoes) b.disabled = true;
  try {
    await chamar("run", { command: comando });
    aviso("Enviado no chat.");
    tg.HapticFeedback.notificationOccurred("success");
    setTimeout(() => tg.close(), 700);
  } catch (erro) {
    aviso(erro.message);
    tg.HapticFeedback.notificationOccurred("error");
    for (const b of botoes) b.disabled = b.id === "mosaico" && b.disabled;
    ocupado = false;
  }
}

$("#grid").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-cmd]");
  if (botao) executar(botao.dataset.cmd);
});

abrir();

const marca = (key, note) => chamar("diag", { key, note }).catch(() => {});
marca("open", `${tg.platform} v${tg.version} ${navigator.userAgent}`);
window.addEventListener("error", (e) => marca("err", `${e.message} ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => marca("err", String(e.reason && e.reason.message)));
