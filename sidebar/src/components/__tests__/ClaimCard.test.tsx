import { render, screen, fireEvent } from '@testing-library/react';
import { ClaimCard } from '../ClaimCard';
import type { Claim } from '../Sidebar';

const supportedClaim: Claim = {
  id: 1,
  text: 'The WHO classified processed meat as a Group 1 carcinogen',
  verdict: 'supported',
  confidence: 'high',
  explanation: 'The IARC classified processed meat as Group 1 in October 2015.',
  sources: [
    {
      title: 'WHO - IARC Monographs',
      url: 'https://who.int/iarc',
      snippet: 'Processed meat classified as carcinogenic to humans...',
    },
  ],
};

const refutedClaim: Claim = {
  id: 2,
  text: 'Microwave ovens destroy 90% of nutrients',
  verdict: 'refuted',
  confidence: 'high',
  explanation: 'Studies show microwaving retains similar or more nutrients.',
  sources: [
    {
      title: 'Harvard Health',
      url: 'https://health.harvard.edu/microwave',
      snippet: 'Microwave cooking retains more nutrients...',
    },
  ],
};

const unclearClaim: Claim = {
  id: 3,
  text: 'Eating bananas at night causes weight gain',
  verdict: 'unclear',
  confidence: 'low',
  explanation: 'No strong evidence found.',
  sources: [],
  what_to_check_next: 'Look for clinical studies on meal timing',
};

describe('ClaimCard', () => {
  it('renders claim text', () => {
    render(<ClaimCard claim={supportedClaim} />);
    expect(screen.getByText(supportedClaim.text)).toBeInTheDocument();
  });

  it('shows "Supported" label for supported verdict', () => {
    render(<ClaimCard claim={supportedClaim} />);
    expect(screen.getByText('Supported')).toBeInTheDocument();
  });

  it('shows "Refuted" label for refuted verdict', () => {
    render(<ClaimCard claim={refutedClaim} />);
    expect(screen.getByText('Refuted')).toBeInTheDocument();
  });

  it('shows "Unclear" label for unclear verdict', () => {
    render(<ClaimCard claim={unclearClaim} />);
    expect(screen.getByText('Unclear')).toBeInTheDocument();
  });

  it('starts collapsed (details not visible)', () => {
    render(<ClaimCard claim={supportedClaim} />);
    expect(screen.queryByTestId(`claim-details-${supportedClaim.id}`)).not.toBeInTheDocument();
  });

  it('expands on click to show explanation', () => {
    render(<ClaimCard claim={supportedClaim} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId(`claim-details-${supportedClaim.id}`)).toBeInTheDocument();
    expect(screen.getByText(supportedClaim.explanation)).toBeInTheDocument();
  });

  it('collapses again on second click', () => {
    render(<ClaimCard claim={supportedClaim} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByTestId(`claim-details-${supportedClaim.id}`)).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByTestId(`claim-details-${supportedClaim.id}`)).not.toBeInTheDocument();
  });

  it('shows sources when expanded', () => {
    render(<ClaimCard claim={supportedClaim} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText(/WHO - IARC Monographs/)).toBeInTheDocument();
  });

  it('renders source links with correct href', () => {
    render(<ClaimCard claim={supportedClaim} />);
    fireEvent.click(screen.getByRole('button'));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://who.int/iarc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows "what to check next" for unclear claims', () => {
    render(<ClaimCard claim={unclearClaim} />);
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByText(/Look for clinical studies on meal timing/)
    ).toBeInTheDocument();
  });

  it('does not show "what to check next" for non-unclear claims', () => {
    render(<ClaimCard claim={supportedClaim} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(/💡/)).not.toBeInTheDocument();
  });

  it('does not show Sources section when there are no sources', () => {
    render(<ClaimCard claim={unclearClaim} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Sources')).not.toBeInTheDocument();
  });

  it('shows confidence dots for each level', () => {
    const { rerender } = render(<ClaimCard claim={{ ...supportedClaim, confidence: 'low' }} />);
    expect(screen.getByText('●○○')).toBeInTheDocument();

    rerender(<ClaimCard claim={{ ...supportedClaim, confidence: 'med' }} />);
    expect(screen.getByText('●●○')).toBeInTheDocument();

    rerender(<ClaimCard claim={{ ...supportedClaim, confidence: 'high' }} />);
    expect(screen.getByText('●●●')).toBeInTheDocument();
  });

  it('supports keyboard activation (Enter)', () => {
    render(<ClaimCard claim={supportedClaim} />);
    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.getByTestId(`claim-details-${supportedClaim.id}`)).toBeInTheDocument();
  });

  it('supports keyboard activation (Space)', () => {
    render(<ClaimCard claim={supportedClaim} />);
    const button = screen.getByRole('button');
    fireEvent.keyDown(button, { key: ' ' });
    expect(screen.getByTestId(`claim-details-${supportedClaim.id}`)).toBeInTheDocument();
  });

  it('sets aria-expanded correctly', () => {
    render(<ClaimCard claim={supportedClaim} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
