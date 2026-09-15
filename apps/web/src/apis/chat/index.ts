import { aiApi, type Response } from "..";
import type { ChatMessageList, ChatModeList, ChatRoleType } from "@en/common/chat";
export const getChatMode = () => aiApi.get('/prompt/list') as Promise<Response<ChatModeList>>; 
//读取历史记录
export const getChatHistory = (role: ChatRoleType) => aiApi.get(`/chat/history?role=${role}`) as Promise<Response<ChatMessageList>>;