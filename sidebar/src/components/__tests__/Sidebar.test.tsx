import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { createSidebarProps, mockClaims, mockMetadata } from '../../test/fixtures';

describe('Sidebar', () => {
  it('renders nothing in idle state', () => {
    const { container } = render(<Sidebar {...createSidebarProps({ state: 'idle' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the header with title "Fact Check"', () => {
    render(<Sidebar {...createSidebarProps({ state: 'loading' })} />);
    expect(screen.getByText('Fact Check')).toBeInTheDocument();
  });

  it('renders metadata when provided', () => {
    render(<Sidebar {...createSidebarProps({ state: 'loading' })} />);
    expect(screen.getByText(mockMetadata.title)).toBeInTheDocument();
    expect(screen.getByText(mockMetadata.channel)).toBeInTheDocument();
  });

  it('does not render metadata when not provided', () => {
    render(
      <Sidebar {...createSidebarProps({ state: 'loading', metadata: undefined })} />
    );
    expect(screen.queryByText(mockMetadata.title)).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Sidebar {...createSidebarProps({ state: 'loading', onClose })} />);
    fireEvent.click(screen.getByLabelText('Close sidebar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Loading state
  it('renders LoadingSkeleton in loading state', () => {
    render(<Sidebar {...createSidebarProps({ state: 'loading' })} />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Analyzing claims...')).toBeInTheDocument();
  });

  // No transcript state
  it('renders no-transcript message', () => {
    render(<Sidebar {...createSidebarProps({ state: 'no_transcript' })} />);
    expect(screen.getByText('No Transcript Available')).toBeInTheDocument();
    expect(
      screen.getByText(/This Short doesn't have captions/)
    ).toBeInTheDocument();
  });

  // Error state
  it('renders error state with default message', () => {
    render(
      <Sidebar {...createSidebarProps({ state: 'error', errorMessage: undefined })} />
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('Failed to analyze this Short. Please try again.')
    ).toBeInTheDocument();
  });

  it('renders error state with custom message', () => {
    render(
      <Sidebar
        {...createSidebarProps({ state: 'error', errorMessage: 'Backend timeout' })}
      />
    );
    expect(screen.getByText('Backend timeout')).toBeInTheDocument();
  });

  // Result state
  it('renders verification bar and claim cards in result state', () => {
    render(<Sidebar {...createSidebarProps()} />);
    expect(screen.getByTestId('score-percentage')).toHaveTextContent('35%');
    expect(screen.getByText('3 claims analyzed')).toBeInTheDocument();
    mockClaims.forEach((claim) => {
      expect(screen.getByText(claim.text)).toBeInTheDocument();
    });
  });

  it('renders "no claims" message when claims array is empty', () => {
    render(
      <Sidebar
        {...createSidebarProps({ claims: [], overallScore: null })}
      />
    );
    expect(
      screen.getByText('No verifiable factual claims found in this Short.')
    ).toBeInTheDocument();
  });

  it('renders singular "claim" text for single claim', () => {
    render(
      <Sidebar
        {...createSidebarProps({
          claims: [mockClaims[0]],
          overallScore: 0.0,
        })}
      />
    );
    expect(screen.getByText('1 claim analyzed')).toBeInTheDocument();
  });
});
