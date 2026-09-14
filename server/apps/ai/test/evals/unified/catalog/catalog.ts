import coverage from './coverage.v1.json';
import { createHash } from 'node:crypto';
import { sources as coach } from './coach.catalog';
import { sources as rag } from './rag.catalog';
import { sources as pronunciation } from './pronunciation.catalog';
import { sources as mcp } from './mcp.catalog';
import { evaluationCaseSchema, EvaluationCase } from '../contracts/case.schema';

export const modules = ['coach', 'rag', 'pronunciation', 'mcp'] as const;
const sourceSpecs = {
  coach: '001-personalized-learning-coach',
  rag: '002-rag-source-citations',
  pronunciation: '003-pronunciation-assessment',
  mcp: '004-english-learning-mcp',
};
export function loadCatalog(root: string) {
  const cases: EvaluationCase[] = [];
  const mappings = new Map<string, unknown>();
  const rawById = new Map<string, unknown>();
  const missingMetadata: Array<{ caseId: string; fields: string[] }> = [];
  for (const [module, loader] of Object.entries({
    coach,
    rag,
    pronunciation,
    mcp,
  })) {
    const loaded = loader(root);
    if (loaded.primaryCount < coverage.primaryMinimums[module])
      throw Error('REQUIRED_ITEM_MISSING');
    for (const source of loaded.records) {
      const raw = source.raw;
      const kind =
        raw.source === 'hand_authored' ? 'hand_authored' : 'synthetic';
      const synthetic =
        coverage.developmentSourceHashes[source.path] === source.hash;
      if (!synthetic) throw Error('SOURCE_PROVENANCE_REVIEW_REQUIRED');
      const fields: string[] = [...source.mapping.missing];
      if (!synthetic) fields.push('authorization');
      if (module === 'pronunciation')
        fields.push('authorized_audio', 'human_gold', 'calibration');
      if (module === 'mcp') fields.push('actual_client_evidence');
      // Existing fixtures are development-visible. Their reuse basis does not authorize
      // real learners, real audio, independent validation or model-quality conclusions.
      const caseId = `${module}:${source.id}`;
      const ref = { path: source.path, hash: source.hash };
      const category = String(
        raw.category ?? raw.scenario ?? source.mapping.family,
      );
      const item = evaluationCaseSchema.parse({
        caseId,
        caseVersion:
          raw.caseVersion ?? raw.schemaVersion ?? 'legacy-metadata.v1',
        module,
        legacyRef: {
          ...ref,
          id: source.id,
          schema: raw.caseVersion ?? raw.schemaVersion ?? 'legacy-package.v1',
        },
        tags: [
          ...new Set([
            category,
            'legacy',
            source.mapping.family,
            source.mapping.polarity,
            source.primary ? 'primary' : 'supplemental',
          ]),
        ],
        risk: /security|private|injection|cross_user|confirmation|write/.test(
          category,
        )
          ? 'critical'
          : 'medium',
        requirements: [
          {
            spec: '005-unified-ai-evaluation',
            ids: ['FR-005', 'FR-009', 'FR-011'],
          },
          { spec: sourceSpecs[module], ids: source.mapping.requirementIds },
        ],
        inputRef: ref,
        contextRef: null,
        expectedRef: ref,
        expectedSideEffects: [],
        evaluators: [
          {
            evaluatorId: `${module}-legacy-contract`,
            version: '1',
            type: 'rule',
            rubricRef: null,
            required: true,
            calibrationRef: null,
          },
        ],
        provenance: {
          kind,
          source: source.path,
          useBasis:
            'existing versioned non-production regression fixture; inventory',
          authorizationRef: null,
          allowedPurposes: ['check'],
          expiresAt: null,
          revocationRule: 'honor source withdrawal',
          deletionRule: 'versioned synthetic development data',
        },
        split: 'development',
        exposure: {
          groupId: String(raw.pairGroup ?? raw.groupId ?? caseId),
          nearDuplicateIds: [],
          events: [],
        },
        groups: {
          level: {
            value: raw.profile?.cefr ?? raw.input?.learnerLevel ?? null,
            unavailableReason:
              raw.profile?.cefr || raw.input?.learnerLevel
                ? null
                : 'not_recorded',
          },
          exerciseType: {
            value: raw.request?.exerciseType ?? null,
            unavailableReason: raw.request?.exerciseType
              ? null
              : 'not_recorded',
          },
        },
        capabilityRequirements: [
          {
            capability: 'legacy_contract',
            required: true,
            allowedNotApplicable: false,
            sourceRequirement: 'FR-005',
          },
        ],
        datasetVersion: raw.datasetVersion ?? 'legacy-development.v1',
      });
      if (rawById.has(caseId)) throw Error('DUPLICATE_CASE_ID');
      cases.push(item);
      rawById.set(caseId, structuredClone(raw));
      mappings.set(caseId, structuredClone(source.mapping));
      if (fields.length) missingMetadata.push({ caseId, fields });
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
  return { cases, rawById, mappings, missingMetadata, hash, sourceSpecs };
}
