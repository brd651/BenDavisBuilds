import { homepageContentSchema } from '../lib/homepage-content';

/** Curated public copy only. No operational exports, telemetry, or automatic feeds. */
export const homepageContent = homepageContentSchema.parse({
  labProgress: {
    kind: 'next-step',
    title: 'Make the recovery path part of the experiment.',
    description: 'Document isolation boundaries and the rebuild process so cybersecurity experiments can be repeated safely. That is the next step for the public project notes.',
  },
  // Add only owner-selected post URLs and approved excerpts. Profiles are the fallback.
  socialPosts: [],
  // Import optional book covers from src/assets; currentBookId selects one curated entry.
  reading: { books: [] },
});
