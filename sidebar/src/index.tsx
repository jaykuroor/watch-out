import { createRoot } from 'react-dom/client';
import { Sidebar } from './components/Sidebar';
import type { SidebarProps } from './components/Sidebar';

let root: ReturnType<typeof createRoot> | null = null;
let currentProps: SidebarProps = { state: 'idle', onClose: () => {} };

function render() {
  if (root) {
    root.render(<Sidebar {...currentProps} />);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).mountFactCheckSidebar = (container: HTMLElement) => {
  if (!root) {
    root = createRoot(container);
  }
  render();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).updateFactCheckSidebar = (newProps: Partial<SidebarProps>) => {
  currentProps = { ...currentProps, ...newProps };
  render();
};
