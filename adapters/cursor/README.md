# Agent Halo Cursor Adapter

The Cursor adapter translates command-based Cursor agent hooks into the shared Agent Halo event envelope and posts them to the local bridge at `127.0.0.1:47621`.

It covers session lifecycle, prompt turns, tool start/end, compaction, agent responses, and stop. The native desktop installer merges its entries into `~/.cursor/hooks.json`, preserves existing hooks, and installs the shared utility beside the adapter.

Events use `sourceKind: "cursorHost"` only when the adapter can resolve the long-lived Cursor host process from its ancestry. Otherwise the event remains presence-compatible with `runtime: null`; it must never claim the short-lived hook runner as the agent process.
