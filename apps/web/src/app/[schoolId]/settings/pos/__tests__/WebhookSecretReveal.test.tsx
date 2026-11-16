import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WebhookSecretReveal } from '../WebhookSecretReveal';

const SECRET = 'q3Jx0V4mJ8xY6c1o9xg3c8Zr5p2Lw7nB0aQe4tUuKkM';

describe('WebhookSecretReveal', () => {
  it('shows the issued secret and copies it', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onDone = jest.fn();
    render(<WebhookSecretReveal secret={SECRET} onDone={onDone} />);
    expect(screen.getByDisplayValue(SECRET)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    });
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /saved it/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('POS ConnectModal — custom webhook secret is server-issued', () => {
  // The page module is large and client-only; assert on its source that the
  // operator no longer types the secret and that the issued one is shown.
  const src = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');

  it('mounts WebhookSecretReveal with the secret returned by POST /pos/connections', () => {
    expect(src).toMatch(/import \{ WebhookSecretReveal \} from '\.\/WebhookSecretReveal';/);
    expect(src).toMatch(/<WebhookSecretReveal secret=\{issuedSecret\} onDone=\{onConnected\} \/>/);
    expect(src).toMatch(/setIssuedSecret\(created\.webhookSecret\)/);
  });

  it('has no operator input for the custom webhook secret', () => {
    expect(src).not.toMatch(/webhookSecret: v \}/);
  });
});
