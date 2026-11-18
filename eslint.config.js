import tseslint from "typescript-eslint";

const allowedComments = [
  /^\s*@vitest-environment \w+\s*$/,
  /^\/ <reference types="[^"]+" \/>$/,
];

const noComments = {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      noComments:
        "Comments are not allowed. The code is the documentation: rename or extract until it explains itself.",
    },
    schema: [],
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Program() {
        for (const comment of source.getAllComments()) {
          if (allowedComments.some((pattern) => pattern.test(comment.value))) {
            continue;
          }
          context.report({
            loc: comment.loc,
            messageId: "noComments",
            fix(fixer) {
              const text = source.text;
              let start = comment.range[0];
              let end = comment.range[1];
              while (start > 0 && /[ \t]/.test(text[start - 1])) start--;
              const ownLine = start === 0 || text[start - 1] === "\n";
              if (ownLine && text[end] === "\n") end++;
              return fixer.removeRange([start, end]);
            },
          });
        }
      },
    };
  },
};

const ownCode = ["**/*.{ts,tsx}"];
const vendoredUi = ["src/components/ui/**"];

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
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useEffect", "useLayoutEffect"],
              message:
                "No effects in app code. Derive during render, handle it in the event, or subscribe with useSyncExternalStore.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='React'][property.name=/^use(Layout)?Effect$/]",
          message:
            "No effects in app code. Derive during render, handle it in the event, or subscribe with useSyncExternalStore.",
        },
      ],
    },
  },
  {
    files: ownCode,
    ignores: vendoredUi,
    plugins: { karma: { rules: { "no-comments": noComments } } },
    rules: { "karma/no-comments": "error" },
  },
  {
    files: ["src/components/ui/**/*.test.tsx"],
    plugins: { karma: { rules: { "no-comments": noComments } } },
    rules: { "karma/no-comments": "error" },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
);
