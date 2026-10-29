import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { NO_PROVIDER_REPLY, principlesBlock, replyText } from './brain-chat.ts';

Deno.test('principles reach the Brain Chat prompt as before #220', () => {
  const block = principlesBlock([{ principle: 'Reuse before build' }, { principle: ' No paid AI without approval ' }]);
  assert(block.includes('FOUNDER OPERATING PRINCIPLES'));
  assert(block.includes('- Reuse before build\n- No paid AI without approval'));
});

Deno.test('no principles -> no block', () => {
  assertEquals(principlesBlock([]), '');
  assertEquals(principlesBlock([{ principle: '  ' }]), '');
});

Deno.test('all providers failed (null) -> honest reply, no crash', () => {
  assertEquals(replyText(null), NO_PROVIDER_REPLY);
  assertEquals(replyText({ text: '   ' }), NO_PROVIDER_REPLY);
  assertEquals(replyText({ text: 'GoMax TD is 15%.' }), 'GoMax TD is 15%.');
});
