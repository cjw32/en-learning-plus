import {
  toPublicLearningError,
} from './learning-errors';
import { OwnedResourceService } from './owned-resource.service';

describe('OwnedResourceService', () => {
  it('uses one scoped query and returns identical errors for missing and foreign IDs', async () => {
    const service = new OwnedResourceService();
    const resources = new Map([
      ['resource-a', { id: 'resource-a', userId: 'user-a' }],
      ['resource-b', { id: 'resource-b', userId: 'user-b' }],
    ]);
    const loadOwned = jest.fn(async (scope: { id: string; userId: string }) => {
      const resource = resources.get(scope.id);
      return resource?.userId === scope.userId ? resource : null;
    });

    const publicErrors = [];
    for (const resourceId of ['resource-missing', 'resource-b']) {
      try {
        await service.requireOwned('user-a', resourceId, loadOwned);
      } catch (error) {
        publicErrors.push(toPublicLearningError(error));
      }
    }

    expect(publicErrors).toHaveLength(2);
    expect(publicErrors[0]).toEqual(publicErrors[1]);
    expect(publicErrors[0]).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: '学习资源不存在或不可访问',
      retryable: false,
      statusCode: 404,
    });
    expect(loadOwned).toHaveBeenNthCalledWith(
      2,
      Object.freeze({ id: 'resource-b', userId: 'user-a' }),
    );
  });
});
