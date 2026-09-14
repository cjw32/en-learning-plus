import { testResourceLeaseSchema } from '../contracts/evidence.schema';
import { verifyResource } from './environment-guard';

export async function createResourceLease(
  input: unknown,
  probe: () => Promise<unknown>,
  now = Date.now(),
) {
  const lease = testResourceLeaseSchema.parse(input);
  if (
    Date.parse(lease.expiresAt) <= now ||
    lease.createdResourceIds.length !== 0 ||
    lease.cleanupState !== 'pending'
  )
    throw Error('INVALID_NEW_LEASE');
  await verifyResource(lease.identity, probe);
  return Object.freeze(lease);
}

export function assertLeaseResource(
  leaseInput: unknown,
  resourceId: string,
  now = Date.now(),
) {
  const lease = testResourceLeaseSchema.parse(leaseInput);
  if (
    Date.parse(lease.expiresAt) <= now ||
    !lease.createdResourceIds.includes(resourceId)
  )
    throw Error('RESOURCE_OUTSIDE_LEASE');
  return lease;
}
