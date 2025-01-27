import { forwardRef, Inject } from '@nestjs/common';
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'http';
import { Socket } from 'socket.io';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';

@WebSocketGateway({ namespace: 'events', cors: '*' })
export class EventsGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => WhatsAppService))
    private whatsAppService: WhatsAppService,
  ) {}

  @SubscribeMessage('create_bot_with_phone')
  async handleBotCreationWithPhone(
    client: Socket,
    data: { userId: string; name: string; phoneNumber: string },
  ) {
    console.log(data);
    const bot = await this.whatsAppService.createBot(
      data.userId,
      data.name,
      {},
      data.phoneNumber,
    );
  }

  @SubscribeMessage('create_bot')
  async handleBotCreation(
    client: Socket,
    data: { userId: string; name: string },
  ) {
    console.log(data);
    const bot = await this.whatsAppService.createBot(
      data.userId,
      data.name,
      {},
    );
  }
}
