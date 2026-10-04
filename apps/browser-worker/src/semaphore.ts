/** Bounded HTTP work; queued requests are released promptly when a lease aborts. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener('abort', aborted);
        this.active++;
        resolve();
      };
      const aborted = () => {
        const index = this.queue.indexOf(ready);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal.reason);
      };
      if (this.active < this.limit) ready();
      else {
        this.queue.push(ready);
        signal.addEventListener('abort', aborted, { once: true });
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}
