import { Injectable } from '@nestjs/common';
import { ownedResourceNotFound } from './learning-errors';

export type OwnedResourceScope = Readonly<{
  id: string;
  userId: string;
}>;

export type OwnedResourceLoader<T> = (
  scope: OwnedResourceScope,
) => Promise<T | null>;

@Injectable()
export class OwnedResourceService {
  async requireOwned<T>(
    authenticatedSubjectId: string,
    resourceId: string,
    loadOwned: OwnedResourceLoader<T>,
  ): Promise<T> {
    if (!authenticatedSubjectId || !resourceId) {
      throw ownedResourceNotFound();
    }
    const resource = await loadOwned(
      Object.freeze({ id: resourceId, userId: authenticatedSubjectId }),
    );
    if (!resource) throw ownedResourceNotFound();
    return resource;
  }
}
