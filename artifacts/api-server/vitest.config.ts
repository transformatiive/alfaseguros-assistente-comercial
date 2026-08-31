import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `@workspace/db` throws at import time without DATABASE_URL, which would
    // stop any test file that transitively imports a module touching the
    // database — even one only exercising pure logic in it. `pg` connects
    // lazily, so this placeholder never opens a socket; a test that did reach
    // the database would fail loudly against a host that does not exist,
    // which is exactly what should happen in a unit test.
    env: {
      DATABASE_URL: "postgres://vitest:vitest@127.0.0.1:1/vitest_never_connects",
    },
  },
});
