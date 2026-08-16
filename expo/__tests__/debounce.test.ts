import { debounce } from '../src/lib/debounce';

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires once after the idle window, using the latest call\'s args', () => {
    const fn = jest.fn();
    const d = debounce(fn, 900);

    d.call('a');
    jest.advanceTimersByTime(500);
    d.call('b'); // resets the timer — 'a' should never fire
    jest.advanceTimersByTime(899);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('never fires if cancelled before the idle window elapses', () => {
    const fn = jest.fn();
    const d = debounce(fn, 900);

    d.call();
    jest.advanceTimersByTime(500);
    d.cancel();
    jest.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('can be called again after firing', () => {
    const fn = jest.fn();
    const d = debounce(fn, 900);

    d.call();
    jest.advanceTimersByTime(900);
    expect(fn).toHaveBeenCalledTimes(1);

    d.call();
    jest.advanceTimersByTime(900);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel is a no-op when nothing is pending', () => {
    const fn = jest.fn();
    const d = debounce(fn, 900);
    expect(() => d.cancel()).not.toThrow();
  });
});
