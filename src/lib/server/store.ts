import { Redis } from "@upstash/redis";
import { budgetLimits, CONCURRENT_LIMIT, GLOBAL_DAILY_LIMIT, redisConfiguration, RESERVATION_SECONDS, VISITOR_DAILY_LIMIT } from "./config";
import { PublicError } from "./security";

export const admissionScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', ARGV[2])
if redis.call('GET', KEYS[5]) == ARGV[1] then return 1 end
if redis.call('EXISTS', KEYS[5]) == 1 then return -1 end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[6]) then return -1 end
if tonumber(redis.call('GET', KEYS[1]) or '0') >= tonumber(ARGV[4]) then return -2 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[5]) then return -3 end
if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(ARGV[7]) > tonumber(ARGV[8]) then return -4 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 172800)
redis.call('INCRBY', KEYS[3], ARGV[7])
redis.call('EXPIRE', KEYS[3], 5356800)
redis.call('ZADD', KEYS[4], tonumber(ARGV[2]) + tonumber(ARGV[3]) * 1000, ARGV[1])
redis.call('EXPIRE', KEYS[4], ARGV[3])
redis.call('SET', KEYS[5], ARGV[1], 'EX', ARGV[3])
return 1
`;

export const releaseScript = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
return 1
`;

export interface InspectionStore {
  reserve(visitorId: string, reservationId: string): Promise<void>;
  release(visitorId: string, reservationId: string): Promise<void>;
}

export type RedisExecutor = { eval: (script: string, keys: string[], args: (string | number)[]) => Promise<unknown> };

function activeKeys(visitorId: string): string[] {
  return ["defect-atlas:{admission}:active", `defect-atlas:{admission}:visitor-active:${visitorId}`];
}

export function createInspectionStore(client?: RedisExecutor, now: () => number = Date.now): InspectionStore {
  const redis = client ?? new Redis({ ...redisConfiguration(), retry: false, signal: () => AbortSignal.timeout(5_000), enableTelemetry: false });
  return {
    async reserve(visitorId, reservationId) {
      const at = now();
      const day = new Date(at).toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const budget = budgetLimits();
      const keys = [`defect-atlas:{admission}:daily:${day}`, `defect-atlas:{admission}:visitor:${day}:${visitorId}`, `defect-atlas:{admission}:budget:${month}`, ...activeKeys(visitorId)];
      let result: unknown;
      try {
        result = await redis.eval(admissionScript, keys, [reservationId, at, RESERVATION_SECONDS, GLOBAL_DAILY_LIMIT, VISITOR_DAILY_LIMIT, CONCURRENT_LIMIT, budget.reserveMicroUsd, budget.monthlyMicroUsd]);
      } catch { throw new PublicError("Live inspections are temporarily unavailable. Please try again later.", 503); }
      if (result === 1) return;
      if (result === -1) throw new PublicError("Another inspection is being processed. Please try again shortly.", 429);
      if (result === -2 || result === -3) throw new PublicError("Today's demo inspection allowance has been used. Please try again another day.", 429);
      if (result === -4) throw new PublicError("This month's live demo allowance has been used. You can still explore the saved benchmark.", 429);
      throw new PublicError("Live inspections are temporarily unavailable. Please try again later.", 503);
    },
    async release(visitorId, reservationId) {
      await redis.eval(releaseScript, activeKeys(visitorId), [reservationId]);
    },
  };
}
