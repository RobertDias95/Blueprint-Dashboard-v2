import type { QueryClient } from '@tanstack/react-query';

// ===========================================================================
// ★★★ fix-595 §2.3 — READING `isMutating()` WITHOUT REQUIRING A PROVIDER
// ===========================================================================
//
// One of auto-reload's three "nothing unsaved" checks is *"no in-flight
// mutation"*, and the obvious way to ask is `useQueryClient()` inside
// `NewBuildNotice`.
//
// ★★★ THAT HOOK WOULD HAVE MADE THE RIBBON REQUIRE A PROVIDER, and four of
//     fix-424's tests mount it BARE on purpose — they are about its listeners,
//     not about data. Making them wrap it would be this ticket editing tests it
//     has no business touching, to satisfy a dependency it does not really have.
//
// ★★ AND IMPORTING `App.tsx`'s CLIENT DIRECTLY IS A CYCLE: `App` imports
//    `NewBuildNotice`. So the client registers itself here at start-up and this
//    module hands it back — the same shape the app already uses for other
//    module-level singletons.
//
// ★ `null` UNTIL REGISTERED, AND THAT IS A SAFE ANSWER. A component mounted
//   outside the app (a test, a harness) reads `null` and the caller treats it as
//   "nothing is mutating" — which is true, because there is no app around it to
//   be mutating anything.

let client: QueryClient | null = null;

/** Called once, from `App`, with the client the whole app uses. */
export function setAppQueryClient(next: QueryClient | null): void {
  client = next;
}

/** The app's query client, or `null` outside the app. */
export function appQueryClient(): QueryClient | null {
  return client;
}

/** Is any mutation in flight? ★ `false` when there is no app — see above. */
export function appIsMutating(): boolean {
  return (client?.isMutating() ?? 0) > 0;
}

/** ★ Tests only: module state outlives a single case. */
export function __resetAppQueryClient(): void {
  client = null;
}
