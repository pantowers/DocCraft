import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next*/**", ".nx*/**", ".nh*/**", ".*-build*/**", ".*-check*/**", "out/**", "build/**", "tmp/**", "tmp_*/**", "next-env.d.ts"]),
]);
