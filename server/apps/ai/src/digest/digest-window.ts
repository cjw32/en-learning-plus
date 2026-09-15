import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);

export type DigestJob = {
  version: 2;
  userId: string;
  timezone: string;
  timingTaskTime: string;
  scheduledAt: string;
  start: string;
  end: string;
  localDate: string;
};

// Windows are bounded by local delivery times, including 23/25-hour DST days.
export function digestWindow(now: Date, zone: string, time: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return null;
  try {
    const local = dayjs(now).tz(zone);
    let date = local.format('YYYY-MM-DD');
    let end = dayjs.tz(`${date} ${time}`, zone);
    if (end.valueOf() > now.getTime()) {
      date = dayjs.utc(date).subtract(1, 'day').format('YYYY-MM-DD');
      end = dayjs.tz(`${date} ${time}`, zone);
    }
    if (now.getTime() - end.valueOf() >= 60_000) return null;
    const previousDate = dayjs
      .utc(date)
      .subtract(1, 'day')
      .format('YYYY-MM-DD');
    const start = dayjs.tz(`${previousDate} ${time}`, zone);
    return {
      scheduledAt: end.toISOString(),
      start: start.toISOString(),
      end: end.toISOString(),
      localDate: date,
    };
  } catch {
    return null;
  }
}
