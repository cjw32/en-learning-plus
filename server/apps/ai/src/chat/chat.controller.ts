import { AuthGuard } from '@libs/shared';
import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import type { ChatDto, ChatRoleType } from '@en/common/chat';
import type { Request, Response } from 'express';

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async create(
    @Body() createChatDto: ChatDto,
    @Req() req: Request & { user: { userId: string } },
    @Res() res: Response,
  ) {
    this.validateRole(createChatDto?.role);
    if (
      typeof createChatDto?.content !== 'string' ||
      !createChatDto.content.trim() ||
      createChatDto.content.length > 12000 ||
      typeof createChatDto.deepThink !== 'boolean' ||
      typeof createChatDto.webSearch !== 'boolean'
    )
      throw new BadRequestException('聊天参数无效');
    //设置返回的格式SSE 流失输出
    res.setHeader('Content-Type', 'text/event-stream'); //SSE 流式输出
    res.setHeader('Cache-Control', 'no-cache'); //不缓存
    res.setHeader('Connection', 'keep-alive'); //保持连接
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    res.once('close', disconnect);
    try {
      const stream = await this.chatService.streamCompletion(
        createChatDto,
        req.user.userId,
        controller.signal,
      ); //调用服务层的方法
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        const [msg] = chunk;
        //深度思考返回的内容不在content
        const thinkMsg = msg.additional_kwargs?.reasoning_content ?? '';
        if (thinkMsg) {
          res.write(
            `data: ${JSON.stringify({ content: thinkMsg, role: 'ai', type: 'reasoning' })}\n\n`,
          );
        }
        const content = msg.content ?? ''; //普通对话的内容
        if (content) {
          res.write(
            `data: ${JSON.stringify({ content: content, role: 'ai', type: 'chat' })}\n\n`,
          ); //将数据写入响应流
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (!res.headersSent) throw error;
        res.write('event: error\ndata: {"message":"聊天暂时不可用，请稍后重试"}\n\n');
      }
    } finally {
      res.off('close', disconnect);
    }
    if (!res.writableEnded) res.end();
  }

  private validateRole(role: unknown) {
    if (
      typeof role !== 'string' ||
      !['normal', 'master', 'business', 'qilinge', 'xiaoman'].includes(role)
    ) {
      throw new BadRequestException('聊天角色无效');
    }
  }

  @Get('history')
  findAll(
    @Req() req: Request & { user: { userId: string } },
    @Query('role') role: ChatRoleType,
  ) {
    this.validateRole(role);
    return this.chatService.findAll(req.user.userId, role);
  }
}
