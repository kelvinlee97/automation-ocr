import { z } from "zod";

function isPlaceholder(value: string) {
  return /^(your[_-]|server_only_|placeholder$|test-placeholder$)/i.test(value);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  WORKER_PORT: z.coerce.number().int().positive().default(8080),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_ID: z.string().min(1).default("claimflow-worker"),
  META_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().min(1),
  OPENAI_API_KEY: z.string().optional()
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "META_ACCESS_TOKEN", "OPENAI_API_KEY"] as const) {
    if (!env[key]) context.addIssue({ code: "custom", path: [key], message: key + " is required in production" });
    else if (isPlaceholder(env[key])) context.addIssue({ code: "custom", path: [key], message: key + " still contains a placeholder" });
  }
  if (env.SUPABASE_URL.includes("your-project")) context.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "SUPABASE_URL still contains a placeholder" });
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function readConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return envSchema.parse(env);
}
