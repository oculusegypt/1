---
name: Worklets on Expo web
description: Why the mobile app substitutes a web-specific Worklets platform checker in Metro.
---

On the Expo web preview, `react-native-worklets` can evaluate its platform-checker barrel before `RuntimeKind` is initialized. It caches `IS_WEB=false` and `SHOULD_BE_USE_WEB=false` even though the underlying React Native platform reports web, then Reanimated sends a native serializable object to the web-only `JSWorklets` module and crashes.

**Why:** The package versions were already aligned, but the browser still crashed until Metro substituted the checker module for web builds.

**How to apply:** Keep the Metro substitution restricted to the web platform. Re-check the browser-rendered app after Worklets or Reanimated upgrades before removing the compatibility module; native builds must continue using the package's own checker.
