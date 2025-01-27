import { Module, forwardRef } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';

@Module({
  imports: [forwardRef(() => WhatsappModule)],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
