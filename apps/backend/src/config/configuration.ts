import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '@pantry-pal/shared';

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  seedDemoData: boolean;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function configuration(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    host: process.env.HOST ?? '0.0.0.0',
    port: toPort(process.env.PORT, DEFAULT_BACKEND_PORT),
    corsOrigins: (process.env.CORS_ORIGIN ?? `http://localhost:${DEFAULT_FRONTEND_PORT}`)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    seedDemoData: toBoolean(process.env.SEED_DEMO_DATA, false),
  };
}
