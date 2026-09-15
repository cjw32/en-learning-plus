import { Prisma } from '../generated/prisma/client';
export const STUDY_TIMEZONE = 'Asia/Shanghai';
export function studyDate(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: STUDY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
// Must share the successful learning write's transaction; never call for a replay.
export async function recordStudyDay(
  database: Pick<Prisma.TransactionClient, '$executeRaw' | 'user'>,
  userId: string,
  at = new Date(),
): Promise<boolean> {
  const inserted = await database.$executeRaw(Prisma.sql`
    INSERT INTO "UserStudyDay" ("userId", "studyDate", "createdAt")
    VALUES (${userId}, ${studyDate(at)}, ${at})
    ON CONFLICT ("userId", "studyDate") DO NOTHING
  `);
  if (inserted === 0) return false;
  await database.user.update({
    where: { id: userId },
    data: { dayNumber: { increment: 1 } },
    select: { id: true },
  });
  return true;
}
