/** 与 scripts/dashboard.py 的 /api/* 返回结构一一对应 */

export interface ServiceInfo {
  pid: number | null;
  alive: boolean;
  port: number;
  listening: boolean;
}

export interface HubHealth {
  ok?: boolean;
  realm?: string;
  accounts?: number;
  accounts_ready?: number;
  api_key_required?: boolean;
  domain?: string | null;
  uid?: string | null;
  issuer?: string | null;
  expires_at?: number | null;
  _error?: string;
}

/** hub 侧 fetch_credits() 的产出（wb_accounts.py）：credits 是对象，不是数字。 */
export interface AccountCredits {
  remain?: number;
  used?: number;
  size?: number;
  packages?: Array<{ name?: string; remain?: number; used?: number; size?: number }>;
  updated_at?: number;
  updated_iso?: string;
}

export interface Account {
  uid: string;
  nickname?: string;
  realm?: string;
  domain?: string;
  enabled?: boolean;
  credits?: number | string | AccountCredits | null;
  expiresIn?: string | null;
  hasRefreshToken?: boolean;
  source?: string;
  inCooldown?: boolean;
  cooldownFor?: number | null;
  reserveBlocked?: boolean;
  proxySlot?: string | null;
}

export interface HeadroomStats {
  requests?: { total?: number; failed?: number };
  tokens?: {
    saved?: number;
    savings_percent?: number;
    total_before_compression?: number;
    proxy_compression_saved?: number;
  };
  summary?: {
    mode?: string;
    api_requests?: number;
    /** 未压缩的请求按原因分类：prefix_frozen / too_small / no_compressible_content / passthrough … */
    uncompressed_requests?: Record<string, number>;
    compression?: {
      requests_compressed?: number;
      avg_compression_pct?: number;
      best_compression_pct?: number;
      total_tokens_saved_all_layers?: number;
      total_tokens_removed?: number;
      total_tokens_before?: number;
    };
    tip?: string;
  };
  _error?: string;
}

export interface StatusPayload {
  now: string;
  runtime: string;
  services: { hub: ServiceInfo; headroom: ServiceInfo };
  hub: {
    reachable: boolean;
    health: HubHealth;
    accounts?: Account[];
    usable?: number | null;
    accounts_error?: string | null;
    models?: string[];
    models_error?: string | null;
    scheduler?: unknown;
  };
  headroom: { reachable: boolean; stats: HeadroomStats | null };
  client: {
    base_url: string;
    chat_url: string;
    api_key: string;
    api_key_source: "panel" | "launcher";
    panel_url: string;
    panel_password: string;
  };
  log_files: string[];
}

export type Realm = "intl" | "cn";

export interface LoginStart {
  state?: string;
  authUrl?: string;
  realm?: Realm;
  platform?: string;
  error?: string;
  _error?: string;
}

export interface LoginPoll {
  status?: string;
  message?: string;
  account?: unknown;
  _error?: string;
}
