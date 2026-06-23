# claude-plugins

A [Claude Code](https://docs.claude.com/en/docs/claude-code) **plugin marketplace** — one
repository hosting many plugins (skills, agents, hooks, and MCP servers) for everyday
development workflows.

## Available plugins

| Plugin | What it gives you |
|---|---|
| [`base`](./base) | The opinionated dev-workflow baseline for every repo: feature speccing, bug reporting, team-based feature planning, a QA verification gate, issue-closing PR shipping, and a destructive-git + secrets-read safety net. |

More plugins (e.g. stack-specific `python` / `nextjs` layers) are planned and will be added under
their own subdirectories.

## Installing from this marketplace

Once plugins are published here, add the marketplace and install a plugin from any Claude
Code session:

```text
/plugin marketplace add brokdar/claude-plugins
/plugin install <plugin-name>@claude-plugins
```

Replace `brokdar/claude-plugins` with the actual GitHub `owner/repo` if it differs.

## Repository layout

Each plugin lives in its own top-level directory and is registered as an entry in the
`plugins` array of `.claude-plugin/marketplace.json`. Only `plugin.json` goes inside a plugin's
`.claude-plugin/`; component directories (`skills/`, `agents/`, `hooks/`, …) live at the plugin root.

## What a plugin can contain

Claude Code plugins may bundle the following components. Component directories live at the
**plugin root** — only `plugin.json` goes inside `.claude-plugin/`.

| Component | Location | Purpose |
|---|---|---|
| Skills | `skills/<name>/SKILL.md` | Slash commands / model-invoked capabilities (namespaced as `/<plugin>:<skill>`) |
| Agents | `agents/<name>.md` | Subagents available via `/agents` |
| Hooks | `hooks/hooks.json` | Lifecycle hooks (PreToolUse, Stop, etc.) |
| MCP servers | `.mcp.json` | Bundled MCP server definitions |
| Commands | `commands/<name>.md` | Custom slash commands |

Inside hook commands and configs, use the path variables `${CLAUDE_PLUGIN_ROOT}` (the
plugin's own files) and `${CLAUDE_PROJECT_DIR}` (the target repository) rather than absolute
paths.

## Adding a plugin

1. Create a top-level directory `<plugin-name>/` with a `.claude-plugin/plugin.json`.
2. Add the component directories (`skills/`, `agents/`, `hooks/`, …) at the plugin root.
3. Register the plugin in `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "<plugin-name>",
     "source": "./<plugin-name>",
     "description": "What this plugin does."
   }
   ```

4. Validate before publishing:

   ```text
   claude plugin validate ./<plugin-name>
   ```

5. Test it locally without the marketplace:

   ```text
   claude --plugin-dir ./<plugin-name>
   ```

## License

Licensed under the MIT License — see [LICENSE](./LICENSE).
