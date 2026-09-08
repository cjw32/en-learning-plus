export type LearningMaterialType = 'word' | 'course' | 'grammar';
export type LearningMaterialAccessScope = 'PUBLIC' | 'OWNED_COURSE';

export type LearningMaterialCitation = {
  sourceId: string;
  materialType: LearningMaterialType;
  title: string;
  locator: string | null;
  supports: string;
  accessScope: LearningMaterialAccessScope;
};

export type LearningMaterial = {
  citation: LearningMaterialCitation;
  summary: string;
  freshness: Date;
};

export type LearningMaterialSearchContext = Readonly<{
  subjectId: string;
  query: string;
  limit: number;
  cefrLevel?: string | null;
  courseId?: string;
}>;

export type LearningMaterialProviderResult = {
  materials: LearningMaterial[];
  available: boolean;
};

export interface LearningMaterialProvider {
  readonly materialType: LearningMaterialType;
  search(
    context: LearningMaterialSearchContext,
  ): Promise<LearningMaterialProviderResult>;
}

export type LearningMaterialSearchResult = {
  query: string;
  materials: LearningMaterial[];
  unavailableTypes: LearningMaterialType[];
};
