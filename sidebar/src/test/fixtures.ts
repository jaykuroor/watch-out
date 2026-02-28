import type { Claim, SidebarProps } from '../components/Sidebar';

export const mockClaims: Claim[] = [
  {
    id: 1,
    text: 'Microwave ovens destroy 90% of nutrients in food',
    verdict: 'refuted',
    confidence: 'high',
    explanation:
      'Multiple studies show microwaving retains similar or more nutrients compared to other cooking methods.',
    sources: [
      {
        title: 'Harvard Health Publishing',
        url: 'https://health.harvard.edu/microwave',
        snippet: 'Microwave cooking retains more nutrients than some other methods...',
      },
    ],
  },
  {
    id: 2,
    text: 'The WHO classified processed meat as a Group 1 carcinogen in 2015',
    verdict: 'supported',
    confidence: 'high',
    explanation: 'The IARC (part of WHO) did classify processed meat as Group 1 in October 2015.',
    sources: [
      {
        title: 'WHO - IARC Monographs',
        url: 'https://who.int/iarc',
        snippet: 'Processed meat classified as carcinogenic to humans (Group 1)...',
      },
    ],
  },
  {
    id: 3,
    text: 'Eating bananas at night causes weight gain',
    verdict: 'unclear',
    confidence: 'low',
    explanation:
      'No strong evidence found. Weight gain depends on total caloric intake, not timing.',
    sources: [],
    what_to_check_next: 'Look for clinical studies on meal timing and weight',
  },
];

export const mockMetadata = {
  title: '5 Foods That Are Secretly Destroying Your Health',
  channel: 'HealthTruth',
};

export function createSidebarProps(
  overrides: Partial<SidebarProps> = {}
): SidebarProps {
  return {
    state: 'result',
    metadata: mockMetadata,
    overallScore: 0.35,
    claims: mockClaims,
    transcriptPreview: 'Hey guys, today I want to talk about five foods...',
    onClose: vi.fn(),
    ...overrides,
  };
}
