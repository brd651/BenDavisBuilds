# Built Signal homepage and shared footer

Approved owner brief, October 15, 2026. This page specification governs homepage presentation within the existing Built Signal identity; it does not replace the brand board or token system.

## Structure and copy

1. Hero: keep existing mountain artwork, responsive image variants, framing, headline “Systems for a more interesting tomorrow.” and general composition. Supporting line: “Leading teams, building things, and sharing what I learn.” Remove both hero buttons. The homepage has no development banner or sample labels; other pages retain truthful notices for their demonstration content.
2. 01 / Explore: “Different paths. The same curiosity.” Three editorial cards: Leadership, “Help people own the next decision.”; Homelab, “Build it. Break it. Understand it.”; Writing / Field Notes, “Write down what the work teaches you.” Describe coaching/trust/accountability/independent execution; practical networking/security/AI/automation experiments; engineering and leadership lessons respectively.
3. 02 / On the workbench: “What I'm working through.” Two prominent features with existing static illustrations: “Building an enterprise you can safely break.” describes the isolated, recoverable, repeatable lab direction; “Does it scale? The question behind the decision.” discusses customer needs, technical integrity, capacity and repeatability. Project and Leadership links accurately describe their destinations. Never label an unpublished article available.
4. 03 / Currently in motion: “What has my attention.” Approximately 60/40 progress/social columns on desktop, stacked on mobile. One public-safe current focus, verified milestone or next step. At most one explicitly curated LinkedIn post and one X post; actual profile links when excerpts/URLs are absent. No embeds, polling, live claims, infrastructure connections or operational exports.
5. 04 / The human side: “Curiosity doesn't switch off.” Short personal introduction about curiosity, practical learning and personal projects, alongside Currently Reading. No invented hobbies, accomplishments or books. Show a concise reading-list-in-progress message when no current book is selected.

Use deliberate whitespace, strong typography and restrained brass rules. Preserve navy/ivory, token colors, the geometric monogram and scarlet stripe. Reuse existing styles and illustrations; no new framework, dependency, dashboard treatment or animation.

## Content contracts

`src/data/homepage.ts` is the editable, build-time curated source. `src/lib/homepage-content.ts` validates it with the existing Astro Zod dependency. Page components do not need changes when curation changes.

- `labProgress` is optional: kind (`current-focus`, `verified-milestone`, `next-step`), title, description and optional ISO `reviewedAt`. Only claim a milestone when an approved source verifies it. Missing progress omits that feature and gives the profile column full width. Current copy is a next step, not a claim about deployed lab capability.
- `socialPosts` defaults to empty. Each entry requires platform, full HTTPS post URL on that network, and an approved excerpt (maximum 400 characters). One per network, maximum two. The existing owner-supplied profiles remain the fallback. Do not scrape, invent or auto-refresh social content.
- `reading.books` is a reusable curated array with unique IDs, title and author. Optional `cover` imports an Astro `ImageMetadata` asset plus meaningful alt text; optional takeaway; optional HTTPS purchase URL. `currentBookId` selects an existing entry. Additional entries can later support a mentee reading list; no list page is introduced now.
- Purchase links are optional. Full Amazon URLs are preferred; opaque amzn.to links are suppressed. Ordinary links have any Amazon `tag` removed. Affiliate links require explicit `amazonAffiliate: true`, a supported amazon.com host and valid configured `reading.amazonAssociateTag`. Missing configuration suppresses the affiliate link. No Associate ID is configured by this task. Render the Amazon Associate disclosure beside any active affiliate link and use `rel="sponsored noopener noreferrer"` with an accessible new-tab cue.

The accepted Lab route contains a clearly labeled simulation; the in-progress homelab article in a separate workspace is not published by this refresh. Homelab cards therefore link to the real Projects index as project direction. Selected social posts and current reading remain unconfigured until supplied by the owner. Do not silently publish concurrent drafts to fill those slots.

## Shared footer and privacy

Keep the existing compact BD identity, actual LinkedIn/GitHub/X profile destinations, Contact link, copyright, a native Privacy disclosure and existing Analytics preferences. Remove the duplicate archive/lab sitemap navigation, description and development/provisional copy. All icon-only links need accessible labels and 44px hit targets.

Analytics preferences are now inside the footer, with the same DOM IDs, settings, explanatory privacy text, default-off behavior, storage handling and DNT/GPC overrides. No instrumentation changes. Native disclosures work without JavaScript; collection remains off without JavaScript. Privacy stays available even when analytics are disabled for a build. Existing contact service and publishing architecture are outside this refresh.

## Validation and publication

Run strict Astro/TypeScript checks, production build, token and JavaScript budget validators, relevant content/unit/browser tests, independent review, and screenshots in both themes at mobile/tablet/desktop sizes. Verify defaults and missing curation, affiliate gating, keyboard navigation, consent opt-in/opt-out, responsive hero composition and absence of homepage/footer filler or dead links. Deployment requires owner authorization; subsequent owner instruction in this task explicitly authorizes production deployment. Keep versioned rollback releases and private validation records outside Git.
