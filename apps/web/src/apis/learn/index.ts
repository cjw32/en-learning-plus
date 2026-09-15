import { serverApi, type Response } from "..";
import type { ResultLearn } from '@en/common/learn'
import type { Word } from '@en/common/word'
export const getWordList = (coursesId: string) => serverApi.get(`/learn/word/${coursesId}`) as Promise<Response<Word[]>>;
export const saveWordMaster = (wordIds: string[]) => serverApi.post(`/learn/word/master`,{ wordIds }) as Promise<Response<ResultLearn>>;
export const getStudyStats = () => serverApi.get('/learn/stats') as Promise<Response<import('@en/common/learn').StudyStats>>;
