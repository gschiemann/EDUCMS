/**
 * The Concierge's LAST word when the intake is ready (2026-09-22).
 *
 * Greg: "it asks if i want to proceed, i say proceed, and then it says ok hit
 * the generate button... the messaging should say if you want to proceed hit
 * the generate button below, that skips an extra back and forth".
 *
 * The model cannot generate anything — only the Generate button does — so a
 * ready turn must never end in a yes/no question and never claim to be
 * generating. The system prompt now says so; this is the deterministic
 * guarantee on top of it, because prompt compliance is not a contract.
 * Pure, so it is unit-tested on the exact messages Greg saw.
 */

export const GENERATE_POINTER = "When you're ready, hit Generate 3 boards below.";

/** A sentence that asks the customer to green-light generation. */
const ASKS_TO_PROCEED = /\b(proceed|go ahead|generate|ready|shall|want me|should i|would you like)\b/i;
/**
 * A sentence in which the ASSISTANT claims to be doing the generating —
 * sentence-initial "Generating…", or first-person "I'm / I'll / let me
 * generate…". Deliberately narrow: the brief the model drafts legitimately
 * says things like "Create a vibrant menu board…", and that must survive.
 */
const CLAIMS_TO_GENERATE =
  /^\s*(generating|designing|creating|building)\b|\b(i'?m|i am|i'?ll|i will|let me)\s+(now\s+|just\s+)?(generat|design|creat|build)(e|ing)\b/i;
/** Already points at the button. */
const MENTIONS_BUTTON = /\bGenerate 3 boards\b|\bhit Generate\b/i;

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];
}

export function readyReply(reply: string, ready: boolean): string {
  if (!ready) return reply;
  const kept = splitSentences(reply).filter((s) => {
    const t = s.trim();
    if (!t) return false;
    if (t.endsWith('?') && ASKS_TO_PROCEED.test(t)) return false;
    if (CLAIMS_TO_GENERATE.test(t) && !MENTIONS_BUTTON.test(t)) return false;
    return true;
  });
  let out = kept.join('').trim();
  if (!MENTIONS_BUTTON.test(out)) out = out ? `${out} ${GENERATE_POINTER}` : GENERATE_POINTER;
  return out;
}
