import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Glass } from "@samasante/liquid-glass";
import { CONTROL } from "./optics";
import "./style.css";

type Track = { name: string; artist: string; album: string; covers: string[]; nowPlaying: boolean; plays: number };
type Home = { name: string; owner: boolean; linked: boolean; unavailable?: boolean; track: Track | null };
type ServerlessError = Error & { type?: string; status?: number };

const tg = window.Telegram.WebApp;

const call = <T,>(name: string, input: object = {}) =>
  new Promise<T>((resolve, reject) => {
    tg.Serverless.call(name, input, (error: ServerlessError | null, result: T) => (error ? reject(error) : resolve(result)));
  });

const applyScheme = () => {
  document.documentElement.dataset.theme = tg.colorScheme;
};
applyScheme();
tg.onEvent("themeChanged", applyScheme);
tg.expand();
tg.ready();

const BUTTONS: [string, string, string | null][] = [
  ["Letra", "tly", "music_note"],
  ["Álbum", "albnow", "library_music"],
  ["Story", "tstory", "planner_banner_ad_pt"],
  ["Semana", "weekfm", "filter_7"],
  ["Mês", "monthfm", "30fps_select"],
  ["Publicar", "nowp", "arrow_upload_ready"],
  ["Mosaico", "tnowall", null],
  ["Songcharts", "songcharts", "chart_data"],
  ["RadioFM", "radiofm", "radio"],
];

const Surface = ({ className = "", children, ...rest }: React.ComponentProps<"div">) => (
  <Glass className={`glass ${className}`} optics={CONTROL} {...(rest as object)}>
    {children}
  </Glass>
);

const statusText = (home: Home | null, error: string | null) => {
  if (error) return error;
  if (!home) return "Carregando…";
  if (!home.linked) return "Vincule o Last.fm no chat: /lastfm seu_usuario";
  if (home.unavailable) return "O Last.fm não respondeu agora.";
  return "Nenhuma faixa no seu histórico.";
};

const App = () => {
  const [home, setHome] = useState<Home | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    call<Home>("home").then(setHome, (e: ServerlessError) => setNote(e.message));
  }, []);

  const run = async (command: string) => {
    if (busy) return;
    setBusy(command);
    try {
      await call("run", { command });
      setNote("Enviado no chat.");
      setTimeout(() => tg.close(), 700);
    } catch (e) {
      setNote((e as ServerlessError).message);
      setBusy(null);
    }
  };

  const track = home?.track ?? null;
  const cover = track?.covers[0];

  return (
    <div className="app">
      {cover && <div className="bg" style={{ backgroundImage: `url(${cover})` }} />}
      <div className="veil" />
      <Surface className="top">
        <span className="dot" />
        <b>myJAM</b>
        <span className="who">{home?.name}</span>
      </Surface>
      <main>
        <div className="art" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
          {track && !cover && <i className="ic nocover" style={{ WebkitMaskImage: "url(/icons/music_note.svg)", maskImage: "url(/icons/music_note.svg)" }} />}
          {track && <span className="live">{track.nowPlaying ? "● AGORA" : "ÚLTIMA"}</span>}
        </div>
        {track ? (
          <>
            <h1>{track.name}</h1>
            <p className="artist">{track.artist}</p>
            {track.plays > 0 && (
              <Surface className="plays">
                <b>{track.plays}</b> {track.plays === 1 ? "play" : "plays"}
              </Surface>
            )}
          </>
        ) : (
          <p className="artist empty">{statusText(home, note)}</p>
        )}
        <div className="grid">
          {BUTTONS.map(([label, command, icon]) => {
            const off = command === "tnowall" && !home?.owner;
            return (
              <Surface key={label} className={`gb${off ? " off" : ""}`}>
                <button disabled={off || busy !== null} onClick={() => run(command)}>
                  {icon ? (
                    <i className="ic" style={{ WebkitMaskImage: `url(/icons/${icon}.svg)`, maskImage: `url(/icons/${icon}.svg)` }} />
                  ) : (
                    <i>▦</i>
                  )}
                  <span>{label}</span>
                </button>
              </Surface>
            );
          })}
        </div>
      </main>
      {note && track && <Surface className="toast">{note}</Surface>}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
