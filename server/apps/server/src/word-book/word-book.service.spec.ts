import { ResponseService } from '@libs/shared';
import { WordBookService } from './word-book.service';
describe('cited word lookup', () => {
  const dictionary = { get: jest.fn() };
  const service = new WordBookService(
    new ResponseService(),
    dictionary as never,
  );
  beforeEach(() => jest.resetAllMocks());
  it('delegates exact IDs to the existing rights-enforcing dictionary', async () => {
    dictionary.get.mockResolvedValue({ word: { wordId: 'word-400' } });
    expect((await service.findOne('word-400')).data.word.wordId).toBe(
      'word-400',
    );
    expect(dictionary.get).toHaveBeenCalledWith({ wordId: 'word-400' });
  });
  it.each(['../secret', '', '<script>'])(
    'rejects malformed locator %s',
    async (id) => {
      await expect(service.findOne(id)).rejects.toMatchObject({ status: 404 });
      expect(dictionary.get).not.toHaveBeenCalled();
    },
  );
  it('does not disclose restricted dictionary material', async () => {
    dictionary.get.mockRejectedValue(new Error('internal restricted metadata'));
    await expect(service.findOne('word-private')).rejects.toMatchObject({
      status: 404,
      message: '引用内容不存在或当前不可访问',
    });
  });
});
