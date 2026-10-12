# Ben Davis Builds

**Technical leadership. Cybersecurity. Applied AI. Practical engineering.**

**Website:** [bendavisbuilds.com](https://bendavisbuilds.com)

Ben Davis Builds is my personal website, technical writing space, and engineering portfolio. It brings together lessons from sales engineering leadership, hands-on cybersecurity and AI experimentation, and a simple belief: staying curious and building things makes you a better technical leader.

The website is also a project in its own right—an opportunity to explore modern web development, accessibility, performance, and AI-assisted engineering while documenting what I learn.

## Explore

| Area | Focus |
| --- | --- |
| **Writing** | Sales engineering, leadership, cybersecurity, applied AI, and practical technical perspectives. |
| **Projects & Homelab** | Experiments in infrastructure, automation, security, and agentic systems. |
| **Technical Archive** | Earlier engineering articles and experiments, preserved with their historical context. |
| **Mentorship** | Guidance and resources for people growing in sales engineering, cybersecurity, and AI. |

## Built Signal

**Built Signal** is the visual identity behind the website: dark-mode-first, technically influenced, and deliberately understated.

The design combines deep navy, warm ivory, restrained Classic Ember and brass accents, and a narrow scarlet stripe referencing my Marine Corps background. A clean geometric BD monogram anchors the identity, while subtle technical diagrams and motion give the project areas a more exploratory feel.

The goal is a balance of executive clarity and engineering personality—not a corporate brochure or a movie-style hacking console.

## Technology

| Layer | Technology | Purpose |
| --- | --- | --- |
| Web framework | [Astro](https://astro.build/) | Fast, content-focused pages with static generation. |
| Language | TypeScript | Typed components, content models, and browser interactions. |
| Design system | HTML, CSS, and semantic tokens | Responsive layouts and consistent light/dark themes. |
| Content | Markdown and Astro content collections | Organized, versioned technical writing. |
| Interactive experiences | SVG, CSS, and selective React | Lightweight diagrams, animation, and richer project views where useful. |
| Web serving | Caddy on Ubuntu / Akamai Cloud | Lightweight HTTPS hosting. |
| Engineering workflow | GitHub and GitHub Actions | Source history, automated checks, and repeatable delivery. |

The guiding principle is **static-first, interactive where it adds value**: keep articles fast and readable while leaving room for more advanced technical experiences.

## What I'm exploring

Beyond the website itself, I'm interested in how technical teams work, how AI can support real engineering workflows, and how thoughtful automation can make systems easier to operate and recover. The projects and articles here are where I put those ideas to the test.

---

**Ben Davis Builds** · [bendavisbuilds.com](https://bendavisbuilds.com)


Markdown publishing uses `src/content/writing/`, `src/content/archive/`, and
`src/content/projects/`. Lowercase kebab-case `.md` or `.mdx` files create static
article routes automatically. Use the existing samples as frontmatter examples.
A genuine published entry requires `title`, `description`, `category`, and
`publishedAt: "YYYY-MM-DD"`; drafts may omit the date. `tags` is an array.
Archive entries also require `historical: true`. Demonstrations use `sample: true`
and do not invent publication dates. `draft: true` and future publication dates
exclude an entry from routes, listings, search, RSS, sitemap, and related posts.
Rebuild to publish a scheduled date; this static site has no scheduling service.

Run `npm run verify` before proposing publication. Content acceptance tests add
temporary fixtures in an isolated copy; they never add fixture articles to the
public source. Detailed authoring and deployment documentation remains local-only.
