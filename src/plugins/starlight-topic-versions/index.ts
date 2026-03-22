import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { StarlightPlugin } from '@astrojs/starlight/types';

export interface TopicVersion {
  slug: string;
  label?: string;
}

export interface TopicVersionsConfig {
  current: { label: string };
  versions: TopicVersion[];
}

export interface TopicConfig {
  label: string;
  link: string;
  id: string;
  icon?: string;
  items: any[];
  versions?: TopicVersionsConfig;
}

export interface RuntimeTopicConfig {
  label: string;
  link: string;
  id: string;
  icon?: string;
  versions: TopicVersionsConfig | null;
}

function addPrefixToSidebarItems(items: any[], prefix: string): any[] {
  return items.map((item) => {
    if (typeof item === 'string') {
      return `${prefix}/${item}`;
    }
    if ('slug' in item && typeof item.slug === 'string') {
      return { ...item, slug: `${prefix}/${item.slug}` };
    }
    if ('autogenerate' in item) {
      return {
        ...item,
        autogenerate: {
          ...item.autogenerate,
          directory: `${prefix}/${item.autogenerate.directory}`,
        },
      };
    }
    if ('items' in item && Array.isArray(item.items)) {
      return { ...item, items: addPrefixToSidebarItems(item.items, prefix) };
    }
    return item;
  });
}

async function readVersionSidebar(slug: string, srcDir: URL): Promise<any[]> {
  const filePath = fileURLToPath(new URL(`content/versions/${slug}.json`, srcDir));
  try {
    const content = await readFile(filePath, 'utf-8');
    const config = JSON.parse(content);
    return config.sidebar ?? [];
  } catch {
    return [];
  }
}

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default function starlightTopicVersions(topics: TopicConfig[]): StarlightPlugin {
  return {
    name: 'starlight-topic-versions',
    hooks: {
      'config:setup': async ({
        config: starlightConfig,
        updateConfig,
        addRouteMiddleware,
        addIntegration,
        astroConfig,
      }) => {
        if (starlightConfig.sidebar) {
          throw new Error(
            'starlight-topic-versions: Remove the `sidebar` from your Starlight config. Topics define their own sidebars.',
          );
        }

        const sidebar: any[] = [];
        const runtimeConfig: RuntimeTopicConfig[] = [];

        for (const topic of topics) {
          const topicItems: any[] = [];

          // Current version items
          topicItems.push({
            label: `__v:__current__`,
            items: topic.items,
          });

          // Archived version items
          if (topic.versions) {
            for (const version of topic.versions.versions) {
              const versionSidebar = await readVersionSidebar(version.slug, astroConfig.srcDir);
              const prefixedItems = addPrefixToSidebarItems(versionSidebar, version.slug);
              topicItems.push({
                label: `__v:${version.slug}`,
                items: prefixedItems,
              });
            }
          }

          sidebar.push({
            label: `__t:${topic.id}`,
            items: topicItems,
          });

          runtimeConfig.push({
            label: topic.label,
            link: topic.link,
            id: topic.id,
            icon: topic.icon,
            versions: topic.versions ?? null,
          });
        }

        addRouteMiddleware({
          entrypoint: resolve('./middleware.ts'),
          order: 'pre',
        });

        updateConfig({
          sidebar,
          components: {
            ...(starlightConfig.components ?? {}),
            Sidebar: resolve('./overrides/Sidebar.astro'),
            ThemeSelect: resolve('./overrides/ThemeSelect.astro'),
          },
        });

        addIntegration({
          name: 'starlight-topic-versions-vite',
          hooks: {
            'astro:config:setup': ({ updateConfig: astroUpdateConfig }) => {
              astroUpdateConfig({
                vite: {
                  plugins: [createVitePlugin(runtimeConfig)],
                },
              });
            },
          },
        });
      },
    },
  };
}

function createVitePlugin(config: RuntimeTopicConfig[]) {
  const moduleId = 'virtual:starlight-topic-versions/config';
  const resolvedId = '\0' + moduleId;

  return {
    name: 'vite-plugin-starlight-topic-versions',
    resolveId(id: string) {
      if (id === moduleId) return resolvedId;
    },
    load(id: string) {
      if (id === resolvedId) {
        return `export default ${JSON.stringify(config)}`;
      }
    },
  };
}
