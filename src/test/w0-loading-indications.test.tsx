import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import LoadingState from '../components/LoadingState';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('loading indications', () => {
  it('ships an animated boot shell before the JavaScript bundle starts', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');

    expect(html).toContain('class="boot-loader"');
    expect(html).toContain('Opening your bingo card');
    expect(html).toMatch(/@keyframes\s+boot-pulse/);
  });

  it('renders an animated, status-announced in-app loader', () => {
    const { container } = render(<LoadingState label="Getting your card ready" />);

    expect(screen.getByRole('status')).toHaveTextContent('Getting your card ready');
    expect(container.querySelector('.loading-spinner')).toBeInTheDocument();
  });
});
