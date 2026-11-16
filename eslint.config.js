import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "node_modules/**",
      "design/**",
      "src/**/*.jsx",
      "src/**/*.js",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
