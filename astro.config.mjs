import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightVersions from 'starlight-versions';
import starlightMermaid from '@pasqal-io/starlight-client-mermaid';

export default defineConfig({
  site: 'https://eventuous.dev',
  integrations: [
    starlight({
      title: 'Eventuous',
      logo: {
        src: './src/assets/logo.png',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/eventuous' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/ZrqM6vnnmf' },
      ],
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightVersions({
          current: { label: 'v0.16 (Stable)' },
          versions: [
            { slug: 'dotnet-0.15', label: 'v0.15' },
            { slug: 'dotnet-next', label: 'Preview' },
          ],
        }),
        starlightMermaid(),
      ],
      sidebar: [
        {
          label: '.NET',
          items: [
            { label: 'Introduction', slug: 'dotnet/intro' },
            { label: "What's New", slug: 'dotnet/whats-new' },
            { label: 'Prologue', autogenerate: { directory: 'dotnet/prologue' } },
            { label: 'Domain', autogenerate: { directory: 'dotnet/domain' } },
            { label: 'Persistence', autogenerate: { directory: 'dotnet/persistence' } },
            { label: 'Application', autogenerate: { directory: 'dotnet/application' } },
            { label: 'Subscriptions', autogenerate: { directory: 'dotnet/subscriptions' } },
            { label: 'Read Models', autogenerate: { directory: 'dotnet/read-models' } },
            { label: 'Producers', autogenerate: { directory: 'dotnet/producers' } },
            { label: 'Gateway', autogenerate: { directory: 'dotnet/gateway' } },
            { label: 'Diagnostics', autogenerate: { directory: 'dotnet/diagnostics' } },
            { label: 'Infrastructure', autogenerate: { directory: 'dotnet/infra' } },
            { label: 'FAQ', autogenerate: { directory: 'dotnet/faq' } },
          ],
        },
        {
          label: 'Go',
          items: [
            { label: 'Introduction', slug: 'go/intro' },
            { label: "What's New", slug: 'go/whats-new' },
            { label: 'Domain', autogenerate: { directory: 'go/domain' } },
            { label: 'Application', autogenerate: { directory: 'go/application' } },
            { label: 'Persistence', autogenerate: { directory: 'go/persistence' } },
            { label: 'Subscriptions', autogenerate: { directory: 'go/subscriptions' } },
            { label: 'Infrastructure', autogenerate: { directory: 'go/infra' } },
          ],
        },
      ],
      head: [
        {
          tag: 'link',
          attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/eventuous/eventuous-docs/edit/main/',
      },
    }),
  ],
});
