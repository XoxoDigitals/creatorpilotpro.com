import { Global, Module } from '@nestjs/common';
import { QueueProducer } from './queue.producer';

/**
 * Global pg-boss producer (docs/06 §3). Global so any feature module can inject
 * QueueProducer to dispatch publish jobs without re-importing the module.
 */
@Global()
@Module({
  providers: [QueueProducer],
  exports: [QueueProducer],
})
export class QueueModule {}
