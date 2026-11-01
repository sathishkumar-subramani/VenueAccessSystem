const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// Monorepo wiring. Metro does not follow pnpm's symlinked workspace packages
// unless it is told where the root is and where modules may live.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// pnpm stores real packages outside the project tree, so symlinks must resolve.
config.resolver.unstable_enableSymlinks = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
