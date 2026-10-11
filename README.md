# Built Signal development template

Astro static pages, strict TypeScript, Markdown collections, and vanilla CSS using
the approved Built Signal semantic tokens. All content is clearly labeled sample
Lorem Ipsum; the text wordmark is provisional. This is not a production launch.

Use the Node version in `.nvmrc` and the pinned npm version in `package.json`.

```sh
npm ci
npm run validate:tokens
npm run check
npm run build
npm run test:release
npx playwright install chromium
npm run test:browser
npm run validate:budget
```

`npm run dev` starts local development; `npm run preview` serves the built files.
No React, server adapter, database, tracking, or live lab connection is included.
`PUBLIC_NOINDEX` defaults to `true`; only an explicit `false` enables indexing.
Operational documentation and real inventory belong outside Git in
`~/Website-LocalDocs/`. Infrastructure examples contain no real inventory.
See `AGENTS.md` for contribution and review requirements.

Release safety tests use a simulated transport and do not certify live SSH,
HTTP/TLS, or a host rollback. CI deployment is intentionally disabled until
dedicated CI credentials, verified host keys, and the release branch are set.
