import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath } from '../core/control-loader';

function mapping(_root: string, raw: any) {
  return {
    family: 'synthetic_alignment',
    requirementIds: [
      'FR-036',
      'FR-038',
      'FR-039',
      'FR-040',
      'FR-066',
      'FR-078',
      'FR-079',
      'FR-082',
    ],
    polarity: raw.annotation.shouldReject ? 'failure' : 'positive',
    versions: structuredClone(raw.versions),
    audio: structuredClone(raw.audio),
    sourceProvenance: structuredClone(raw.provenance),
    qualityEligible: false,
    missing: [
      'authorized_audio',
      'verified_audio_hash',
      'human_gold',
      'calibration',
      'provider_approval',
    ],
  };
}

const files = [
  ['server/apps/ai/test/evals/pronunciation/fixtures/manifest.jsonl', true],
] as const;
export function sources(root: string) {
  let primaryCount = 0;
  const records = files.flatMap(([path, primary]) => {
    const bytes = readFileSync(safePath(root, path));
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const data = path.endsWith('.jsonl')
      ? bytes
          .toString()
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : JSON.parse(bytes.toString()).cases;
    if (!Array.isArray(data) || !data.length)
      throw Error('CASE_METADATA_MISSING');
    if (primary) primaryCount += data.length;
    return data.map((raw: any) => {
      const id = raw.id ?? raw.caseId;
      if (typeof id !== 'string' || !id) throw Error('CASE_METADATA_MISSING');
      return {
        id,
        path,
        hash: fileHash,
        raw,
        primary,
        mapping: mapping(root, raw),
      };
    });
  });
  return { primaryCount, records };
}
