/** Date-neutral progression from the owner-supplied About biography.
 * Labels describe scope, not unverified formal titles or employment durations.
 */
export interface CareerDetail {
  heading: string;
  body: string;
}
export interface CareerStage {
  id: string;
  organization: string;
  label: string;
  role: string;
  theme: string;
  summary: string;
  kind: 'service' | 'education' | 'company' | 'personal';
  logo?: { src: string; lightSrc?: string; width: number; height: number; displayWidth: number; surface?: 'paper' | 'navy' };
  expansion?: { label: string; sections: readonly CareerDetail[]; related?: { label: string; href: string } };
}

export const careerStages: readonly CareerStage[] = [
  {
    id: 'marine-corps', organization: 'United States Marine Corps', label: 'Marine Corps',
    role: 'Data Network Specialist', theme: 'Technical foundation', kind: 'service',
    summary: 'That mindset started in the Marine Corps, where I served as a Data Network Specialist. Working with networks, systems, and operational challenges gave me an early appreciation for how important reliable technology is, especially when people depend on it. It also gave me the habit of wanting to understand the full picture, not just the symptom in front of me.',
  },
  {
    id: 'education', organization: 'University of Advancing Technology', label: 'Education',
    role: 'Network Engineering + Security', theme: 'Expanded expertise', kind: 'education',
    logo: { src: '/about/organizations/uat.webp', width: 189, height: 240, displayWidth: 90 },
    summary: 'After the Marines, I studied Network Engineering and Network Security at the University of Advancing Technology in Arizona. From there, I moved into technical roles where I could keep learning by doing.',
  },
  {
    id: 'sonicwall', organization: 'SonicWall', label: 'SonicWall',
    role: 'Enterprise support + labs', theme: 'Technical depth', kind: 'company',
    logo: { src: '/about/organizations/sonicwall-legacy.png', width: 168, height: 51, displayWidth: 168, surface: 'paper' },
    summary: 'At SonicWall, I worked in enterprise technical support with a focus on firewalls and centralized management platforms.',
    expansion: {
      label: 'Reproducing failures in the lab',
      sections: [
        { heading: 'Make the problem reproducible', body: 'I also spent time helping develop and maintain a technical reproduction lab, where difficult problems could be recreated, tested, and understood.' },
        { heading: 'Test the assumptions', body: 'That experience sharpened my troubleshooting instincts and reinforced something that still matters to me today... real learning happens when you can see the system, test your assumptions, and work through the failure.' },
      ],
    },
  },
  {
    id: 'western-nrg', organization: 'Western NRG', label: 'Western NRG',
    role: 'Automation + operational improvement', theme: 'Systems thinking', kind: 'company',
    logo: { src: '/about/organizations/western-nrg.webp', width: 750, height: 251, displayWidth: 260, surface: 'navy' },
    summary: 'At Western NRG, I continued building on that foundation through automation and operational improvement. I became more focused on reducing repetitive work, improving efficiency, and designing solutions that did more than solve a problem once. I wanted to make solving the next problem easier too.',
  },
  {
    id: 'sophos', organization: 'Sophos', label: 'Sophos',
    role: 'Global Sales Engineering leadership', theme: 'People + scale', kind: 'company',
    logo: { src: '/about/organizations/sophos-legacy.svg', width: 1024, height: 180, displayWidth: 210, surface: 'paper' },
    summary: 'At Sophos, I moved deeper into sales engineering leadership, eventually working in a global leadership capacity.',
    expansion: {
      label: 'Coaching across regions and teams',
      sections: [
        { heading: 'People, consistency and scale', body: 'That experience helped me think beyond technical knowledge alone. It pushed me to focus on coaching, consistency, team development, and how to help engineers succeed across different regions, teams, and business needs.' },
        // General leadership practice from the approved philosophy; not an invented Sophos-specific event.
        { heading: 'The approach I carry forward', body: 'When someone is struggling, my starting point is Coach Up, Not Out. Someone saw potential in that person when they were hired. I want to understand what changed, invest in their development, set clear goals, and stand beside them while they work to improve.' },
        { heading: 'Development with honest feedback', body: "That doesn't mean avoiding difficult decisions. Expectations, role fit, and the impact on others matter. A fair chance to succeed must come with honest feedback and a reasonable timeframe." },
      ],
      related: { label: 'More on my approach to coaching', href: '/leadership/#coaching' },
    },
  },
  {
    id: 'palo-alto-networks', organization: 'Palo Alto Networks', label: 'Palo Alto Networks',
    role: 'Commercial SE leadership', theme: 'Business outcomes', kind: 'company',
    logo: { src: '/about/organizations/palo-alto-dark.svg', lightSrc: '/about/organizations/palo-alto-light.svg', width: 1123, height: 312, displayWidth: 230 },
    summary: 'At Palo Alto Networks, I continued that path in commercial sales engineering leadership.',
    expansion: {
      label: 'Developing teams and technical execution',
      sections: [
        { heading: 'Connect the work to customer outcomes', body: 'There, my focus included developing teams, improving technical execution, supporting commercial growth, and helping engineers connect complex technology to real customer outcomes.' },
        { heading: 'Create the conditions for strong engineering', body: 'That part of my career strengthened my belief that great technical leadership is not just about knowing the technology. It is about building confidence, setting direction, developing people, and creating an environment where strong technical work can thrive.' },
        // The source does not assign its anonymous SASE engagement to an employer; keep it a related general example.
      ],
      related: { label: 'A customer example from my leadership philosophy', href: '/leadership/#technical-integrity-and-business-outcomes' },
    },
  },
  {
    id: 'ben-davis-builds', organization: 'Ben Davis Builds', label: 'Ben Davis Builds',
    role: 'Engineering + mentorship + AI', theme: 'What comes next', kind: 'personal',
    summary: 'Ben Davis Builds is where I bring together leadership, hands on engineering, and ongoing experimentation. It is a place to share lessons from leading sales engineering teams, document technical projects, explore cybersecurity and AI, and create resources that help others grow. Some of that work is about systems and infrastructure. Some of it is about leadership and mentorship. Some of it is simply about following curiosity and seeing what can be learned by building.',
  },
];
