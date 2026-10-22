import { LoginThrottle } from './auth/throttle.ts';
import { SITE, type Env, type SiteConfig } from './config.ts';
import type { RegistryStore } from './store/types.ts';
import type { AppConfig } from './appconfig.ts';

export interface AppContext {
  env: Env;
  store: RegistryStore;
  /** Dictionary, case layout and site rules. */
  config: AppConfig;
  site: SiteConfig;
  throttle: LoginThrottle;
  now: () => Date;
}

export function makeContext(env: Env, store: RegistryStore, config: AppConfig, now: () => Date = () => new Date()): AppContext {
  if (!env.sessionSecret || env.sessionSecret.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return { env, store, config, site: SITE, throttle: new LoginThrottle(), now };
}
