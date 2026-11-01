/*
  TypeScript will not stop anyone importing mongoose inside the core package,
  the way the .NET compiler stopped it. This file does that job instead, and it
  runs in CI. Without it the plug-and-play structure quietly dissolves over a
  few months of "just this once".
*/
module.exports = {
  forbidden: [
    {
      name: "core-stays-pure",
      comment:
        "packages/core holds rules only. No database, no HTTP, no framework. " +
        "If core needs something from outside, add a port and let an adapter implement it.",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: {
        path: "node_modules",
        pathNot:
          "node_modules/(typescript|@types|zod)(/|$)",
      },
    },
    {
      name: "plugins-depend-on-core-only",
      comment:
        "A venue-type plugin may use the core's ports and nothing else. " +
        "A plugin that reaches for mongoose is no longer swappable.",
      severity: "error",
      from: { path: "^packages/plugin-[^/]+/src" },
      to: {
        path: "node_modules",
        pathNot: "node_modules/(typescript|@types|zod)(/|$)",
      },
    },
    {
      name: "core-never-imports-apps",
      comment: "Dependencies point inward. Core never knows an app exists.",
      severity: "error",
      from: { path: "^packages/(core|plugin-[^/]+)/src" },
      to: { path: "^apps" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    exclude: { path: "(dist|/test/|\\.test\\.ts$|vitest\\.config\\.ts$)" },
  },
};
