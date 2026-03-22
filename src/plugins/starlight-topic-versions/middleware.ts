import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
// @ts-ignore - virtual module
import topicsConfig from 'virtual:starlight-topic-versions/config';
import type { RuntimeTopicConfig } from './index';

type SidebarEntry =
  | { type: 'link'; label: string; href: string; isCurrent: boolean; attrs: Record<string, string> }
  | { type: 'group'; label: string; entries: SidebarEntry[]; collapsed: boolean };

interface TopicVersionsRouteData {
  currentTopic: { id: string; label: string; link: string } | null;
  currentVersion: { slug: string; label: string; isCurrent: boolean } | null;
  topics: Array<{ id: string; label: string; link: string; icon?: string; isCurrent: boolean }>;
}

function hasCurrentEntry(entries: SidebarEntry[]): boolean {
  for (const entry of entries) {
    if (entry.type === 'link' && entry.isCurrent) return true;
    if (entry.type === 'group' && hasCurrentEntry(entry.entries)) return true;
  }
  return false;
}

function getFirstLinkSlug(entries: SidebarEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type === 'link') return stripSlashes(entry.href);
    if (entry.type === 'group') {
      const found = getFirstLinkSlug(entry.entries);
      if (found) return found;
    }
  }
  return null;
}

function getLastLinkSlug(entries: SidebarEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === 'link') return stripSlashes(entry.href);
    if (entry.type === 'group') {
      const found = getLastLinkSlug(entry.entries);
      if (found) return found;
    }
  }
  return null;
}

function stripSlashes(str: string): string {
  return str.replace(/^\/|\/$/g, '');
}

export const onRequest = defineRouteMiddleware((context) => {
  const { starlightRoute } = context.locals;
  const { sidebar, hasSidebar, id, pagination } = starlightRoute;

  const config = topicsConfig as RuntimeTopicConfig[];

  const emptyRouteData: TopicVersionsRouteData = {
    currentTopic: null,
    currentVersion: null,
    topics: config.map((t) => ({ id: t.id, label: t.label, link: t.link, icon: t.icon, isCurrent: false })),
  };

  if (!hasSidebar) {
    (context.locals as any).starlightTopicVersions = emptyRouteData;
    return;
  }

  // Search the sidebar tree for the current page.
  // Structure: sidebar[topicIndex].entries[versionIndex].entries[...actual items...]
  let foundTopicIndex = -1;
  let foundVersionIndex = -1;

  for (let ti = 0; ti < sidebar.length; ti++) {
    const topicGroup = sidebar[ti]!;
    if (topicGroup.type !== 'group') continue;

    for (let vi = 0; vi < topicGroup.entries.length; vi++) {
      const versionGroup = topicGroup.entries[vi]!;
      if (versionGroup.type !== 'group') continue;

      if (hasCurrentEntry(versionGroup.entries)) {
        foundTopicIndex = ti;
        foundVersionIndex = vi;
        break;
      }
    }
    if (foundTopicIndex >= 0) break;
  }

  if (foundTopicIndex < 0) {
    (context.locals as any).starlightTopicVersions = emptyRouteData;
    return;
  }

  const topicConfig = config[foundTopicIndex]!;
  const topicGroup = sidebar[foundTopicIndex]! as SidebarEntry & { type: 'group' };
  const versionGroup = topicGroup.entries[foundVersionIndex]! as SidebarEntry & { type: 'group' };

  // Determine version info from the group label (__v:__current__ or __v:slug)
  const versionLabel = versionGroup.label;
  const isCurrentVersion = versionLabel === '__v:__current__';
  const versionSlug = isCurrentVersion ? topicConfig.id : versionLabel.replace('__v:', '');

  // Replace the sidebar with just the current version's entries
  starlightRoute.sidebar = versionGroup.entries;

  // Fix pagination at version boundaries
  const strippedId = stripSlashes(id);
  const firstSlug = getFirstLinkSlug(versionGroup.entries);
  const lastSlug = getLastLinkSlug(versionGroup.entries);

  if (firstSlug && strippedId === firstSlug) {
    pagination.prev = undefined;
  }
  if (lastSlug && strippedId === lastSlug) {
    pagination.next = undefined;
  }

  // Build version label
  let currentVersionLabel: string;
  if (isCurrentVersion) {
    currentVersionLabel = topicConfig.versions?.current?.label ?? 'Latest';
  } else {
    const found = topicConfig.versions?.versions?.find((v) => v.slug === versionSlug);
    currentVersionLabel = found?.label ?? versionSlug;
  }

  const routeData: TopicVersionsRouteData = {
    currentTopic: {
      id: topicConfig.id,
      label: topicConfig.label,
      link: topicConfig.link,
    },
    currentVersion: {
      slug: versionSlug,
      label: currentVersionLabel,
      isCurrent: isCurrentVersion,
    },
    topics: config.map((t) => ({
      id: t.id,
      label: t.label,
      link: t.link,
      icon: t.icon,
      isCurrent: t.id === topicConfig.id,
    })),
  };

  (context.locals as any).starlightTopicVersions = routeData;
});
