import { describe, expect, it } from 'vitest';
import { Semaphore } from '../src/semaphore';

describe('bounded network concurrency', () => {
  it('queues excess work and reserves freed capacity in FIFO order', async () => {
    const semaphore = new Semaphore(2);
    const signal = new AbortController().signal;
    const first = await semaphore.acquire(signal);
    const second = await semaphore.acquire(signal);
    const order: number[] = [];
    const third = semaphore.acquire(signal).then((release) => {
      order.push(3);
      return release;
    });
    const fourth = semaphore.acquire(signal).then((release) => {
      order.push(4);
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    first();
    (await third)();
    (await fourth)();
    second();
    first(); // double release must not increase capacity
    expect(order).toEqual([3, 4]);
  });
  it('removes aborted waiters without consuming capacity or hanging close', async () => {
    const semaphore = new Semaphore(1);
    const controller = new AbortController();
    const first = await semaphore.acquire(controller.signal);
    const queued = semaphore.acquire(controller.signal);
    const rejected = expect(queued).rejects.toThrow();
    controller.abort();
    await rejected;
    await expect(semaphore.acquire(controller.signal)).rejects.toThrow();
    first();
    (await semaphore.acquire(new AbortController().signal))();
  });
});
