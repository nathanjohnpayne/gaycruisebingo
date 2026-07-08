// Vitest setup for the jsdom "app" project. Registers @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveTextContent, …) on Vitest's `expect` and
// augments its Assertion types, and auto-cleans the RTL DOM after each test.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
