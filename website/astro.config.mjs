import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Delta-MCP",
      description:
        "Token-efficient MCP reimplementation. 89% fewer tokens on tool definitions.",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: false,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/norhther/delta-mcp",
        },
      ],
      sidebar: [
        { label: "Introduction", link: "/" },
        { label: "Getting Started", link: "/getting-started/" },
        {
          label: "How It Works",
          items: [
            {
              label: "Progressive Disclosure",
              link: "/how-it-works/progressive-disclosure/",
            },
            {
              label: "Result Handler",
              link: "/how-it-works/result-handler/",
            },
            {
              label: "Wire Encoding",
              link: "/how-it-works/wire-encoding/",
            },
            { label: "OAuth 2.1", link: "/how-it-works/oauth/" },
          ],
        },
        {
          label: "Examples",
          items: [
            { label: "Overview", link: "/examples/overview/" },
            { label: "stdio Server", link: "/examples/stdio-server/" },
            { label: "Client Usage", link: "/examples/client-usage/" },
            { label: "Result Handler", link: "/examples/result-handler/" },
            {
              label: "Filesystem Server",
              link: "/examples/filesystem-server/",
            },
            { label: "Pagination", link: "/examples/pagination/" },
            {
              label: "HTTP + OAuth Server",
              link: "/examples/http-oauth-server/",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI", link: "/reference/cli/" },
            { label: "Packages", link: "/reference/packages/" },
            { label: "Conformance", link: "/reference/conformance/" },
            { label: "Benchmarks", link: "/benchmarks/" },
            {
              label: "ADRs",
              items: [
                {
                  label: "ADR-001: No Fork JSON-RPC",
                  link: "/reference/adr/001-no-fork-jsonrpc/",
                },
                {
                  label: "ADR-002: Progressive Disclosure",
                  link: "/reference/adr/002-progressive-disclosure/",
                },
                {
                  label: "ADR-003: Version Skew",
                  link: "/reference/adr/003-version-skew/",
                },
              ],
            },
          ],
        },
      ],
      editLink: {
        baseUrl:
          "https://github.com/norhther/delta-mcp/edit/main/website/",
      },
      customCss: ["./src/styles/custom.css"],
    }),
  ],
  site: "https://norhther.github.io",
  base: "/delta-mcp",
});
