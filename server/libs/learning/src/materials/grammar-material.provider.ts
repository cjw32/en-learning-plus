import { Injectable } from '@nestjs/common';
import {
  LearningMaterialProvider,
  LearningMaterialSearchContext,
} from './learning-material.provider';

@Injectable()
export class GrammarMaterialProvider implements LearningMaterialProvider {
  readonly materialType = 'grammar' as const;

  search(_context: LearningMaterialSearchContext) {
    return Promise.resolve({ available: false, materials: [] });
  }
}
