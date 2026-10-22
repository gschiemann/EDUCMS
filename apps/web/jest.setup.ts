import '@testing-library/jest-dom';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

// jsdom does not expose Node's TextEncoder/TextDecoder. Several web tests load
// API source (fixtures cut from the producer), whose @sentry/nestjs import
// pulls @sentry/server-utils >=10.7x, which constructs a TextDecoder at module
// load. Node always has them, so production is unaffected; this is test-env only.
const g = globalThis as unknown as { TextDecoder?: unknown; TextEncoder?: unknown };
if (typeof g.TextDecoder === 'undefined') g.TextDecoder = NodeTextDecoder;
if (typeof g.TextEncoder === 'undefined') g.TextEncoder = NodeTextEncoder;
