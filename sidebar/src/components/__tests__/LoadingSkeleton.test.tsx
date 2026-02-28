import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from '../LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders the loading skeleton container', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('shows "Analyzing claims..." text', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByText('Analyzing claims...')).toBeInTheDocument();
  });

  it('renders shimmer keyframe animation styles', () => {
    const { container } = render(<LoadingSkeleton />);
    const styleTag = container.querySelector('style');
    expect(styleTag).not.toBeNull();
    expect(styleTag!.textContent).toContain('factcheck-shimmer');
    expect(styleTag!.textContent).toContain('factcheck-pulse');
  });

  it('renders 3 placeholder claim cards plus 1 bar placeholder', () => {
    const { container } = render(<LoadingSkeleton />);
    const skeleton = container.querySelector('[data-testid="loading-skeleton"]')!;
    const divChildren = Array.from(skeleton.children).filter(
      (el) => el.tagName === 'DIV' || el.tagName === 'STYLE'
    );
    // style + bar(72px) + 3 cards(64px) + text = 6 total children
    expect(divChildren.length).toBe(6);
  });
});
