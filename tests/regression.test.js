import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyInitData } from '../server/src/initdata.js';
import { sanitizeScore } from '../server/src/identity.js';
import { createSfx } from '../web/src/sfx.js';

// L8 · Корпус регрессий.
//
// Каждый вход здесь когда-то ломал игру или пролезал мимо проверки. Корпус
// проигрывается при каждом прогоне — навсегда. Правило: баг не закрыт, пока его
// вход не лёг в tests/fixtures/hostile-inputs.json.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(HERE, 'fixtures/hostile-inputs.json'), 'utf8'));
const TOKEN = '8865521817:TEST_ONLY_NOT_A_REAL_TOKEN';

describe('корпус: враждебный initData', () => {
  it('корпус не пуст — иначе тест зеленеет ни на чём', () => {
    expect(corpus.initData.length).toBeGreaterThan(5);
  });

  for (const c of corpus.initData) {
    it(c.bug, () => {
      const r = verifyInitData(c.input, TOKEN, { now: 1_780_000_000_000 });
      expect(r.ok).toBe(c.expect === 'accept');
    });
  }
});

describe('корпус: недоверенный счёт', () => {
  for (const c of corpus.scores) {
    it(c.bug, () => {
      const r = sanitizeScore(c.input);
      if (c.expect === 'accept') expect(r).toBe(c.input);
      else expect(r).toBeNull();
    });
  }
});

describe('корпус: имена звуков', () => {
  const fakeCtx = class {
    constructor() { this.sampleRate = 48_000; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    resume() {}
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
    createGain() { return { connect() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} } }; }
    createOscillator() { return { connect() {}, start() {}, stop() {}, type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, detune: { value: 0 } }; }
    createBiquadFilter() { return { connect() {}, type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, Q: { value: 0 } }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, buffer: null }; }
  };

  for (const c of corpus.soundNames) {
    it(c.bug, () => {
      const sfx = createSfx({ AudioCtx: fakeCtx, storage: { getItem: () => null, setItem() {} } });
      expect(sfx.play(c.input)).toBe(c.expect === 'accept');
    });
  }
});
