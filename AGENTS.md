# AGENTS.md — Ben Davis Builds

This file governs coding agents working in the **Ben Davis Builds** website repository. Follow it on every task. Keep implementation practical, fast, testable, and documented. Do not add tools, frameworks, services, or process overhead without a concrete requirement.

## Current development milestone authorization

The owner authorizes routine tool installation, configuration, tests, commits,
pushes, and deployment of the initial **DEVELOPMENT** static template to the
existing VPS without another approval request. Content is clearly labeled sample
Lorem Ipsum; this is not a production launch. This narrow authorization overrides
older development dependency/deployment approval gates and the CI-only initial
deployment requirement. Build locally first; do not compile on the VPS.

Independent review remains required before significant commits, server changes,
and deployment. Final logo approval, credentials, destructive actions, DNS,
unrelated services, cloud resources, and recurring costs retain their safeguards.
Do not expand Codex sudo privileges or change tool permission settings. Network
hardening is out of scope; preserve existing SSH and recovery access.

Operational documentation, inventories, host variables, logs, reports, screenshots,
and private backups belong exclusively in `~/Website-LocalDocs/`, outside Git.
Never symlink that directory into the repository, publish it, or relocate its
contents into Git when access is blocked. Public source contains only application
code, approved assets/tokens, tests, sanitized infrastructure/workflows, and
minimal contributor instructions. Record blocked operations honestly and
continue independent work.

## 1. Project and authority

- Production domain: `bendavisbuilds.com` (canonical); `www` redirects to apex when DNS/HTTPS is ready.
- Public GitHub repository: authoritative source for application, approved public assets/content, tests, and sanitized deployment definitions. Operational documentation is local-only. Determine its actual remote; **never invent a repository URL**.
- Development workspace: **WSL Ubuntu `~/Website`**. Git commits, development, builds, and tests happen here or in GitHub Actions.
- Hosting: existing **Akamai/Linode Ubuntu VPS**, accessed as the limited deployment account over verified SSH; actual inventory is local-only. Do not create another server. The VPS serves **versioned compiled static artifacts**, not the source development environment.
- Repository is **PUBLIC**. Treat everything staged for commit as internet-visible.

Read existing files and current live state before acting. A command or file mentioned here describes intent, not proof that it currently exists.

### Design authority (highest first)
1. Explicit newer owner decisions and security requirements.
2. `built_signal_v1/reference/APPROVED_Built_Signal_Board.png` (or the same file under its discovered extracted-kit path): **sole approved visual reference**.
3. `built_signal_v1/BUILT_SIGNAL_BUILD_SPEC_v1.0.md` and `built_signal_v1/agents/AGENTS_BRAND_ADDENDUM.md`.
4. `built_signal_v1/design/built-signal.tokens.json` and `.css` for semantic theme colors.
5. Other current ADRs, runbooks, and code.

Locate the extracted kit in `~/Website`; do not assume it is at repo root. Older concepts and generated renders are NOT replacements for the approved image. If documents conflict, flag the conflict instead of silently selecting an alternate design.

## 2. Locked brand rules

- Brand: **Ben Davis / Ben Davis Builds**; visual identity: **Built Signal**.
- **Dark mode default on first visit**; support explicit Light and System modes, persist selection, and follow system changes while System is selected.
- Light mode uses warm ivory, not stark white. Both modes must be equally legible and polished.
- Approved BD mark: **clean geometric monogram plus one narrow vertical scarlet blood-stripe-inspired element**. **Never add a signal wire, circuitry, traces, nodes, sparks, or dots inside the logo or favicon.** The phrase “Built Signal” is not authorization to change the symbol.
- Treat the approved image as a *visual reference*, not editable vector geometry. Reconstruct SVG variants from consistent geometry; show dark/light, full-size, and 16/32px proofs. **Owner must approve before calling the SVG/favicon final or using it as a finalized production asset.**
- Use semantic design tokens, not scattered hard-coded hex values. Navy and ivory dominate; brass, Classic Ember, and scarlet are restrained accents. Scarlet conveys heritage, not error/status meaning.
- Mood: credible to leaders and experienced technologists; human, curious, lightly cyber-tech, never faux-hacker or aggressively military. More technical UI treatment is permitted on the Lab/Projects pages, not across general reading pages.
- Current marketing tagline remains **provisional**; do not bake it into the logo or claim it was approved.
- Do not fabricate credentials, accomplishments, metrics, article publication, system status, or live lab data. Label placeholders and demos clearly.

## 3. Technical architecture

