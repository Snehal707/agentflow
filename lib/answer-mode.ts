export type AnswerMode =
  | 'casual_chat'
  | 'product_info'
  | 'financial_scope'
  | 'financial_advice'
  | 'portfolio_state'
  | 'balance_state'
  | 'payment_state'
  | 'market_state'
  | 'action_preview'
  | 'general';

export type RequiredStateTool = 'get_balance' | 'get_portfolio';

export function isFinancialAdvisoryScopeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(?:can you|could you|will you|would you|are you able to|do you)\b[\s\S]{0,80}\b(?:personal\s+)?(?:fund|funds|portfolio|wealth|money|asset|assets|finance|financial)\s+(?:manager|advisor|adviser|operator|assistant|coach)\b/i.test(
      normalized,
    ) ||
    /\b(?:manage|run|handle|look after|take care of|be in charge of|invest|allocate|rebalance|optimi[sz]e)\b[\s\S]{0,80}\b(?:my\s+)?(?:funds|portfolio|money|wealth|assets|finances)\b/i.test(
      normalized,
    ) ||
    /\b(?:make|take)\b[\s\S]{0,50}\b(?:investment|portfolio|money|fund)\s+decisions?\b/i.test(
      normalized,
    )
  );
}

export function buildFinancialAdvisoryScopeReply(): string {
  return [
    'I can help like an AgentFlow operator, but I am not a discretionary fund manager.',
    '',
    'I can show your live balances and portfolio, explain risk, compare vaults, preview swaps, bridge USDC, track prediction-market positions, and prepare actions for your confirmation.',
    '',
    'You stay in control: I do not make investment decisions or move funds without an explicit preview and confirmation. What do you want to review first?',
  ].join('\n');
}

export function classifyAnswerMode(message: string): AnswerMode {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return 'general';

  const isProductCapabilityQuestion =
    /\b(?:what can you do|what can agentflow do|how does agentflow work|what is agentflow|voice notes?|screenshots?|wallet addresses?|\.arc|capabilities|support)\b/i.test(
      normalized,
    ) ||
    ((/^(?:explain\b|tell\s+me\b|show\s+me\b|give\s+me\b|how\s+(?:to|do\s+i|does|can\s+i)\b|what\s+(?:is|are|does)\b|do\s+you\s+support\b|can\s+i\s+use\b|which\b)/i.test(
      normalized,
    ) ||
      /\b(?:csv|example|examples|sample|template|format)\b/i.test(normalized)) &&
      /\b(?:split|batch|schedule|scheduled|invoice|request|payment link|qr|contacts?|\.arc|bridge|vault|swap|portfolio|telegram|research|csv|format|template|example|examples|sample)\b/i.test(
        normalized,
      ) &&
      !/\b(?:my|mine|our)\b/i.test(normalized) &&
      !/\b[a-z0-9_.-]+\.arc\b/i.test(normalized) &&
      !/0x[a-f0-9]{6,}/i.test(normalized) &&
      !/\b\d+(?:\.\d+)?\b/i.test(normalized));

  if (/^(?:hi|hey|hello|yo|sup|thanks?|thank you|ok(?:ay)?|lol|haha)\b/i.test(normalized)) {
    return 'casual_chat';
  }

  if (isFinancialAdvisoryScopeMessage(normalized)) {
    return 'financial_scope';
  }

  if (
    (/\b(?:what should i do|what do you recommend|recommend|recommendation|advice|strategy|allocate|allocation|best move|how should i)\b/i.test(
      normalized,
    ) ||
      /\b(?:what do you think|thoughts?|opinion|good|bad|healthy|risky|risk|safe|balanced|diversified|diversification|improve|assessment|assess|rate|rating)\b/i.test(
        normalized,
      ) ||
      /\b(?:analyze|analyse|analysis|review|scan|summarize|summary|break\s*down|overview|assess|check)\b/i.test(
        normalized,
      )) &&
    /\b(?:funds|portfolio|holdings|balance|balances|usdc|eurc|vault|vault shares?|gateway|reserve|position|positions|money|assets|wallet)\b/i.test(
      normalized,
    )
  ) {
    return 'financial_advice';
  }

  if (isProductCapabilityQuestion) {
    return 'product_info';
  }

  if (/\b(?:portfolio|holdings?|positions?|what do i own|wallet breakdown|scan my wallet)\b/i.test(normalized)) {
    return 'portfolio_state';
  }

  if (
    /\b(?:balance|balances|how much|funds|wallet tokens?|gateway reserve|execution wallet|available usdc|available eurc)\b/i.test(
      normalized,
    )
  ) {
    return 'balance_state';
  }

  if (
    /\b(?:payment history|payments? have i|payments? did i|recent transfers?|agentpay history|scheduled payments?|invoice status|contacts?)\b/i.test(
      normalized,
    )
  ) {
    return 'payment_state';
  }

  if (
    /\b(?:prediction markets?|market positions?|betting markets?|what can i bet on|redeem winnings?|refund market)\b/i.test(
      normalized,
    )
  ) {
    return 'market_state';
  }

  if (
    /\b(?:swap|bridge|deposit|withdraw|send|pay|request|invoice|split|batch|buy|sell|redeem|refund)\b/i.test(
      normalized,
    )
  ) {
    return 'action_preview';
  }

  return 'general';
}

export function answerModeRequiresFinancialContext(mode: AnswerMode): boolean {
  return mode === 'financial_advice';
}

export function stateToolForAnswerMode(mode: AnswerMode): RequiredStateTool | null {
  if (mode === 'portfolio_state' || mode === 'financial_advice') {
    return 'get_portfolio';
  }
  if (mode === 'balance_state' || mode === 'payment_state') {
    return 'get_balance';
  }
  return null;
}

export function answerModeAllowsUngroundedState(mode: AnswerMode): boolean {
  return mode === 'casual_chat' || mode === 'product_info' || mode === 'financial_scope' || mode === 'general';
}
