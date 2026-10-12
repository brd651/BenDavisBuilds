/** Public site identity and owner-supplied social destinations. */
export const siteIdentity = {
  name: 'Ben Davis Builds',
  description: 'Technical leadership, cybersecurity, and hands-on engineering.',
} as const;

export const socialProfiles = [
  { platform: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/brd651/' },
  { platform: 'github', label: 'GitHub', href: 'https://github.com/brd651' },
  { platform: 'x', label: 'X', href: 'https://x.com/BenDavis651' },
] as const;

export type SocialPlatform = typeof socialProfiles[number]['platform'];
