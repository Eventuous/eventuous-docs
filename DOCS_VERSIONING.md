# Docs Versioning & Authoring Guide

Use this guide when adding a docs version or promoting Preview to a stable release.

## Site Structure

The docs site supports two languages: .NET and Go, each with independent content.

```
src/content/docs/
├── index.mdx                    ← landing page (links to both .NET and Go)
├── dotnet/                      ← .NET current stable docs (v0.17)
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
├── dotnet-0.16/                 ← .NET archived v0.16
│   └── ... (same structure as dotnet/)
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

Managed by the local `starlight-topic-versions` plugin in `astro.config.mjs`.

- **`dotnet/`** is the current stable .NET version (shown by default).
- **`dotnet-0.16/`** and **`dotnet-0.15/`** are archived snapshots. Edit only to fix old docs.
- **`dotnet-next/`** starts from the current stable docs and tracks the next .NET release.
- **`go/`** is the current Go version. No archived Go versions yet.

Version sidebar configs live in `src/content/versions/`, with one JSON file per archived or preview version.

## Config in astro.config.mjs

```js
// The .NET topic's versions property in starlightTopicVersions(...)
versions: {
  current: { label: 'v0.17 (Stable)' },
  versions: [
    { slug: 'dotnet-0.16', label: 'v0.16' },
    { slug: 'dotnet-0.15', label: 'v0.15' },
    { slug: 'dotnet-next', label: 'Preview' },
  ],
},
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
| `dotnet/index.mdx` | `../../../assets/logo.png` |
| `dotnet-0.16/index.mdx` | `../../../assets/logo.png` |
| `dotnet-0.15/index.mdx` | `../../../assets/logo.png` |
| `dotnet-next/index.mdx` | `../../../assets/logo.png` |

### Markdown links (doc-tree-relative)

Internal doc links resolve relative to the file's URL path:
- Files within `dotnet/` link to other `dotnet/` pages using relative paths (e.g., `../persistence/event-store`)
- Files within `go/` link to other `go/` pages using relative paths
- Cross-language links should use absolute paths (e.g., `/go/intro/` from a .NET page)

## How to Release a New .NET Version

To promote `dotnet-next/` to a new stable version:

1. **Archive current `dotnet/`** — copy its complete tree, including images, into `dotnet-{old-version}/`. Create a matching sidebar config from the current sidebar structure, using slugs and directory names relative to the snapshot root.
2. **Replace `dotnet/` with `dotnet-next/`** — delete `dotnet/` content files, copy `dotnet-next/` to `dotnet/`.
3. **Check version-local links** — all .NET version directories have the same depth, so relative asset paths stay unchanged. Update absolute hero and docs links to stay within each version.
4. **Update `astro.config.mjs`** — change `current.label`, add archived version to `versions` array.
5. **Write release notes** — replace the promoted `whats-new.mdx` with notes scoped to the previous stable tag. Lead with breaking changes, their affected users, and concrete migration steps. Verify API names and defaults against the library source; Preview notes may include features already released in a patch.
6. **Reset Preview** — copy the completed stable docs back to `dotnet-next/`, then replace its `whats-new.mdx` with a placeholder for the following release. Keep the full content and sidebar so readers can compare individual pages with stable. The version selector preserves the current page when it exists in the selected version, otherwise it falls back to that version's introduction.
7. **Build and verify** — `pnpm test` builds the site and checks version navigation and version-local links. Check the rendered release notes and confirm the old stable content is preserved in the archive apart from version-local link corrections.

> Snapshot manually. The local plugin reads version directories and sidebar configs; it does not create snapshots.

## Adding New Doc Pages

- Add `.md` or `.mdx` files to the appropriate topic directory under `dotnet/` or `go/`.
- The sidebar auto-generates from directory contents. Use `sidebar.order` in frontmatter to control ordering.
- For new infrastructure providers (.NET), add to `dotnet/infra/` with a descriptive filename.
- For new infrastructure providers (Go), add to `go/infra/`.
- If adding pages to `dotnet-next/` for a future version, ensure relative paths are correct for that depth.

## URL Redirects

Old .NET URLs (e.g., `/intro/`, `/domain/aggregate/`) are redirected to `/dotnet/intro/`, `/dotnet/domain/aggregate/` etc. via `public/_redirects`. Add new redirects there when renaming or moving pages.
