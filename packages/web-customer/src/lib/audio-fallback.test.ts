import { markUserInteracted, play, reset } from '../../../shared/src/audio';

describe('shared audio fallback', () => {
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  let audioElement: any;

  beforeEach(() => {
    reset();
    audioElement = {
      id: '', src: '', preload: '', loop: false, currentTime: 0, volume: 1,
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };
    (globalThis as any).window = {};
    (globalThis as any).document = {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      createElement: jest.fn(() => audioElement),
      body: { appendChild: jest.fn() },
    };
  });

  afterEach(() => {
    reset();
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
  });

  it('uses HTML audio after a user gesture when Web Audio is absent', () => {
    expect(play('notifica')).toBe('blocked');

    markUserInteracted();

    expect(play('notifica')).toBe('played');
    expect(audioElement.play).toHaveBeenCalledTimes(1);
  });
});
