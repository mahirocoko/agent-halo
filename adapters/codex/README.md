# Agent Halo Codex Adapter

The Codex adapter translates command-based Codex lifecycle hooks into the shared Agent Halo event envelope and posts them to the local bridge at `127.0.0.1:47621`.

It covers session lifecycle, prompt turns, tool start/end, compaction, stop, and interrupt. The native desktop installer merges its entries into `~/.codex/hooks.json`, preserves existing hooks, and installs the shared utility beside the adapter.

Events use `sourceKind: "codexHost"` only when the adapter can resolve the long-lived Codex host process from its ancestry. Otherwise the event remains presence-compatible with `runtime: null`; it must never claim the short-lived hook runner as the agent process.
