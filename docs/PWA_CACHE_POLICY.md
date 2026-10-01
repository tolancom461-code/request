# PWA Cache Policy

The client is **Online-First**. Workbox precaches only versioned static build artifacts and uses prompt-style safe update behavior. Application business requests remain network-only and are neither cached for replay nor placed into a Background Sync queue. The web shell exposes offline and reconnection foundation state; it does not queue request, approval, warehouse, or inventory mutations.

The PWA manifest, service worker, and update configuration are validated by `tests/pwa-i18n.test.ts`. Temporary technical icons are retained only for Phase 2A and do not represent final identity.
