import type { VenueTypeKey } from "./domain/entities.js";
import type { PluginContext, PluginModule, VenueTypePlugin } from "./ports/plugins.js";

export interface VenueTypeRegistry {
  get(key: VenueTypeKey): VenueTypePlugin | null;
  getRequired(key: VenueTypeKey): VenueTypePlugin;
  all(): VenueTypePlugin[];
}

/**
 * Builds the registry from the modules that configuration enabled.
 *
 * Adding a venue type is: write a package, pass its module in here, add its key
 * to PLUGINS_ENABLED. Removing one is deleting the key. Neither touches the core.
 */
export function createRegistry(
  modules: PluginModule[],
  enabledKeys: string[],
  context: PluginContext,
  settingsFor: (key: VenueTypeKey) => Record<string, unknown> = () => ({}),
): VenueTypeRegistry {
  const wanted = new Set(enabledKeys.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const plugins = new Map<string, VenueTypePlugin>();

  for (const module of modules) {
    const key = module.key.toLowerCase();
    if (!wanted.has(key)) continue;
    plugins.set(key, module.create({ ...context, settings: settingsFor(module.key) }));
  }

  const missing = [...wanted].filter((k) => !plugins.has(k));
  if (missing.length > 0) {
    // Fail at boot, loudly. A venue type silently missing at runtime means a
    // customer standing at a door with a pass nobody can honour.
    throw new Error(
      `PLUGINS_ENABLED names venue types with no module registered: ${missing.join(", ")}. ` +
        `Available: ${modules.map((m) => m.key).join(", ") || "(none)"}.`,
    );
  }

  return {
    get: (key) => plugins.get(key.toLowerCase()) ?? null,
    getRequired(key) {
      const plugin = plugins.get(key.toLowerCase());
      if (!plugin) {
        throw new Error(
          `No venue-type plugin registered for "${key}". Enabled: ${[...plugins.keys()].join(", ")}.`,
        );
      }
      return plugin;
    },
    all: () => [...plugins.values()],
  };
}
