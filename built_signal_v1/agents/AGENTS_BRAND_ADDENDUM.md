# Built Signal — AGENTS.md Addendum

Before implementing brand or UI, read `BUILT_SIGNAL_BUILD_SPEC_v1.0.md` and inspect `reference/APPROVED_Built_Signal_Board.png`.

## Authority and non-negotiables

- Brand is **Built Signal** for **Ben Davis / Ben Davis Builds**, `bendavisbuilds.com`.
- Use the exact approved board as **visual source of truth**. Do not substitute previous Dress Blues & Brass prototypes or the later wired-logo render.
- Approved logo is the **clean geometric ivory/navy BD-style monogram with one adjacent vertical scarlet stripe**. **NO internal signal wire, circuit trace, nodes, sparks, orange dot or brass line** in the logo/favicons.
- Keep dark mode **default** with an equally accessible warm-ivory light mode and explicit System override.
- Follow `design/built-signal.tokens.json` for semantic colors and generated CSS for deployment. Navy, slate, ivory dominate; brass/scarlet accents restrained; orange `#E87722` is legacy optional secondary only, not part of the logo.
- Production wordmark / favicon SVG requires owner review. Do not claim concept artwork is an approved vector.
- Prefer accessible static Astro pages and selective React for interactive Lab. Avoid shipping dashboard React to articles.
- Stay within performance budgets, validate WCAG 2.2 AA criteria in context, and provide static diagrams and reduced-motion fallbacks.
- Content or imagery must not fabricate facts, personal experiences, or live lab data. Public Lab read-only, no privileged homelab access.
- GitHub is source authority for content/code/IaC. IaC changes via reviewed OpenTofu/Terraform; OS changes via Ansible; deploy via GitHub Actions with independent validation and owner approval.

Stop and request approval for logo geometry changes, new dependencies, new colors/brand motifs, public control plane access, or any fundamental architecture deviation.
