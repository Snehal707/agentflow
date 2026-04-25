import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(root, 'lib', 'telegram-bot.ts');
let t = fs.readFileSync(p, 'utf8');

const oldRun = `async function runTelegramChatReply(
  question: string,
  row?: TelegramUserRow | null,
): Promise<string> {
  const walletAddr = row?.wallet_address ? getAddress(row.wallet_address) : undefined;

  let memoryContext = '';
  if (walletAddr) {
    const profileBlock = await loadTelegramUserProfileContext(walletAddr);
    const prior = await buildMemoryContext({
      walletAddress: walletAddr,
      agentSlug: 'chat',
      limit: 10,
    });
    memoryContext = [profileBlock, prior].filter(Boolean).join('\\n\\n').trim();
  }

  const compactPrompt = [
    buildCurrentDateContext(),
    row?.wallet_address
      ? \`Telegram is linked to wallet \${getAddress(row.wallet_address)}.\`
      : 'Telegram is not linked to a wallet yet.',
    'Reply in a natural Telegram chat tone.',
    'Do not default to a command menu unless the user asks for commands or help.',
    'If the user asks for an action that needs a linked account and there is no linked wallet, tell them to link Telegram in settings first.',
    'If a User profile block appears in memory above, follow its rules: do not address the user by name in every reply.',
    '',
    \`User: \${question}\`,
  ].join('\\n');
`;

const newRun = `async function runTelegramChatReply(
  question: string,
  row: TelegramUserRow | null | undefined,
  chatId: number,
): Promise<string> {
  const walletAddr = row?.wallet_address ? getAddress(row.wallet_address) : undefined;

  let memoryContext = '';
  if (walletAddr) {
    const profileBlock = await loadTelegramUserProfileContext(walletAddr);
    const prior = await buildMemoryContext({
      walletAddress: walletAddr,
      agentSlug: 'chat',
      limit: 10,
    });
    memoryContext = [profileBlock, prior].filter(Boolean).join('\\n\\n').trim();
  }

  const history = await getTelegramHistory(chatId);
  const historyContext =
    history.length > 0
      ? history
          .map((m) => \`\${m.role === 'user' ? 'User' : 'Assistant'}: \${m.content}\`)
          .join('\\n')
      : '';
  const historyBlock = historyContext
    ? ['Previous conversation:', historyContext, ''].join('\\n')
    : '';

  const compactPrompt = [
    buildCurrentDateContext(),
    row?.wallet_address
      ? \`Telegram is linked to wallet \${getAddress(row.wallet_address)}.\`
      : 'Telegram is not linked to a wallet yet.',
    'Reply in a natural Telegram chat tone.',
    'Do not default to a command menu unless the user asks for commands or help.',
    'If the user asks for an action that needs a linked account and there is no linked wallet, tell them to link Telegram in settings first.',
    'If a User profile block appears in memory above, follow its rules: do not address the user by name in every reply.',
    '',
    historyBlock,
    \`User: \${question}\`,
  ].join('\\n');
`;

if (!t.includes(oldRun)) {
  console.error('old runTelegramChatReply block not found');
  process.exit(1);
}
t = t.replace(oldRun, newRun);

const oldStart = `  bot.onText(/^\\/start(?:@\\w+)?(?:\\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match?.[1]?.trim();
    const chatIdStr = String(chatId);
`;

const newStart = `  bot.onText(/^\\/start(?:@\\w+)?(?:\\s+(.+))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match?.[1]?.trim();
    const chatIdStr = String(chatId);
    void getRedis()
      .del(telegramHistoryKey(chatId))
      .catch(() => {});
`;

if (!t.includes(oldStart)) {
  console.error('/start header block not found');
  process.exit(1);
}
t = t.replace(oldStart, newStart);

t = t.replaceAll('await runTelegramChatReply(text, row)', 'await runTelegramChatReply(text, row, msg.chat.id)');

const pat = `          const answer = await runTelegramChatReply(text, row, msg.chat.id);
          await send(bot, msg.chat.id, answer);`;
const rep = `          const answer = await runTelegramChatReply(text, row, msg.chat.id);
          await send(bot, msg.chat.id, answer);
          await appendTelegramHistory(msg.chat.id, text, answer);`;

let c = 0;
while (t.includes(pat)) {
  t = t.replace(pat, rep);
  c++;
}
console.log('patched reply+append blocks:', c);

fs.writeFileSync(p, t);
console.log('written', p);
