import { Client } from '@modelcontextprotocol/client';
import {
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_MODERN_PROTOCOL_VERSION,
} from '@en/common/mcp';
import { createMcpTestEnvironment } from './mcp-test-environment';

describe('MCP test environment', () => {
  it('provides isolated identities, deterministic time, and both client eras', () => {
    const fixture = createMcpTestEnvironment();
    const { userA, userB } = fixture.users;

    expect(fixture.clock.now().toISOString()).toBe('2026-09-11T08:00:00.000Z');
    fixture.clock.advanceBy(5_000);
    expect(fixture.clock.now().toISOString()).toBe('2026-09-11T08:00:05.000Z');

    expect(userA.userId).not.toBe(userB.userId);
    expect(userA.subject).not.toBe(userB.subject);
    expect(userA.clientId).not.toBe(userB.clientId);
    expect(userA.scopes).not.toEqual(userB.scopes);
    expect(fixture.issuer.verifyLocally(userA.accessToken)).toBe(userA.claims);
    expect(fixture.issuer.verifyLocally(userB.accessToken)).toBe(userB.claims);

    expect(fixture.clients.modern).toMatchObject({
      clientId: userA.clientId,
      protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
      networkRequestCount: 0,
    });
    expect(fixture.clients.legacy).toMatchObject({
      clientId: userB.clientId,
      protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
      networkRequestCount: 0,
    });
    expect(fixture.clients.modern.sdkClient).toBeInstanceOf(Client);
    expect(fixture.clients.legacy.sdkClient).toBeInstanceOf(Client);
    expect(fixture.issuer.networkRequestCount).toBe(0);
  });
});
