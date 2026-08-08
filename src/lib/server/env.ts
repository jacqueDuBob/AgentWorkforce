import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AGENTBOARD_DEMO_MODE: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_APP_NAME: z.string().default("AgentBoard"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CLASSIFIER_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_INSTALLATION_ID: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema> & {
  demoMode: boolean;
};

export function getEnv(): AppEnv {
  const parsed = envSchema.parse(process.env);
  return {
    ...parsed,
    demoMode: parsed.AGENTBOARD_DEMO_MODE === "true",
  };
}
