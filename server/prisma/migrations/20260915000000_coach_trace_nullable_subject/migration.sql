-- Subject mappings are removed on user-requested deletion; trace metadata must be unlinkable.
-- Matches the existing nullable Prisma field and ON DELETE SET NULL foreign key.
ALTER TABLE "CoachTrace" ALTER COLUMN "traceSubjectId" DROP NOT NULL;
