import { render, screen } from '@testing-library/react';
import { VerificationBar, getColor, getLabel } from '../VerificationBar';

describe('VerificationBar', () => {
  it('displays the percentage correctly', () => {
    render(<VerificationBar score={0.72} claimCount={3} />);
    expect(screen.getByTestId('score-percentage')).toHaveTextContent('72%');
  });

  it('displays claim count text', () => {
    render(<VerificationBar score={0.5} claimCount={2} />);
    expect(screen.getByText('Based on 2 verified claims')).toBeInTheDocument();
  });

  it('uses singular "claim" for count of 1', () => {
    render(<VerificationBar score={0.5} claimCount={1} />);
    expect(screen.getByText('Based on 1 verified claim')).toBeInTheDocument();
  });

  it('renders the progress bar fill with correct width', () => {
    render(<VerificationBar score={0.65} claimCount={2} />);
    const fill = screen.getByTestId('score-bar-fill');
    expect(fill.style.width).toBe('65%');
  });

  it('rounds percentage to nearest integer', () => {
    render(<VerificationBar score={0.333} claimCount={1} />);
    expect(screen.getByTestId('score-percentage')).toHaveTextContent('33%');
  });

  it('handles score of 0', () => {
    render(<VerificationBar score={0} claimCount={1} />);
    expect(screen.getByTestId('score-percentage')).toHaveTextContent('0%');
    expect(screen.getByTestId('score-bar-fill').style.width).toBe('0%');
  });

  it('handles score of 1', () => {
    render(<VerificationBar score={1} claimCount={3} />);
    expect(screen.getByTestId('score-percentage')).toHaveTextContent('100%');
    expect(screen.getByTestId('score-bar-fill').style.width).toBe('100%');
  });
});

describe('getColor', () => {
  it('returns green for scores >= 0.7', () => {
    expect(getColor(0.7)).toBe('#22c55e');
    expect(getColor(0.85)).toBe('#22c55e');
    expect(getColor(1.0)).toBe('#22c55e');
  });

  it('returns yellow for scores 0.4-0.69', () => {
    expect(getColor(0.4)).toBe('#eab308');
    expect(getColor(0.55)).toBe('#eab308');
    expect(getColor(0.69)).toBe('#eab308');
  });

  it('returns red for scores < 0.4', () => {
    expect(getColor(0.0)).toBe('#ef4444');
    expect(getColor(0.2)).toBe('#ef4444');
    expect(getColor(0.39)).toBe('#ef4444');
  });
});

describe('getLabel', () => {
  it('returns correct labels for score ranges', () => {
    expect(getLabel(0.9)).toBe('Well Supported');
    expect(getLabel(0.8)).toBe('Well Supported');
    expect(getLabel(0.7)).toBe('Mostly Supported');
    expect(getLabel(0.6)).toBe('Mostly Supported');
    expect(getLabel(0.5)).toBe('Mixed Evidence');
    expect(getLabel(0.4)).toBe('Mixed Evidence');
    expect(getLabel(0.3)).toBe('Weakly Supported');
    expect(getLabel(0.2)).toBe('Weakly Supported');
    expect(getLabel(0.1)).toBe('Likely Misleading');
    expect(getLabel(0.0)).toBe('Likely Misleading');
  });
});
