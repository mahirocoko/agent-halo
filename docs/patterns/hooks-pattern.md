# Hooks Pattern

## Current Reality

Hooks are established as behavior and feature orchestration boundaries, not as a generic data-fetching layer. Examples include presence, runtime monitoring, Pomodoro, Stopwatch, Usage, and resizable card layout hooks.

## Organization

1. imports
2. hook options/return contracts
3. hook function
4. refs and state
5. derived values
6. callbacks and effects
7. returned API

Use comments only when they make a long hook easier to scan. Keep a hook focused on one behavior boundary.

## Behavior-First Example

```ts
export const useDisclosure = (initialOpen = false) => {
  const [isOpen, setIsOpen] = useState(initialOpen)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return { isOpen, open, close }
}
```

## Effect and Persistence Rules

- Audit dependencies against every captured value; do not silence the rule as a formatting fix.
- Keep refs for mutable runtime identity that should not trigger render loops.
- Make persistence reads/writes/reset behavior explicit and resilient when localStorage/native storage is unavailable.
- Keep browser-only helpers out of native/server-oriented modules when a route or hook may evaluate them in the browser.

## Data Hooks

No TanStack Query/SWR data-hook layer is established. Hooks may orchestrate local bridge/provider refreshes when that is already the feature owner, but do not invent a generic query service for one surface.

## Preferred Direction

Use a hook when it creates a reusable behavior boundary across real consumers. Keep a one-consumer state machine local until reuse or ownership pressure proves the extraction.
