export type ConflictCandidate = Readonly<{
  chunkId: string;
  citationId: string;
  factKey: string | null;
  factValueHash: string | null;
  contentVersion: string;
  versionOrdinal: number;
  authorityRank: number | null;
  sourceStatus: string;
  relevanceScore: number;
}>;

export type ConflictResolution =
  | 'resolved_by_version'
  | 'resolved_by_authority'
  | 'unresolved';

function bestCandidate<T extends ConflictCandidate>(items: readonly T[]): T {
  return items.slice().sort(
    (left, right) =>
      right.versionOrdinal - left.versionOrdinal ||
      (right.authorityRank ?? -1) - (left.authorityRank ?? -1) ||
      right.relevanceScore - left.relevanceScore ||
      left.chunkId.localeCompare(right.chunkId),
  )[0]!;
}

export class ConflictDetector {
  evaluate<T extends ConflictCandidate>(untrustedCandidates: readonly T[]) {
    const candidates = untrustedCandidates.filter(
      (candidate) =>
        candidate.sourceStatus === 'ACTIVE' &&
        candidate.chunkId.trim() &&
        candidate.citationId.trim(),
    );
    const accepted: T[] = [];
    const conflicts: Array<{
      topic: string;
      citationIds: string[];
      resolution: ConflictResolution;
    }> = [];
    const citationUsage: Record<string, 'answer_evidence' | 'conflict_context'> = {};
    const grouped = new Map<string, T[]>();
    for (const candidate of candidates) {
      if (!candidate.factKey || !candidate.factValueHash) {
        accepted.push(candidate);
        citationUsage[candidate.citationId] = 'answer_evidence';
        continue;
      }
      const group = grouped.get(candidate.factKey) ?? [];
      group.push(candidate);
      grouped.set(candidate.factKey, group);
    }

    for (const [topic, group] of grouped) {
      const hashes = new Set(group.map((candidate) => candidate.factValueHash));
      if (hashes.size === 1) {
        const selected = bestCandidate(group);
        accepted.push(selected);
        citationUsage[selected.citationId] = 'answer_evidence';
        continue;
      }

      const highestVersion = Math.max(...group.map((candidate) => candidate.versionOrdinal));
      const newest = group.filter(
        (candidate) => candidate.versionOrdinal === highestVersion,
      );
      const newestHashes = new Set(newest.map((candidate) => candidate.factValueHash));
      let selected: T | null = null;
      let resolution: ConflictResolution = 'unresolved';
      if (newestHashes.size === 1 && newest.length < group.length) {
        selected = bestCandidate(newest);
        resolution = 'resolved_by_version';
      } else {
        const highestAuthority = Math.max(
          ...newest.map((candidate) => candidate.authorityRank ?? -1),
        );
        const authoritative = newest.filter(
          (candidate) => (candidate.authorityRank ?? -1) === highestAuthority,
        );
        const nextAuthority = Math.max(
          -1,
          ...newest
            .filter((candidate) => !authoritative.includes(candidate))
            .map((candidate) => candidate.authorityRank ?? -1),
        );
        if (
          highestAuthority > nextAuthority &&
          new Set(authoritative.map((candidate) => candidate.factValueHash)).size === 1 &&
          authoritative.length < newest.length
        ) {
          selected = bestCandidate(authoritative);
          resolution = 'resolved_by_authority';
        }
      }

      const citationIds = group.map((candidate) => candidate.citationId);
      conflicts.push({ topic, citationIds, resolution });
      if (selected) {
        accepted.push(selected);
        for (const citationId of citationIds) {
          citationUsage[citationId] =
            citationId === selected.citationId
              ? 'answer_evidence'
              : 'conflict_context';
        }
      } else {
        for (const citationId of citationIds) {
          citationUsage[citationId] = 'conflict_context';
        }
      }
    }

    return Object.freeze({
      accepted: Object.freeze(accepted),
      conflicts: Object.freeze(conflicts.map((conflict) => Object.freeze(conflict))),
      citationUsage: Object.freeze(citationUsage),
    });
  }
}
