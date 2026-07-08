import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// RTL-jsdom harness smoke test. Proves the "app" Vitest project mounts a React
// component under jsdom and that Testing Library queries + jest-dom matchers are
// wired. It deliberately uses a throwaway local component (not an app screen) so
// the harness layer stays independent of feature work owned by other tickets.
function Greeting({ name }: { name: string }) {
  return <h1>Ahoy, {name}!</h1>;
}

describe('RTL-jsdom harness', () => {
  it('mounts a component under jsdom and queries its rendered text', () => {
    render(<Greeting name="sailor" />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent('Ahoy, sailor!');
  });
});
