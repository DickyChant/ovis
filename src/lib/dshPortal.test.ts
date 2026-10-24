import { expect, test } from "bun:test";
import { dshPortalTarget } from "./dshPortal.ts";

const app = { protocol: "http:", hostname: "127.0.0.1", origin: "http://127.0.0.1:7327" };
test("DSH uses an isolated port under the existing Ovis frame policy", () => {
  expect(dshPortalTarget("http://localhost:3080/", app)).toEqual({ url: "http://127.0.0.1:3080/", reason: null });
  for (const value of [null, "javascript:alert(1)", "http://u:p@127.0.0.1:3080/", "http://127.0.0.1:3080/?token=secret", "http://127.0.0.1:3080/path"]) expect(dshPortalTarget(value, app).reason).toBe("unavailable");
  expect(dshPortalTarget(app.origin, app).reason).toBe("host");
});
test("phones never get their own localhost or insecure embedded content", () => {
  const remote = { protocol: "https:", hostname: "host.example", origin: "https://host.example:7327" };
  expect(dshPortalTarget("http://127.0.0.1:3080/", remote).reason).toBe("remote");
  expect(dshPortalTarget("http://host.example:3080/", remote).reason).toBe("https");
  expect(dshPortalTarget("https://different.example/", remote).reason).toBe("host");
  expect(dshPortalTarget("https://host.example:3081/", remote).url).toBe("https://host.example:3081/");
});
