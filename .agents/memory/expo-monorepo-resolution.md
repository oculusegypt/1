---
name: Expo monorepo resolution
description: Workspace-root package resolution constraints for the mobile artifact under pnpm's hoisted linker.
---

Keep Expo, Expo Router, and Vite available at the workspace root and aligned with their artifact versions. Under `nodeLinker: hoisted`, Expo CLI and Router Server code may resolve peer packages from the workspace root rather than the mobile artifact. Removing root Expo broke Metro config checks; omitting root Expo Router broke SDK 57 typed-route startup; omitting root Vite broke Tailwind's Vite integration.

**Why:** The workspace packages are hoisted across artifacts, and those toolchains resolve some peer dependencies from their own physical root location.

**How to apply:** When upgrading the mobile SDK, keep the root and mobile Expo/Router versions synchronized and keep root Vite aligned with the web artifact. Duplicate-path warnings from Expo Doctor can remain even when both copies resolve to the same version; verify actual runtime resolution before changing linker settings.
