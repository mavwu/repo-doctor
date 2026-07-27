import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Git process startup can be slow on Windows and under antivirus scanning.
    // Keep test files sequential so their temporary repositories do not compete.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 90_000
  }
});
