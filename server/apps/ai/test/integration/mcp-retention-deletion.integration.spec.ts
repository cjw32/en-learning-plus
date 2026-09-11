import { McpRetentionService } from '../../src/mcp/retention/mcp-retention.service';
import { McpLearningDataCleanupService } from '../../src/mcp/retention/mcp-learning-data-cleanup.service';

describe('MCP retention and deletion', () => {
  const now = new Date('2026-09-11T00:00:00Z');

  it('keeps diagnostics off by default, caps approved retention at seven days, and cleans pending state within 24 hours', async () => {
    const repository = {
      expireLegacySessions: jest.fn(),
      expirePendingConfirmations: jest.fn(),
      deleteExpiredTraces: jest.fn(),
      deleteExpiredAuthorizations: jest.fn(),
    };
    const service = new McpRetentionService(repository, {
      diagnosticsEnabled: false,
      requestedDiagnosticsDays: 99,
    });
    expect(service.policy()).toMatchObject({
      diagnosticsEnabled: false,
      diagnosticsDays: 0,
      pendingCleanupHours: 24,
    });
    await service.run(now);
    expect(repository.expirePendingConfirmations).toHaveBeenCalledWith(
      now,
      new Date('2026-09-10T00:00:00.000Z'),
    );
    expect(repository.deleteExpiredTraces).toHaveBeenCalled();
    expect(
      new McpRetentionService(repository, {
        diagnosticsEnabled: true,
        requestedDiagnosticsDays: 99,
      }).policy().diagnosticsDays,
    ).toBe(7);
  });

  it('revokes first, then removes every owned MCP mapping and pending link', async () => {
    const repository = { revokeAccess: jest.fn(), purgeOwnedData: jest.fn() };
    const cleanup = new McpLearningDataCleanupService(repository);
    await cleanup.hideImmediately('user_1', now);
    expect(repository.revokeAccess).toHaveBeenCalledWith('user_1', now);
    await cleanup.purgeOwnedData('user_1');
    expect(repository.purgeOwnedData).toHaveBeenCalledWith('user_1');
  });
});
