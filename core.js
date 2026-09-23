/* 星词 · 主窗口和浮窗共用的部分：存档、抽词权重、释义截短、发音、音效 */
'use strict';

const XC = (() => {
  const VERSION = '1.0.1';

  /* ---------- 存档 ----------
   * 桌面版存到 save/ 下的文件里，网页版只能用浏览器存储。
   * 桌面版第一次启动时文件还不存在，就把浏览器存储里的旧进度搬过去 */
  const DESK = (window.xingciDesktop && window.xingciDesktop.store) ||
               (window.floatApi && window.floatApi.store) || null;
  const store = {
    get(k) {
      if (!DESK) return localStorage.getItem(k);
      let v = DESK.get(k);
      if (v === null) {
        try { v = localStorage.getItem(k); } catch (e) { v = null; }
        if (v !== null) DESK.set(k, v);
      }
      return v;
    },
    set(k, v) {
      if (!DESK) return localStorage.setItem(k, v);
      if (!DESK.set(k, v)) throw new Error('写不进存档文件');
    },
    desktop: !!DESK,
  };

  /* ---------- 抽词 ----------
   * 越暗越容易抽到，隔得越久越容易抽到。故意比正经 SRS 粗糙——这只是随手玩的手感。 */
  function pick(sky, prog, skip) {
    const now = Date.now();
    let tot = 0;
    const cand = [];
    for (const { w } of sky) {
      const p = prog[w];
      if ((p && p.known) || skip(w)) continue;
      const lv = p ? p.lv : 0;
      const days = p && p.last ? (now - p.last) / 864e5 : 7;
      const wt = Math.pow(6 - Math.min(lv, 5), 1.6) * (1 + Math.min(days, 14) / 7);
      tot += wt;
      cand.push([w, wt]);
    }
    if (!cand.length) return null;
    let r = Math.random() * tot;
    for (const [w, wt] of cand) { r -= wt; if (r <= 0) return w; }
    return cand[cand.length - 1][0];
  }

  /* ---------- 释义截短 ----------
   * 浮窗只给两三个意思，胶囊宽度才稳得住。
   * ECDICT 第一行的词性不一定最常用（set 第一行是「n. 日落」），公开版又没有词性频率，
   * 就拿义项最多的那行当主义，第一行补一个意思在后面：「vt. 放, 安置 · n. 日落」 */
  const POS_RE = /^((?:[a-z]+\.\s*(?:&|和)?\s*)+)(.*)$/i;
  function senses(line, max, cap) {
    const out = [];
    let len = 0;
    for (const p of line.senses) {
      if (out.length === max || (out.length && len + p.length > cap)) break;
      out.push(p);
      len += p.length;
    }
    return line.pos + ' ' + out.join(', ');
  }
  function brief(cn) {
    const lines = [];
    for (const l of cn.split('\n')) {
      const m = l.match(POS_RE);
      if (m) lines.push({ pos: m[1].trim(), senses: m[2].split(/\s*[,，;；]\s*/).filter(Boolean) });
    }
    if (!lines.length) return cn.split('\n')[0];
    const first = lines[0];
    const main = lines.reduce((a, b) => b.senses.length > a.senses.length ? b : a);
    if (main === first) return senses(first, 3, 10);
    return senses(main, 2, 7) + ' · ' + senses(first, 1, 99);
  }

  /* ---------- 发音 ----------
   * 先用有道的真人发音（要联网）；没网或者出错，退回系统语音。
   * 很多中文 Windows 只装了中文语音，系统语音根本读不了英文，所以不能只靠它。
   * 桌面版由主进程下载并存进 cache/audio，每个词只下一次（一个约 11KB）；
   * 网页版直接用地址，靠浏览器自己的缓存。
   * 有道要两三秒才返回，所以要提前 prefetch，点喇叭时才不用等。 */
  const AUD = (window.xingciDesktop && window.xingciDesktop.audio) ||
              (window.floatApi && window.floatApi.audio) || null;
  const cache = new Map();            // 'us:word' -> Promise<Audio|null>

  function load(w, accent) {
    const k = accent + ':' + w;
    if (!cache.has(k)) {
      const src = AUD ? AUD(w, accent)
        : Promise.resolve(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(w)}&type=${accent === 'uk' ? 1 : 2}`);
      cache.set(k, src.then(url => {
        if (!url) { cache.delete(k); return null; }
        const a = new Audio();
        a.preload = 'auto';
        a.src = url;
        return a;
      }, () => { cache.delete(k); return null; }));
      if (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    return cache.get(k);
  }

  function prefetch(w, accent) {
    if (w && accent !== 'sys' && navigator.onLine) load(w, accent);
  }

  let sysVoice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    sysVoice = vs.find(v => /^en-GB/i.test(v.lang)) || vs.find(v => /^en-US/i.test(v.lang)) ||
               vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  function sysSay(w, vol) {
    if (!sysVoice) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w);
    u.voice = sysVoice; u.lang = sysVoice.lang; u.rate = 0.9; u.volume = vol;
    speechSynthesis.speak(u);
    return true;
  }

  const clamp = v => Math.max(0, Math.min(1, +v || 0));
  let playing = null;
  /* 返回 Promise<boolean>：到底有没有读出来 */
  function say(w, accent = 'us', vol = 1) {
    if (!w) return Promise.resolve(false);
    vol = clamp(vol);
    if (playing) { playing.pause(); playing = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (accent === 'sys') return Promise.resolve(sysSay(w, vol));
    return load(w, accent).then(a => {
      if (!a) return sysSay(w, vol);
      a.currentTime = 0;
      a.volume = vol;
      playing = a;
      return a.play().then(() => true, () => {
        cache.delete(accent + ':' + w);    // 坏掉的别留着，下次重新拉
        return sysSay(w, vol);
      });
    });
  }

  /* ---------- 评分音效 ----------
   * 现场合成的几声轻响，不带音频文件，离线也有。
   * 每个音是正弦加一点高八度泛音，快起慢收，听着像敲了一下小铃 */
  const SFX = {
    good:  [[0, 880], [0.075, 1318.5]],                  // 往上走：记得
    mid:   [[0, 784]],                                   // 一声：模糊
    bad:   [[0, 392], [0.09, 311.1]],                    // 往下走、低一些：忘了
    light: [[0, 659.3], [0.055, 987.8], [0.11, 1318.5]], // 三个音：点亮新词
  };
  let ac = null;
  function sfx(kind, vol = 0.5) {
    vol = clamp(vol);
    const notes = SFX[kind];
    if (!notes || !vol) return false;
    try {
      ac = ac || new AudioContext();
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + 0.01;
      const peak = (kind === 'bad' ? 0.16 : 0.12) * vol;
      for (const [dt, f] of notes) {
        for (const [mul, g, len] of [[1, 1, 0.7], [2, 0.18, 0.3]]) {
          const o = ac.createOscillator(), v = ac.createGain();
          const t = t0 + dt;
          o.type = 'sine';
          o.frequency.value = f * mul;
          v.gain.setValueAtTime(0, t);
          v.gain.linearRampToValueAtTime(peak * g, t + 0.008);
          v.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(v).connect(ac.destination);
          o.start(t);
          o.stop(t + len + 0.05);
        }
      }
      return true;
    } catch (e) { return false; }
  }

  return { VERSION, store, pick, brief, say, sfx, prefetch, hasSysVoice: () => !!sysVoice };
})();
