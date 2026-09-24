import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

@Injectable()
export class EventsService {
  private readonly emitter = new EventEmitter();

  emit(event: string, payload: unknown) {
    this.emitter.emit(event, payload);
  }

  on(event: string, listener: (payload: unknown) => void) {
    this.emitter.on(event, listener);
  }
}
