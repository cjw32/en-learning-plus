import { serverApi, type Response} from '../index'
import type { WordQuery, WordList } from '@en/common/word'
export const getWordBookList = (params: WordQuery): Promise<Response<WordList>> => {
    return serverApi.get('/word-book', { params }) as Promise<Response<WordList>>
}
export interface CitedWord {
  word: { wordId: string; word: string; definition?: string | null; translation?: string | null; phonetic?: string | null };
  forms: readonly string[];
  examples: readonly string[];
}
export const getCitedWord = (id: string) => serverApi.get(`/word-book/${encodeURIComponent(id)}`) as Promise<Response<CitedWord>>;
