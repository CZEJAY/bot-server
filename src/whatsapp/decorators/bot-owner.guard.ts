import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BotOwnerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user.id;
    const botId = request.params.botId;

    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: { userId: true },
    });

    if (!bot || bot.userId !== userId) {
      throw new ForbiddenException('You do not have access to this bot');
    }

    return true;
  }
}
