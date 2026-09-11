\set trace_number random(1,50000)
\set intent_number random(1,50000)

BEGIN;

SELECT id, "targetKey", "reviewState", "dueAt", "lastReviewedAt", "lastQuality", "updatedAt"
FROM "LearningItemState"
WHERE "userId" = 'user_load'
  AND "targetType" = 'WORD'
  AND "wordId" IS NOT NULL
  AND "dueAt" IS NOT NULL
  AND "dueAt" < now() + interval '1 day'
  AND "reviewState" IN ('LEARNING', 'REVIEW', 'MASTERED')
ORDER BY "dueAt", "targetKey"
LIMIT 100;

SELECT count(*)
FROM "WordBookRecord"
WHERE "userId" = 'user_load' AND "isMaster" = true;

SELECT id, "savedAt", score, "errorTypes"
FROM "LearningAttempt"
WHERE "userId" = 'user_load'
  AND "savedAt" >= now() - interval '90 days'
  AND "savedAt" < now() + interval '1 day'
ORDER BY "savedAt", id
LIMIT 50;

SELECT t."traceId", t."capabilityName", t."terminalStatus", t."inputTokens",
       t."outputTokens", t."estimatedCostMicros", s.sequence, s."stepType", s.status,
       s."durationMs"
FROM "McpTrace" t
LEFT JOIN "McpTraceStep" s ON s."traceId" = t.id
WHERE t."traceId" = 'trace_' || :trace_number
ORDER BY s.sequence;

SELECT id, status, "leaseExpiresAt", "safeTerminalProjection"
FROM "McpIdempotencyIntent"
WHERE "userId" = 'user_load'
  AND issuer = 'https://issuer.synthetic'
  AND "clientId" = 'client_load'
  AND "toolName" = CASE WHEN :intent_number % 2 = 0 THEN 'CREATE_QUIZ'::"McpIdempotencyToolName" ELSE 'SUBMIT_ANSWER'::"McpIdempotencyToolName" END
  AND "clientKeyDigest" = md5(:intent_number::text) || md5('k' || :intent_number::text)
LIMIT 1;

SELECT id, status, "leaseExpiresAt"
FROM "McpIdempotencyIntent"
WHERE "authorizationId" = 'auth_load'
  AND status = 'RECONCILING'
  AND "leaseExpiresAt" <= now()
ORDER BY "leaseExpiresAt", id
LIMIT 100;

COMMIT;
