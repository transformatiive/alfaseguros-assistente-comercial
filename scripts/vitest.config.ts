import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The only tested thing here is the scheduling rule, which is pure. The
    // placeholder exists so that a script pulling in `@workspace/db` for its
    // types does not throw at import time; `pg` connects lazily, so nothing
    // opens a socket.
    env: {
      DATABASE_URL: "postgres://vitest:vitest@127.0.0.1:1/vitest_never_connects",
    },
  },
});
