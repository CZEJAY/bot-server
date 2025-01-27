import { forwardRef, Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthModule } from 'src/auth/auth.module';
import { EventsModule } from 'src/events/events.module';

@Module({
  imports: [forwardRef(() => EventsModule), AuthModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, PrismaService],
  exports: [WhatsAppService],
})
export class WhatsappModule {}
