import { describe, it, expect, beforeEach } from 'vitest';
import { createSfx } from '../web/src/sfx.js';

// Поддельный AudioContext: настоящего в Node нет, а проверять надо не тембр,
// а поведение — молчит ли выключенный звук, переживает ли отсутствие звуковой
// подсистемы, не падает ли на неизвестном имени.
function fakeAudio() {
  const log = { oscillators: 0, gains: 0, filters: 0, sources: 0, started: 0, stopped: 0, resumed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const node = () => ({ connect() {}, disconnect() {} });

  class FakeCtx {
    constructor() {
      this.sampleRate = 48_000;
      this.currentTime = 0;
      this.state = 'suspended';
      this.destination = node();
      this.log = log;
    }
    resume() { log.resumed += 1; this.state = 'running'; }
    createBuffer(_ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createGain() { log.gains += 1; return { ...node(), gain: param() }; }
    createOscillator() {
      log.oscillators += 1;
      return {
        ...node(), type: 'sine', frequency: param(), detune: param(),
        start() { log.started += 1; }, stop() { log.stopped += 1; },
      };
    }
    createBiquadFilter() { log.filters += 1; return { ...node(), type: 'lowpass', frequency: param(), Q: param() }; }
    createBufferSource() {
      log.sources += 1;
      return { ...node(), buffer: null, start() { log.started += 1; }, stop() { log.stopped += 1; } };
    }
  }
  return { FakeCtx, log };
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

let AudioCtx, log, storage;
beforeEach(() => {
  ({ FakeCtx: AudioCtx, log } = fakeAudio());
  storage = fakeStorage();
});

describe('включение и выключение', () => {
  it('по умолчанию звук включён', () => {
    expect(createSfx({ AudioCtx, storage }).enabled).toBe(true);
  });

  it('сохранённое «выключено» переживает перезагрузку', () => {
    const s = createSfx({ AudioCtx, storage: fakeStorage({ corpfly_sound: 'off' }) });
    expect(s.enabled).toBe(false);
  });

  it('переключение пишется в хранилище', () => {
    const s = createSfx({ AudioCtx, storage });
    expect(s.toggle()).toBe(false);
    expect(storage.dump().corpfly_sound).toBe('off');
    expect(s.toggle()).toBe(true);
    expect(storage.dump().corpfly_sound).toBe('on');
  });

  it('выключенный звук не создаёт ни одного узла', () => {
    const s = createSfx({ AudioCtx, storage: fakeStorage({ corpfly_sound: 'off' }) });
    s.unlock();
    for (const n of ['flap', 'score', 'crash', 'death', 'count', 'go', 'record']) {
      expect(s.play(n)).toBe(false);
    }
    s.startAmbient();
    expect(log.oscillators).toBe(0);
    expect(log.sources).toBe(0);
    expect(s.ready).toBe(false);
  });
});

describe('воспроизведение', () => {
  it('каждый голос действительно строит звук', () => {
    const s = createSfx({ AudioCtx, storage });
    for (const n of ['flap', 'score', 'crash', 'death', 'count', 'go', 'record']) {
      const before = log.started;
      expect(s.play(n)).toBe(true);
      expect(log.started).toBeGreaterThan(before);
    }
  });

  it('неизвестное имя не роняет игру', () => {
    const s = createSfx({ AudioCtx, storage });
    expect(s.play('нет такого')).toBe(false);
    expect(s.play(undefined)).toBe(false);
    expect(s.play('__proto__')).toBe(false);
    expect(s.play('constructor')).toBe(false);
  });

  it('контекст усыплён — будим его при первом звуке', () => {
    const s = createSfx({ AudioCtx, storage });
    s.play('flap');
    expect(log.resumed).toBeGreaterThan(0);
  });

  it('контекст создаётся один раз на всю игру', () => {
    const s = createSfx({ AudioCtx, storage });
    s.unlock(); s.unlock(); s.play('flap'); s.play('score');
    expect(s.ready).toBe(true);
  });
});

describe('гул машины', () => {
  it('поднимается и снимается', () => {
    const s = createSfx({ AudioCtx, storage });
    s.startAmbient();
    const running = log.oscillators;
    expect(running).toBeGreaterThan(0);
    s.startAmbient();                               // повторный вызов не плодит гудки
    expect(log.oscillators).toBe(running);
    s.stopAmbient();
    expect(log.stopped).toBeGreaterThan(0);
  });

  it('снятие несуществующего гула безопасно', () => {
    const s = createSfx({ AudioCtx, storage });
    expect(() => s.stopAmbient()).not.toThrow();
  });

  it('выключение звука гасит гул', () => {
    const s = createSfx({ AudioCtx, storage });
    s.startAmbient();
    const before = log.stopped;
    s.toggle();
    expect(log.stopped).toBeGreaterThan(before);
  });
});

describe('хранилище по умолчанию', () => {
  it('без явного storage берётся localStorage — иначе выбор не сохраняется', () => {
    const real = globalThis.localStorage;
    const mem = fakeStorage();
    globalThis.localStorage = mem;
    try {
      const s = createSfx({ AudioCtx });        // ровно так модуль создаёт игра
      s.toggle();
      expect(mem.dump().corpfly_sound).toBe('off');
      expect(createSfx({ AudioCtx }).enabled).toBe(false);
    } finally {
      if (real === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = real;
    }
  });
});

describe('среда без звука', () => {
  it('нет AudioContext — игра работает молча, а не падает', () => {
    const s = createSfx({ AudioCtx: null, storage });
    expect(() => { s.unlock(); s.startAmbient(); s.stopAmbient(); }).not.toThrow();
    expect(s.play('flap')).toBe(false);
    expect(s.enabled).toBe(true);
  });

  it('конструктор падает — тоже молчим', () => {
    class Broken { constructor() { throw new Error('no audio device'); } }
    const s = createSfx({ AudioCtx: Broken, storage });
    expect(s.play('flap')).toBe(false);
    expect(s.ready).toBe(false);
  });

  it('хранилище недоступно — звук всё равно работает', () => {
    const blocked = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
    };
    const s = createSfx({ AudioCtx, storage: blocked });
    expect(s.enabled).toBe(true);
    expect(() => s.toggle()).not.toThrow();
    expect(s.play('go')).toBe(false);          // выключили — значит молчит
  });
});
