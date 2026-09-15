import { Injectable, OnModuleInit } from '@nestjs/common';
import { CreateChatDto } from './dto/create-chat.dto';
import {
  createDeepSeek,
  createCheckpoint,
  createBochaSearch,
  createDeepSeekReasoner,
} from '../llm/llm.config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { type ChatRoleType, ChatDto } from '@en/common/chat';
import { AIMessageChunk, ReactAgent } from 'langchain';
import { chatMode } from '../prompt/prompt.mode';
import { createAgent } from 'langchain';
import { ResponseService } from '@libs/shared';
@Injectable()
export class ChatService implements OnModuleInit {
  constructor(private readonly responseService: ResponseService) {}
  private checkpointer: PostgresSaver;
  async onModuleInit() {
    //初始化
    this.checkpointer = await createCheckpoint();
  }
  async streamCompletion(createChatDto: ChatDto, userId: string, signal?: AbortSignal) {
    const promptObj = chatMode.find((item) => item.role === createChatDto.role);
    if (!promptObj) throw new Error('模式不存在');
    //拿到基础提示词
    let prompt = promptObj.prompt;
    if (createChatDto.webSearch) {
      const webSearchPrompt = await createBochaSearch(createChatDto.content);
      prompt += `请根据以下搜索结果回答问题：${webSearchPrompt}(并且返回你参考的网站名称)，用户问题：${createChatDto.content}`;
    }
    let model = createDeepSeek(); //默认是对话模型
    if (createChatDto.deepThink) {
      model = createDeepSeekReasoner(); //如果需要深入思考，使用推理模型
    }
    const agent = createAgent({
      model: model,
      systemPrompt: prompt,
      checkpointer: this.checkpointer,
    });
    if (!agent) {
      throw new Error('角色不存在');
    }
    //组装消息格式
    const id = `${userId}-${createChatDto.role}`;
    const stream = agent.stream(
      {
        messages: [{ role: 'human', content: createChatDto.content }], //消息
      },
      {
        configurable: { thread_id: id }, //用于做会话隔离 + 历史记录存储
        signal,
        streamMode: 'messages', //流式输出模式
      },
    );
    return stream; //返回一个迭代器
  }

  async findAll(userId: string, role: ChatRoleType) {
    const messages = await this.checkpointer.get({
      configurable: { thread_id: `${userId}-${role}` },
    });
    const list = messages?.channel_values?.messages as AIMessageChunk[];
    if (!list) return this.responseService.success([]); //如果没有消息，返回空数组
    return this.responseService.success(
      list.map((item) => ({
        role: item.type,
        content: item.content,
        reasoning: item.additional_kwargs?.reasoning_content, //返回深度思考的内容
      })),
    );
  }
}
