import { GENERATE_POINTER, readyReply } from '../conciergeReply';

describe('readyReply — the Concierge never asks permission it cannot act on', () => {
  it("the exact message Greg saw: 'Shall I proceed?' becomes a pointer at the button", () => {
    const out = readyReply(
      "Now, I'll draft the brief for the design: Create a vibrant menu board for Super Taco. I'm ready to generate three distinct options for your menu board! Shall I proceed?",
      true,
    );
    expect(out).not.toMatch(/proceed\?/i);
    expect(out).not.toMatch(/\?\s*$/);
    expect(out).toContain('Create a vibrant menu board for Super Taco.');
    expect(out.endsWith(GENERATE_POINTER)).toBe(true);
  });

  it("the follow-up Greg saw: 'Generating three distinct designs now.' is replaced — the model generates nothing", () => {
    const out = readyReply(
      "I've got everything I need to create your menu board options! Generating three distinct designs now.",
      true,
    );
    expect(out).not.toMatch(/generating/i);
    expect(out).toContain("I've got everything I need");
    expect(out.endsWith(GENERATE_POINTER)).toBe(true);
  });

  it('a ready reply that already points at the button is left alone', () => {
    const msg = "Got it — I have everything. When you're ready, hit Generate 3 boards below.";
    expect(readyReply(msg, true)).toBe(msg);
  });

  it('a reply that is only the question becomes only the pointer', () => {
    expect(readyReply('Shall I proceed?', true)).toBe(GENERATE_POINTER);
  });

  it('a NOT-ready turn is untouched — real questions must survive', () => {
    const q = 'What should the headline say?';
    expect(readyReply(q, false)).toBe(q);
  });

  it('a ready turn keeps a genuine design question that is not about proceeding', () => {
    const out = readyReply('Ready to go. Do you want the logo top-left or centered?', true);
    expect(out).toContain('Do you want the logo top-left or centered?');
    expect(out).toContain(GENERATE_POINTER);
  });
});
