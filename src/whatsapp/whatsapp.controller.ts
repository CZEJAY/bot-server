import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
  NotFoundException,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { BotOwnerGuard } from './decorators/bot-owner.guard';
import { CreateBotDto } from './dto/create-bot.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';

@ApiTags('WhatsApp Bots')
@Controller('bots')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new WhatsApp bot' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Bot created successfully',
  })
  async createBot(@Request() req, @Body() createBotDto: CreateBotDto) {
    return this.whatsAppService.createBot(
      req.user.id,
      createBotDto.name,
      createBotDto.config || {},
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all bots for the current user' })
  async getUserBots(userId: string) {
    return this.prisma.bot.findMany({
      where: { userId },
      include: {
        groups: {
          select: {
            id: true,
            groupId: true,
            name: true,
            isProtected: true,
            whitelist: true,
          },
        },
      },
    });
  }

  @Get(':botId')
  @UseGuards(BotOwnerGuard)
  @ApiOperation({ summary: 'Get bot details' })
  async getBotDetails(@Param('botId') botId: string) {
    const bot = await this.whatsAppService.getBotStatus(botId);
    if (!bot) throw new NotFoundException('Bot not found');
    return bot;
  }

  @Get(':botId/qr')
  @UseGuards(BotOwnerGuard)
  @ApiOperation({ summary: 'Get bot QR code' })
  async getBotQR(@Param('botId') botId: string) {
    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: { qrCode: true, status: true },
    });

    if (!bot) throw new NotFoundException('Bot not found');
    if (bot.status !== 'AWAITING_QR_SCAN') {
      throw new BadRequestException('QR code is not available');
    }

    return { qrCode: bot.qrCode };
  }

  @Post(':botId/reconnect')
  @UseGuards(BotOwnerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reconnect a disconnected bot' })
  async reconnectBot(@Param('botId') botId: string) {
    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
      select: { status: true },
    });

    if (!bot) throw new NotFoundException('Bot not found');
    if (bot.status === 'CONNECTED') {
      throw new BadRequestException('Bot is already connected');
    }

    // Disconnect first if needed
    await this.whatsAppService.disconnectBot(botId);
    // Create new instance
    return this.whatsAppService.createBotInstance(botId);
  }

  @Delete(':botId')
  @UseGuards(BotOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a bot' })
  async deleteBot(@Param('botId') botId: string) {
    await this.whatsAppService.disconnectBot(botId);
    await this.prisma.bot.delete({
      where: { id: botId },
    });
  }

  @Post(':botId/groups')
  @UseGuards(BotOwnerGuard)
  @ApiOperation({ summary: 'Add a new group to monitor' })
  async addGroup(
    @Param('botId') botId: string,
    @Body() createGroupDto: CreateGroupDto,
  ) {
    const bot = await this.prisma.bot.findUnique({
      where: { id: botId },
    });

    if (!bot) throw new NotFoundException('Bot not found');

    return this.prisma.group.create({
      data: {
        ...createGroupDto,
        botId,
      },
    });
  }

  @Put(':botId/groups/:groupId')
  @UseGuards(BotOwnerGuard)
  @ApiOperation({ summary: 'Update group settings' })
  async updateGroup(
    @Param('botId') botId: string,
    @Param('groupId') groupId: string,
    @Body() updateGroupDto: UpdateGroupDto,
  ) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        botId,
      },
    });

    if (!group) throw new NotFoundException('Group not found');

    return this.prisma.group.update({
      where: { id: groupId },
      data: updateGroupDto,
    });
  }

  @Delete(':botId/groups/:groupId')
  @UseGuards(BotOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a group from monitoring' })
  async removeGroup(
    @Param('botId') botId: string,
    @Param('groupId') groupId: string,
  ) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        botId,
      },
    });

    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.group.delete({
      where: { id: groupId },
    });
  }

  @Get(':botId/groups')
  @UseGuards(BotOwnerGuard)
  @ApiOperation({ summary: 'Get all monitored groups for a bot' })
  async getGroups(@Param('botId') botId: string) {
    return this.prisma.group.findMany({
      where: { botId },
    });
  }
}
