import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemoNotice } from '../src/components/DemoNotice';
import { USER } from './utils';

describe('DemoNotice (ADR-066)', () => {
  it('tells visitors that a demo workspace is fictional', () => {
    render(<DemoNotice user={{ ...USER, agency: { ...USER.agency, isDemo: true } }} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Demo workspace. Every person, company and amount here is fictional',
    );
  });

  it('shows nothing in a real workspace', () => {
    const { container } = render(<DemoNotice user={USER} />);
    expect(container).toBeEmptyDOMElement();
  });
});
