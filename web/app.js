(function () {
  var tg = window.Telegram.WebApp;
  var $ = function (id) { return document.getElementById(id); };

  document.documentElement.setAttribute("data-theme", tg.colorScheme);
  tg.onEvent("themeChanged", function () { document.documentElement.setAttribute("data-theme", tg.colorScheme); });
  tg.ready();

  function chamar(nome, entrada, fim) {
    tg.Serverless.call(nome, entrada, fim);
  }

  chamar("diag", { key: "open", note: tg.platform + " v" + tg.version }, function () {});
  window.addEventListener("error", function (e) {
    chamar("diag", { key: "err", note: e.message + " " + e.filename + ":" + e.lineno }, function () {});
  });

  var botoes = Array.prototype.slice.call(document.querySelectorAll("#grid button"));
  var ocupado = false;
  var dono = false;

  function aviso(texto) {
    $("toast").textContent = texto;
    $("toast").hidden = false;
  }

  function mostrarFaixa(t) {
    var capa = t.covers[0];
    if (capa) {
      $("bg").style.backgroundImage = "url(" + t.covers[t.covers.length - 1] + ")";
      $("art").style.backgroundImage = "url(" + capa + ")";
    } else {
      $("art").className = "nocover";
    }
    $("live").textContent = t.nowPlaying ? "● AGORA" : "ÚLTIMA";
    $("live").hidden = false;
    $("title").textContent = t.name;
    $("artist").textContent = t.artist;
    $("title").hidden = false;
    $("artist").hidden = false;
    if (t.plays > 0) {
      $("plays").textContent = t.plays + (t.plays === 1 ? " play" : " plays");
      $("plays").hidden = false;
    }
    $("status").hidden = true;
  }

  chamar("home", {}, function (erro, home) {
    if (erro) {
      $("art").className = "nocover";
      $("status").textContent = erro.message;
      return;
    }
    $("who").textContent = home.name;
    dono = home.owner;
    $("mosaico").disabled = !dono;
    if (home.track) return mostrarFaixa(home.track);
    $("art").className = "nocover";
    $("status").textContent = home.linked ? "Nenhuma faixa no seu histórico." : "Vincule o Last.fm no chat: /lastfm seu_usuario";
  });

  $("grid").addEventListener("click", function (e) {
    var botao = e.target.closest("button[data-cmd]");
    if (!botao || ocupado) return;
    ocupado = true;
    botoes.forEach(function (b) { b.disabled = true; });
    chamar("run", { command: botao.getAttribute("data-cmd") }, function (erro) {
      if (erro) {
        aviso(erro.message);
        ocupado = false;
        botoes.forEach(function (b) { b.disabled = b.id === "mosaico" && !dono; });
        return;
      }
      aviso("Enviado no chat.");
      setTimeout(function () { tg.close(); }, 700);
    });
  });
})();
