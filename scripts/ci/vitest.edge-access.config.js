import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/functions/owner-provision-user/handler.test.ts"],
    environment: "node",
  },
});
