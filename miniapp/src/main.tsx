import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Glass } from "@samasante/liquid-glass";
import { CONTROL } from "./optics";
import { Frost } from "./Frost";
import "./style.css";

type Tg = {
  ready(): void;
  expand(): void;
  close(): void;
  colorScheme: "light" | "dark";
  Serverless: { call(name: string, input: object, cb: (err: { type?: string; message?: string } | null, res?: unknown) => void): void };
};
const tg = (window as unknown as { Telegram?: { WebApp?: Tg } }).Telegram?.WebApp;
const call = <T,>(name: string, input: object = {}) =>
  new Promise<T>((ok, fail) => {
    if (!tg?.Serverless?.call) return fail({ message: "Abra este app pelo Telegram." });
    tg.Serverless.call(name, input, (err, res) => (err ? fail(err) : ok(res as T)));
  });

document.documentElement.dataset.theme = tg?.colorScheme === "light" ? "light" : "dark";
try {
  tg?.ready();
  const edge = tg?.colorScheme === "light" ? "#eef0f5" : "#050507";
  (tg as unknown as { setHeaderColor?(c: string): void; setBackgroundColor?(c: string): void })?.setHeaderColor?.(edge);
  (tg as unknown as { setBackgroundColor?(c: string): void })?.setBackgroundColor?.(edge);
} catch { /* sem cores da barra: segue */ }

const isBlink = /Chrome\//.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent);

type Home = {
  name: string;
  owner: boolean;
  linked: boolean;
  unavailable?: boolean;
  track: { name: string; artist: string; album: string; covers: string[]; nowPlaying: boolean; plays: number } | null;
};

// [rótulo, comando do bot, ícone]; Mosaico é o /tnowall (só dono) e não tem ícone na lista.
const BTN: [string, string, string | null][][] = [
  [["Letra", "tly", "music_note"], ["Álbum", "albnow", "library_music"], ["Story", "tstory", "planner_banner_ad_pt"]],
  [["Semana", "weekfm", "filter_7"], ["Mês", "monthfm", "30fps_select"], ["Publicar", "nowp", "arrow_upload_ready"]],
  [["Mosaico", "tnowall", null], ["Songcharts", "songcharts", "chart_data"], ["RadioFM", "radiofm", "radio"]],
];
const FALLBACK = [[47, 209, 197], [79, 140, 255], [154, 107, 255], [255, 122, 92]];

/** 4 vivid colours from a 4x4 downsample of the cover (stays on the fallback if the image can't be read). */
function usePalette(src: string | null) {
  const [pal, setPal] = useState<number[][]>(FALLBACK);
  useEffect(() => {
    setPal(FALLBACK);
    if (!src) return;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 4;
        const x = c.getContext("2d")!;
        x.drawImage(im, 0, 0, 4, 4);
        const d = x.getImageData(0, 0, 4, 4).data;
        const cells: { rgb: number[]; s: number }[] = [];
        for (let i = 0; i < 16; i++) {
          const [r, g, b] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          cells.push({ rgb: [r, g, b], s: ((mx - mn) / (mx || 1)) * Math.min(1, mx / 90) });
        }
        cells.sort((a, b) => b.s - a.s);
        const out: number[][] = [];
        for (const c2 of cells) {
          if (out.every((o) => Math.abs(o[0] - c2.rgb[0]) + Math.abs(o[1] - c2.rgb[1]) + Math.abs(o[2] - c2.rgb[2]) > 90)) out.push(c2.rgb);
          if (out.length === 4) break;
        }
        while (out.length < 4) out.push(cells[out.length].rgb);
        setPal(out);
      } catch { /* canvas contaminado: mantém as cores padrão */ }
    };
    im.src = src;
  }, [src]);
  return pal;
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

class Safe extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch(e: unknown) { console.error(e); }
  render() { return this.state.bad ? this.props.fallback : this.props.children; }
}

const Surface: React.FC<React.ComponentProps<"div">> = ({ children, className = "", style, ...rest }) => {
  const frost = (
    <Frost className={`glass ${className}`} optics={CONTROL} style={style} {...rest}>{children}</Frost>
  );
  return isBlink ? (
    <Safe fallback={frost}>
      <Glass className={`glass ${className}`} optics={CONTROL} style={style} {...(rest as object)}>{children}</Glass>
    </Safe>
  ) : frost;
};

const App = () => {
  const [home, setHome] = useState<Home | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    call<Home>("home").then(setHome, (e) => setNote(e.message || "Não consegui carregar."));
  }, []);
  const track = home?.track ?? null;
  const cover = track?.covers[0] ?? null;
  const pal = usePalette(cover);
  const tints = useMemo(() => {
    const flat: string[] = [];
    for (let i = 0; i < 9; i++) {
      const t = (((i % 3) + Math.floor(i / 3)) / 4) * 3;
      const k = Math.min(2, Math.floor(t));
      flat.push(mix(pal[k], pal[k + 1], t - k).join(" "));
    }
    return flat;
  }, [pal]);

  const run = async (command: string) => {
    if (busy) return;
    setBusy(command);
    try {
      await call("run", { command });
      setNote("Enviado no chat.");
      setTimeout(() => tg?.close(), 700);
    } catch (e) {
      setNote((e as { message?: string }).message || "Não consegui agora.");
      setBusy(null);
    }
  };

  return (
    <div className="app">
      {cover && <div className="bg" style={{ backgroundImage: `url(${cover})` }} />}
      <div className="veil" />
      <Surface className="top">
        <span className="dot" /> <b>myJAM</b>
        <span className="who">{home?.name ?? ""}</span>
      </Surface>
      <main>
        <div className="art" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
          {track && <span className="live">{track.nowPlaying ? "● AGORA" : "ÚLTIMA"}</span>}
        </div>
        {track ? (
          <>
            <h1>{track.name}</h1>
            <p className="artist">{track.artist}</p>
            {track.plays > 0 && <Surface className="plays"><b>{track.plays}</b> {track.plays === 1 ? "play" : "plays"}</Surface>}
          </>
        ) : (
          <p className="artist empty">
            {!home ? "Carregando…" : !home.linked ? "Vincule o Last.fm no chat: /lastfm seu_usuario" : home.unavailable ? "O Last.fm não respondeu agora." : "Nenhuma faixa no seu histórico."}
          </p>
        )}
        <div className="grid">
          {BTN.flat().map(([label, command, icon], i) => {
            const off = command === "tnowall" && !home?.owner;
            return (
              <Surface key={label} className={`gb${off ? " off" : ""}`} style={{ ["--c" as string]: tints[i] }}>
                <button disabled={off || !!busy} onClick={() => run(command)}>
                  {icon ? <i className="ic" style={{ WebkitMaskImage: `url(icons/${icon}.svg)`, maskImage: `url(icons/${icon}.svg)` }} /> : <i>▦</i>}
                  <span>{label}</span>
                </button>
              </Surface>
            );
          })}
        </div>
      </main>
      {note && <Surface className="toast">{note}</Surface>}
    </div>
  );
};
const root = document.getElementById("root")!;
const showError = (e: unknown) => {
  root.textContent = "";
  const p = document.createElement("p");
  p.className = "fatal";
  p.textContent = "Não consegui abrir: " + ((e as { message?: string })?.message || String(e));
  root.append(p);
};
window.addEventListener("error", (ev) => showError(ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => console.error(ev.reason));
try {
  root.textContent = "";
  createRoot(root).render(<Safe fallback={<p className="fatal">Não consegui abrir o app.</p>}><App /></Safe>);
} catch (e) { showError(e); }
