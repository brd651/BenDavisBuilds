/** Date-neutral progression from the owner-supplied About handoff, October 2026.
 * Labels describe scope, not unverified formal employment titles or durations.
 */
export interface CareerStage {
  id: string;
  organization: string;
  label: string;
  role: string;
  theme: string;
  summary: string;
  detail: string;
  kind: 'service' | 'education' | 'company' | 'personal';
}

export const careerStages = [
  {
    id: 'marine-corps', organization: 'United States Marine Corps', label: 'Marine Corps',
    role: 'Data Network Specialist', theme: 'Technical foundation', kind: 'service',
    summary: 'Working with networks, systems, and operational challenges gave me an early appreciation for how important reliable technology is, especially when people depend on it.',
    detail: 'That mindset started in the Marine Corps, where I served as a Data Network Specialist. It also gave me the habit of wanting to understand the full picture, not just the symptom in front of me.',
  },
  {
    id: 'education', organization: 'University of Advancing Technology', label: 'Education',
    role: 'Network Engineering + Security', theme: 'Expanded expertise', kind: 'education',
    summary: 'After the Marines, I studied Network Engineering and Network Security at the University of Advancing Technology in Arizona.',
    detail: 'From there, I moved into technical roles where I could keep learning by doing.',
  },
  {
    id: 'sonicwall', organization: 'SonicWall', label: 'SonicWall',
    role: 'Enterprise support + labs', theme: 'Technical depth', kind: 'company',
    summary: 'At SonicWall, I worked in enterprise technical support with a focus on firewalls and centralized management platforms.',
    detail: 'I also spent time helping develop and maintain a technical reproduction lab, where difficult problems could be recreated, tested, and understood. That experience sharpened my troubleshooting instincts and reinforced something that still matters to me today... real learning happens when you can see the system, test your assumptions, and work through the failure.',
  },
  {
    id: 'western-nrg', organization: 'Western NRG', label: 'Western NRG',
    role: 'Automation + operational improvement', theme: 'Systems thinking', kind: 'company',
    summary: 'At Western NRG, I continued building on that foundation through automation and operational improvement.',
    detail: 'I became more focused on reducing repetitive work, improving efficiency, and designing solutions that did more than solve a problem once. I wanted to make solving the next problem easier too.',
  },
  {
    id: 'sophos', organization: 'Sophos', label: 'Sophos',
    role: 'Global Sales Engineering leadership', theme: 'People + scale', kind: 'company',
    summary: 'At Sophos, I moved deeper into sales engineering leadership, eventually working in a global leadership capacity.',
    detail: 'That experience helped me think beyond technical knowledge alone. It pushed me to focus on coaching, consistency, team development, and how to help engineers succeed across different regions, teams, and business needs.',
  },
  {
    id: 'palo-alto-networks', organization: 'Palo Alto Networks', label: 'Palo Alto Networks',
    role: 'Commercial SE leadership', theme: 'Business outcomes', kind: 'company',
    summary: 'At Palo Alto Networks, I continued that path in commercial sales engineering leadership.',
    detail: 'There, my focus included developing teams, improving technical execution, supporting commercial growth, and helping engineers connect complex technology to real customer outcomes. That part of my career strengthened my belief that great technical leadership is not just about knowing the technology. It is about building confidence, setting direction, developing people, and creating an environment where strong technical work can thrive.',
  },
  {
    id: 'ben-davis-builds', organization: 'Ben Davis Builds', label: 'Ben Davis Builds',
    role: 'Engineering + mentorship + AI', theme: 'What comes next', kind: 'personal',
    summary: 'Ben Davis Builds is where I bring together leadership, hands on engineering, and ongoing experimentation.',
    detail: 'It is a place to share lessons from leading sales engineering teams, document technical projects, explore cybersecurity and AI, and create resources that help others grow. Some of that work is about systems and infrastructure. Some of it is about leadership and mentorship. Some of it is simply about following curiosity and seeing what can be learned by building.',
  },
] satisfies readonly CareerStage[];
