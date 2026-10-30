// Tabela comando -> função, usada pelo handler de mensagens e pelo endpoint `run` do Mini App.
import * as c from './commands.js';
import * as radio from './radio.js';
import * as owner from './owner.js';
import * as custom from './story_custom.js';
import * as canvas from './canvas.js';

export const ROUTES = {
  start: (m) => c.start(m),
  help: (m) => c.help(m),
  lastfm: (m, arg) => c.lastfm(m, arg),
  lastfmoff: (m) => c.lastfmoff(m),
  playing: (m) => c.playing(m),
  tly: (m) => c.tly(m),
  tstory: async (m) => { if (await c.tstory(m)) { await custom.offerCustom(m); await canvas.offerCanvas(m); } },
  albnow: (m) => c.albnow(m),
  weekfm: (m) => c.rankOf(m, '7day'),
  monthfm: (m) => c.rankOf(m, '1month'),
  nowp: (m) => c.nowp(m),
  tnow: (m) => c.tnow(m),
  songcharts: (m, arg) => c.songcharts(m, arg),
  radiofm: (m, arg) => radio.radiofm(m, arg),
  myself: (m) => radio.myself(m),
  tmn: (m, arg) => owner.tmn(m, arg),
  tpv: (m, arg) => owner.tpv(m, arg),
  onoff: (m, arg) => owner.onoff(m, arg),
  tnowall: (m) => owner.tnowall(m),
  songchartsall: (m, arg) => owner.chartsAll(m, arg, null),
  weekall: (m) => owner.chartsAll(m, '', '7day'),
  monthall: (m) => owner.chartsAll(m, '', '1month'),
  setup: (m) => c.setup(m),
};
