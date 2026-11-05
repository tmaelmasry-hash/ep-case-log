// Site rules for sign-in (values from EP Workspace config/site.json → auth).
export interface SiteConfig {
  auth: { session_hours: number; remember_days: number; lockout_after_failed: number };
}

export const SITE: SiteConfig = {
  auth: { session_hours: 12, remember_days: 30, lockout_after_failed: 10 },
};

/** Cloudflare's Workers AI binding (env.AI on the Worker). */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  /** ≥ 32 characters; signs session cookies. Never sent to the browser. */
  sessionSecret: string;
  /** False only for plain-http local runs on a LAN address (cookies need HTTPS or localhost when true). */
  secureCookies: boolean;
  /** AI provider keys (phase 11): only in the Worker's secrets / local .env, never in the browser or the Sheet. */
  anthropicKey?: string;
  geminiKey?: string;
  openaiKey?: string;
  groqKey?: string;
  /** Present only on the deployed Worker. */
  aiBinding?: AiBinding;
}