- **Astro + strict TypeScript**, static output by default.
- Use React **only for components that need client-side interaction**; choose minimal hydration strategy and avoid shipping React on text-only routes.
- Markdown/MDX content with validated metadata for Writing, Projects, and historical Archive; preserve original publication dates and label obsolete guidance as historical.
- Prefer semantic HTML, native CSS and approved tokens. Use SVG/CSS for lightweight diagrams and animation; pre-render documentation diagrams when practical. Lazy-load heavier interactive experiences.
- No Docker, Kubernetes, database, Redis, persistent Node.js server, or multi-service architecture for Alpha without owner approval.
- No privileged/live connection from the public site to the private homelab. Public Lab content uses reviewed exports, documented snapshots, or clearly labeled simulations.
- Future Go/Python services are separate design decisions; don't introduce them proactively.

## 4. Performance, accessibility, and security

- Favor pre-rendered pages, optimized images, caching and compression. Avoid unnecessary JS, heavy dependencies, tracking scripts, and render-blocking assets.
- Initial targets: **95+ Lighthouse mobile** under documented conditions; aim for **0–15 KB compressed page-specific JS** on static article routes. Measure rather than claiming these are met.
- Core Web Vitals good thresholds: **LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1** at the 75th percentile in real-world data. Record synthetic test conditions separately.
- Aim for **WCAG 2.2 AA**: normal text contrast >= 4.5:1, necessary graphic/control boundaries >= 3:1, keyboard operation and visible focus, semantic labels, responsive text, and meaningful cues beyond color.
- Respect `prefers-reduced-motion`; continuous animations require usable controls and static fallbacks. Don't animate content that impedes reading.
- Escape/sanitize imported or user-controlled content. Do not trust WordPress export HTML directly. Avoid exposing server paths, internal IP layouts, secrets, or personal data in published examples.

## 5. Development and deployment

1. Inspect repository (`git status`, branch, remotes), existing docs and relevant tests before editing. Never overwrite or force-push existing history.
2. Make focused changes on a feature branch. Keep commits scoped and meaningful; use an agent-specific Git identity rather than impersonating the owner.
3. Before each significant change, identify its authoritative source (app code, brand tokens, Ansible, CI configuration) and edit that source rather than patching deployed copies.
4. Run relevant checks: typecheck, tests, Astro production build, approved token validator, and accessibility/performance checks applicable to changed pages. Record commands and pass/fail honestly.
5. **Independent review** (separate reviewer/agent, Codex/Claude where available) before significant merge or deploy. Owner approval is required for finalized logo, production release, DNS/firewall/SSH changes, credentials, destructive actions, or unapproved recurring costs.
6. GitHub Actions builds static output. Once approved, deploy versioned artifacts via restricted SSH to the existing VPS, switch `current` atomically, health-check HTTPS, and retain a rollback target. Never use the VPS as the normal editing/build environment.
7. Ubuntu provisioning/configuration must be represented in version-controlled Ansible or documented IaC. Direct changes are bootstrap/recovery exceptions and must be reconciled back to the authoritative configuration.

### Public repository hygiene

- Never commit private SSH keys, GitHub tokens, Linode API tokens, `.env` secrets, credentials, raw WordPress SQL database exports, unredacted logs, or personal information.
- Use `.gitignore`, secret scanning and staged diff review. GitHub backup covers **versioned repository content**, not database/operational state or VPS snapshots.
- Git write authentication stays on WSL, not the production VPS. Production needs only a limited deploy identity receiving artifacts. Do not install GitHub personal account credentials or a self-hosted GitHub Actions runner on the public VPS.
- Preserve Google Workspace mail records; no MX/SPF/DKIM/DMARC edits unless separately approved.
- Preserve existing verified SSH access and break-glass recovery. Review all firewall changes before applying.

## 6. Agent communication and learning

- Execute clear, safe, authorized tasks without lengthy roleplay or generic introductions. Ask only for real blockers or approval gates.
- For nontrivial work, provide a brief plan, then implement; do not stop after a plan unless approval is required.
- On completion, summarize **changed files, commands/tests/results, deployment state, risks, and the next concrete step**.
- Add short decision records when introducing meaningful architecture or dependency choices. For educational value, explain one or two important TypeScript/Astro/React concepts used; do not turn every task into a tutorial.
- Never report a simulated page, placeholder, or green check from a mockup as verified production functionality.

## 7. Initial milestones

1. Reconcile extracted Built Signal kit, root instructions, repository and Git remote.
2. Scaffold minimal Astro static application, brand tokens, dark/light/system handling, layouts and routes.
3. Produce un-wired BD logo proofs for owner approval; use an explicitly provisional placeholder if approval is pending.
4. Provision **existing** VPS website serving through Caddy, HTTPS, versioned releases and Ansible; preserve email DNS.
5. Establish reviewed GitHub Actions build and SSH deployment.
6. Publish only after test, review, and owner approval; build out Writing, Mentorship, Projects and Lab incrementally.
