(function () {
  var tg = window.Telegram.WebApp;
  var $ = function (id) { return document.getElementById(id); };

  var fundoImg = null;

  // Fundo: a miniatura da capa vira um quadro pequeno e suave (reduz a 6x10 e amplia), desenhado uma única vez; o
  // CSS estica o quadro na tela. Sem filtro de desfoque rodando a cada quadro. Uma camada escura por cima, na cor do tema.
  function pintarFundo() {
    if (!fundoImg) return;
    var c = $("bg");
    var x = c.getContext("2d");
    var mini = document.createElement("canvas");
    mini.width = 6;
    mini.height = 10;
    var m = mini.getContext("2d");
    m.imageSmoothingQuality = "high";
    var largura = fundoImg.width * c.width / c.height;
    m.drawImage(fundoImg, (fundoImg.width - largura) / 2, 0, largura, fundoImg.height, 0, 0, 6, 10);
    x.imageSmoothingQuality = "high";
    x.drawImage(mini, 0, 0, c.width, c.height);
    x.globalAlpha = 0.42;
    x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--base").trim();
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 1;
  }

  function aplicarTema() {
    document.documentElement.setAttribute("data-theme", tg.colorScheme);
    pintarFundo();
  }
  aplicarTema();
  tg.onEvent("themeChanged", aplicarTema);
  tg.ready();

  function chamar(nome, entrada, fim) {
    tg.Serverless.call(nome, entrada, fim);
  }

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
      var im = new Image();
      im.onload = function () { fundoImg = im; pintarFundo(); };
      im.src = t.covers[t.covers.length - 1];
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
