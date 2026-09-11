// Звук целиком синтезируется на месте: ни одного файла, ни одного запроса в сеть.
// Это и принцип проекта (ноль зависимостей, крошечный образ), и единственный способ
// иметь собственное звучание, а не чужое.
//
// Палитра — советский ретрофутуризм: расстроенные аналоговые пилы вместо чистых
// синусов, металл вместо колокольчиков, ленточный спад вместо ровного затухания.
// Всё это делается из осцилляторов и шума, поэтому звучит одинаково везде.

const KEY = 'corpfly_sound';

/** Буфер белого шума — основа всех металлических и воздушных звуков. */
function noiseBuffer(ctx, seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function createSfx({ AudioCtx, storage } = {}) {
  const Ctor = AudioCtx ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
  // Умолчание обязательно: игра создаёт модуль как createSfx() без аргументов, и без
  // этой строки выбор «выключить звук» молча никуда не сохранялся.
  const store = storage ?? globalThis.localStorage ?? null;
  let ctx = null;
  let master = null;
  let noise = null;
  let ambient = null;

  let enabled = true;
  try { enabled = store?.getItem(KEY) !== 'off'; } catch { /* приватный режим */ }

  /** Контекст создаётся лениво и только по жесту пользователя — иначе браузер его усыпит. */
  function ensure() {
    if (!Ctor || !enabled) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        noise = noiseBuffer(ctx, 1);
      } catch { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume?.();
    return ctx;
  }

  // --- кирпичики -------------------------------------------------------------
  /** Тон с огибающей. detune в центах даёт аналоговую «грязь». */
  function tone(c, { type = 'sawtooth', from, to = from, t0, dur, peak = 0.2, detune = 0, cutoff = null, q = 1 }) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let tail = g;
    if (cutoff !== null) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t0);
      f.Q.value = q;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Шумовой всплеск через полосовой фильтр — воздух, лязг, помеха. */
  function burst(c, { t0, dur, freq, q = 1, peak = 0.2, type = 'bandpass', sweepTo = null }) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // --- голоса ----------------------------------------------------------------
  // Без прототипа: имя голоса приходит из кода игры, но объект-литерал отвечал бы
  // и на 'constructor', и на '__proto__' — play() «успешно проигрывал» бы
  // унаследованное свойство вместо звука.
  const VOICES = Object.assign(Object.create(null), {
    // Взмах: короткий выдох воздуха плюс щелчок сервопривода.
    flap(c, t) {
      burst(c, { t0: t, dur: 0.09, freq: 900, sweepTo: 2600, q: 0.8, peak: 0.1 });
      tone(c, { type: 'triangle', from: 420, to: 700, t0: t, dur: 0.07, peak: 0.07 });
    },

    // Пройден блокер: две расстроенные пилы через фильтр — короткий металлический отзвук.
    score(c, t) {
      tone(c, { from: 660, t0: t, dur: 0.16, peak: 0.12, cutoff: 2400, detune: -7 });
      tone(c, { from: 990, t0: t + 0.01, dur: 0.13, peak: 0.08, cutoff: 3200, detune: 9 });
    },

    // Столкновение: удар по железу. Инхармоничные призвуки + низкий толчок.
    crash(c, t) {
      burst(c, { t0: t, dur: 0.35, freq: 1800, q: 0.6, peak: 0.28, sweepTo: 300 });
      tone(c, { type: 'square', from: 180, to: 60, t0: t, dur: 0.3, peak: 0.22, cutoff: 900 });
      tone(c, { type: 'sawtooth', from: 311, t0: t, dur: 0.22, peak: 0.09, cutoff: 1800, detune: 23 });
      tone(c, { type: 'sawtooth', from: 467, t0: t, dur: 0.18, peak: 0.06, cutoff: 2200, detune: -31 });
    },

    // Смерть: лента останавливается — всё съезжает вниз и глохнет.
    death(c, t) {
      tone(c, { type: 'sawtooth', from: 330, to: 44, t0: t, dur: 1.1, peak: 0.16, cutoff: 1400, detune: -12 });
      tone(c, { type: 'sawtooth', from: 247, to: 33, t0: t + 0.03, dur: 1.0, peak: 0.12, cutoff: 1100, detune: 14 });
      burst(c, { t0: t + 0.05, dur: 0.8, freq: 700, sweepTo: 90, q: 1.2, peak: 0.07 });
    },

    // Отсчёт: глухой блип реле.
    count(c, t) {
      tone(c, { type: 'square', from: 196, t0: t, dur: 0.13, peak: 0.16, cutoff: 1200 });
      burst(c, { t0: t, dur: 0.05, freq: 2400, q: 2, peak: 0.05 });
    },

    // GO: две ноты вверх, ярче и шире.
    go(c, t) {
      tone(c, { type: 'sawtooth', from: 392, t0: t, dur: 0.14, peak: 0.18, cutoff: 2600, detune: -9 });
      tone(c, { type: 'sawtooth', from: 587, t0: t + 0.1, dur: 0.3, peak: 0.2, cutoff: 3200, detune: 11 });
      burst(c, { t0: t, dur: 0.18, freq: 1200, sweepTo: 3400, q: 0.7, peak: 0.08 });
    },

    // Монета: яркий металлический двойной цокот, выше основного тембра.
    coin(c, t) {
      tone(c, { type: 'triangle', from: 1046, t0: t, dur: 0.1, peak: 0.13, cutoff: 5200 });
      tone(c, { type: 'triangle', from: 1568, t0: t + 0.055, dur: 0.14, peak: 0.11, cutoff: 6000 });
      burst(c, { t0: t, dur: 0.05, freq: 5200, q: 3, peak: 0.05 });
    },

    // Усилитель включился: тяжёлый тумблер и подъём — что-то большое пришло в движение.
    power(c, t) {
      burst(c, { t0: t, dur: 0.09, freq: 320, q: 1.6, peak: 0.18 });
      tone(c, { type: 'sawtooth', from: 110, to: 440, t0: t, dur: 0.34, peak: 0.17, cutoff: 2200, detune: -14 });
      tone(c, { type: 'sawtooth', from: 165, to: 660, t0: t + 0.04, dur: 0.3, peak: 0.12, cutoff: 2600, detune: 16 });
    },

    // Эффект кончился: тумблер обратно, короткий спад.
    powerOff(c, t) {
      tone(c, { type: 'sawtooth', from: 330, to: 120, t0: t, dur: 0.22, peak: 0.1, cutoff: 1400, detune: 9 });
      burst(c, { t0: t, dur: 0.07, freq: 260, q: 1.4, peak: 0.08 });
    },

    // Личный рекорд: короткий восходящий аккорд, тот же тембр.
    record(c, t) {
      [392, 494, 587, 784].forEach((f, i) => {
        tone(c, { type: 'sawtooth', from: f, t0: t + i * 0.08, dur: 0.5, peak: 0.13, cutoff: 3000, detune: i % 2 ? 8 : -8 });
      });
    },
  });

  // --- гул машины на время забега -------------------------------------------
  function startAmbient() {
    const c = ensure();
    if (!c || ambient) return;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.055, c.currentTime + 1.2);

    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 280;
    f.Q.value = 3;

    // Две расстроенные пилы: биение между ними и даёт «живой» аналоговый гул.
    const oscs = [55, 55.4].map((freq, i) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = i ? 6 : -6;
      o.connect(f);
      o.start();
      return o;
    });

    // Медленное дыхание фильтра — чтобы гул не был мёртвой константой.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain); lfoGain.connect(f.frequency);
    lfo.start();

    f.connect(g); g.connect(master);
    ambient = { oscs, lfo, g };
  }

  function stopAmbient() {
    if (!ambient || !ctx) return;
    const { oscs, lfo, g } = ambient;
    ambient = null;
    const t = ctx.currentTime;
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      for (const o of oscs) o.stop(t + 0.6);
      lfo.stop(t + 0.6);
    } catch { /* контекст уже закрыт */ }
  }

  // --- наружу ----------------------------------------------------------------
  return {
    get enabled() { return enabled; },
    get ready() { return Boolean(ctx); },

    /** Вызывать из обработчика жеста: без него браузер не отдаёт звук. */
    unlock() { ensure(); },

    play(name) {
      const voice = typeof name === 'string' ? VOICES[name] : undefined;
      if (typeof voice !== 'function') return false;
      const c = ensure();
      if (!c) return false;
      try { voice(c, c.currentTime); } catch { return false; }
      return true;
    },

    startAmbient,
    stopAmbient,

    toggle() {
      enabled = !enabled;
      try { store?.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* приватный режим */ }
      if (!enabled) {
        stopAmbient();
        if (master) master.gain.value = 0;
      } else if (master) {
        master.gain.value = 0.5;
      }
      return enabled;
    },
  };
}
