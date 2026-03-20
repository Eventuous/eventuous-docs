# Docs Versioning & Authoring Guide

This file is for Claude Code. It documents how the Eventuous docs site versioning works so docs can be updated correctly.

## Site Structure

The docs site supports two languages: .NET and Go, each with independent content.

```
src/content/docs/
├── index.mdx                    ← landing page (links to both .NET and Go)
├── dotnet/                      ← .NET current stable docs (v0.16)
│   ├── intro.mdx
│   ├── whats-new.mdx
│   ├── domain/
│   ├── persistence/
│   ├── application/
│   ├── subscriptions/
│   ├── read-models/
│   ├── producers/
│   ├── gateway/
│   ├── diagnostics/
│   ├── infra/
│   ├── faq/
│   └── prologue/
├── dotnet-0.15/                 ← .NET archived v0.15
│   └── ... (same structure as dotnet/)
├── dotnet-next/                 ← .NET preview
│   └── ... (same structure as dotnet/)
├── go/                          ← Go current docs (v0.1)
│   ├── intro.md
│   ├── whats-new.md
│   ├── domain/
│   ├── application/
│   ├── persistence/
│   ├── subscriptions/
│   └── infra/
```

## Version Structure

Managed by the `starlight-versions` plugin in `astro.config.mjs`.

- **`dotnet/`** is the current stable .NET version (shown by default).
- **`dotnet-0.15/`** is the archived v0.15 snapshot. Don't edit unless fixing a bug in old docs.
- **`dotnet-next/`** is a preview placeholder for the next .NET version.
- **`go/`** is the current Go version. No archived Go versions yet.

Version configs live in `src/content/versions/`:
- `dotnet-0.15.json` — sidebar config for archived v0.15
- `dotnet-next.json` — sidebar config for preview

## Config in astro.config.mjs

```js
starlightVersions({
  current: { label: 'v0.16 (Stable)' },
  versions: [
    { slug: 'dotnet-0.15', label: 'v0.15' },
    { slug: 'dotnet-next', label: 'Preview' },
  ],
}),
```

Each entry in `versions` must have a matching directory under `src/content/docs/{slug}/` and a sidebar config at `src/content/versions/{slug}.json`.

## Sidebar

The sidebar is organized into two top-level sections: **.NET** and **Go**. Each section uses `autogenerate` for topic directories and explicit `slug` entries for standalone pages.

## Relative Path Rules

Component imports use the `@components/` alias (defined in `tsconfig.json`), so they are path-independent and don't need adjustment when files move.

### Hero image (index.mdx)

| File location | Image path to `src/assets/logo.png` |
|---|---|
| Root `index.mdx` | `../../assets/logo.png` |
| `dotnet-0.15/index.mdx` | `../../../assets/logo.png` |
| `dotnet-next/index.mdx` | `../../../assets/logo.png` |

### Markdown links (doc-tree-relative)

Internal doc links resolve relative to the file's URL path:
- Files within `dotnet/` link to other `dotnet/` pages using relative paths (e.g., `../persistence/event-store`)
- Files within `go/` link to other `go/` pages using relative paths
- Cross-language links should use absolute paths (e.g., `/go/intro/` from a .NET page)

## How to Release a New .NET Version

To promote `dotnet-next/` to a new stable version (e.g. v0.17):

1. **Archive current `dotnet/`** — copy `dotnet/` content into a new directory (e.g. `dotnet-0.16/`). Create a matching `src/content/versions/dotnet-0.16.json` sidebar config.
2. **Replace `dotnet/` with `dotnet-next/`** — delete `dotnet/` content files, copy `dotnet-next/` to `dotnet/`.
3. **Fix relative paths** — adjust hero image paths if needed (versioned dirs are one level deeper than `dotnet/`).
4. **Update `astro.config.mjs`** — change `current.label`, add archived version to `versions` array.
5. **Reset `dotnet-next/`** — delete all content, create a single `whats-new.mdx` placeholder. Update `dotnet-next.json` sidebar.
6. **Build and verify** — `pnpm build` must pass.

> **Do not** rely on the plugin's auto-snapshot feature (`ensureNewVersion`). It fails on MDX files with complex Astro expressions. Always snapshot manually.

## Adding New Doc Pages

- Add `.md` or `.mdx` files to the appropriate topic directory under `dotnet/` or `go/`.
- The sidebar auto-generates from directory contents. Use `sidebar.order` in frontmatter to control ordering.
- For new infrastructure providers (.NET), add to `dotnet/infra/` with a descriptive filename.
- For new infrastructure providers (Go), add to `go/infra/`.
- If adding pages to `dotnet-next/` for a future version, ensure relative paths are correct for that depth.

## URL Redirects

Old .NET URLs (e.g., `/intro/`, `/domain/aggregate/`) are redirected to `/dotnet/intro/`, `/dotnet/domain/aggregate/` etc. via `public/_redirects`. Add new redirects there when renaming or moving pages.
