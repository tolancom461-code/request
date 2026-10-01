# Phase 2A — PWA Policy

The React/Vite application is an **Online-First technical shell**. `vite-plugin-pwa` produces a manifest and service worker with a prompt-based update flow. Static application assets are precached; runtime API caching is deliberately empty.

| Requirement | Implemented behavior |
|---|---|
| Application updates | User sees an update notice and explicitly chooses reload |
| Active work safety | No automatic reload is issued by the application |
| Business data | `Network Only`; browser fetch uses `cache: no-store` |
| Offline mutation queue | Not implemented |
| Offline business transactions | Not implemented |
| Connectivity display | `online` / `offline` browser events shown in the shell |
| Service worker scope | Root scope with `start_url: /` |
| Temporary assets | One deliberately marked technical SVG icon; not a final brand deliverable |

No requisition, purchase, inventory, warehouse, or other Phase 2B business UI has been added to the PWA shell.
