import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk";
import { resolveConfig } from "./config";
import { registerZettelclawCli } from "./cli/commands";
import { registerExtractionHooks } from "./hooks/extraction";
import { registerHandoffHook } from "./hooks/handoff";
import { createWrappedMemoryGetTool } from "./tools/memory-get";
import { createWrappedMemorySearchTool } from "./tools/memory-search";

const zettelclawPlugin: OpenClawPluginDefinition = {
  id: "zettelclaw",
  name: "Zettelclaw",
  description: "Append-only event log memory system",
  kind: "memory",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig, api.config);

    registerZettelclawCli(api, config);

    api.registerTool(
      (ctx) => {
        const searchTool = createWrappedMemorySearchTool(api, ctx, config);
        const getTool = createWrappedMemoryGetTool(api, ctx, config);

        if (!searchTool || !getTool) {
          return null;
        }

        return [searchTool, getTool];
      },
      { names: ["memory_search", "memory_get"] },
    );

    registerHandoffHook(api, config);
    registerExtractionHooks(api, config);
  },
};

export default zettelclawPlugin;
