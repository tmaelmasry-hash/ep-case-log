// Sign-in IP throttle held in this server's memory. Account lockout (on the user record) is the firm limit.
export class LoginThrottle {
  private hits = new Map<string, { windowStart: number; attempts: number }>();

  /** Fixed window over FAILED sign-ins. */
  throttled(key: string, now: Date, windowMin: number, max: number): boolean {
    const r = this.hits.get(key);
    return !!r && r.windowStart >= now.getTime() - windowMin * 60_000 && r.attempts >= max;
  }

  recordFailure(key: string, now: Date, windowMin: number): void {
    const r = this.hits.get(key);
    if (!r || r.windowStart < now.getTime() - windowMin * 60_000) this.hits.set(key, { windowStart: now.getTime(), attempts: 1 });
    else r.attempts++;
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value!);
  }
}
