import {
  AgentFlowIntent,
  AgentFlowIntentName,
  AttachmentSlot,
  BatchExecuteSlots,
  BridgeExecuteSlots,
  ContactsCreateSlots,
  ContactsDeleteSlots,
  ContactsUpdateSlots,
  HexAddress,
  InvoiceCreateSlots,
  PredmarketBuySlots,
  PredmarketDetailSlots,
  PredmarketRedeemSlots,
  PredmarketRefundSlots,
  PredmarketSellSlots,
  ResearchReportSlots,
  ScheduleCancelSlots,
  ScheduleCreateSlots,
  SplitExecuteSlots,
  SwapExecuteSlots,
  TranscribeTranscribeSlots,
  VaultDepositSlots,
  VaultWithdrawSlots,
  VisionAnalyzeSlots,
  AgentpayPaymentLinkSlots,
  AgentpayRequestSlots,
  AgentpaySendSlots,
} from './types';
import { detectPortfolioImpactIntent } from '../portfolio-impact-intent';

export type ValidationSeverity = 'pass' | 'soft' | 'hard';

export type ValidationResult = {
  ok: boolean;
  intent: AgentFlowIntent;
  reason?: string;
  clarification?: string;
  severity: ValidationSeverity;
  slots_present?: string[];
  slots_missing?: string[];
};

type ValidatorDecision = {
  ok: boolean;
  severity: ValidationSeverity;
  reason?: string;
  clarification?: string;
  slots_present?: string[];
  slots_missing?: string[];
};

function passDecision(): ValidatorDecision {
  return { ok: true, severity: 'pass' };
}

function softDecision(
  reason: string,
  slots_present: string[] = [],
  slots_missing: string[] = [],
): ValidatorDecision {
  return {
    ok: true,
    severity: 'soft',
    reason,
    slots_present,
    slots_missing,
  };
}

function hardDecision(
  reason: string,
  clarification?: string,
  slots_present: string[] = [],
  slots_missing: string[] = [],
): ValidatorDecision {
  return {
    ok: false,
    severity: 'hard',
    reason,
    clarification,
    slots_present,
    slots_missing,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidHexAddress(value: unknown): value is HexAddress {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasPositiveAmount(value: unknown): boolean {
  return isPlainObject(value) && hasPositiveNumber(value.value);
}

function hasRecipient(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  return hasNonEmptyString(value.handle) || isValidHexAddress(value.address);
}

function normalizeString(value: string): string {
  return value.trim();
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRecipientLike(value: unknown): void {
  if (!isPlainObject(value)) {
    return;
  }
  if (typeof value.handle === 'string') {
    value.handle = normalizeHandle(value.handle);
  }
  if (typeof value.address === 'string') {
    value.address = normalizeString(value.address);
  }
  if (typeof value.resolved === 'string') {
    value.resolved = normalizeString(value.resolved);
  }
}

function normalizeAttachment(value: unknown): void {
  if (!isPlainObject(value)) {
    return;
  }
  if (typeof value.id === 'string') {
    value.id = normalizeString(value.id);
  }
  if (typeof value.kind === 'string') {
    value.kind = normalizeString(value.kind);
  }
}

function normalizeFilterLike(value: unknown): void {
  if (!isPlainObject(value)) {
    return;
  }
  for (const key of ['category', 'stage', 'search', 'time_window', 'cursor'] as const) {
    if (typeof value[key] === 'string') {
      value[key] = normalizeString(value[key]);
    }
  }
}

export function normalizeIntent(intent: AgentFlowIntent): AgentFlowIntent {
  const normalized = {
    ...intent,
    raw_message: normalizeString(intent.raw_message),
    slots: isPlainObject(intent.slots) ? { ...intent.slots } : {},
  } as AgentFlowIntent;

  const slots = normalized.slots as Record<string, unknown>;

  for (const key of [
    'vault_symbol',
    'amount_token_hint',
    'topic_hint',
    'description',
    'invoice_number',
    'agent_slug',
    'payment_id',
    'source_format',
    'query',
    'task',
    'prompt',
    'label',
    'notes',
    'name',
  ] as const) {
    if (typeof slots[key] === 'string') {
      slots[key] = normalizeString(slots[key]);
    }
  }

  if (typeof slots.remark === 'string') {
    slots.remark = normalizeString(slots.remark);
  }
  if (typeof slots.provider === 'string') {
    slots.provider = normalizeString(slots.provider);
  }
  if (typeof slots.response_style === 'string') {
    slots.response_style = normalizeString(slots.response_style);
  }

  normalizeRecipientLike(slots.recipient);
  normalizeRecipientLike(slots.recipient_filter);
  normalizeRecipientLike(slots.to);

  if (Array.isArray(slots.recipients)) {
    for (const recipient of slots.recipients) {
      normalizeRecipientLike(recipient);
    }
  }

  if (Array.isArray(slots.payments)) {
    for (const payment of slots.payments) {
      if (isPlainObject(payment)) {
        normalizeRecipientLike(payment.recipient);
        normalizeRecipientLike(payment.to);
        if (typeof payment.remark === 'string') {
          payment.remark = normalizeString(payment.remark);
        }
      }
    }
  }

  if (isPlainObject(slots.market)) {
    if (typeof slots.market.address === 'string') {
      slots.market.address = normalizeString(slots.market.address);
    }
    if (typeof slots.market.title_hint === 'string') {
      slots.market.title_hint = normalizeString(slots.market.title_hint);
    }
  }

  if (isPlainObject(slots.outcome) && typeof slots.outcome.label === 'string') {
    slots.outcome.label = normalizeString(slots.outcome.label).toLowerCase();
  }

  if (isPlainObject(slots.schedule)) {
    if (typeof slots.schedule.cadence === 'string') {
      slots.schedule.cadence = normalizeString(slots.schedule.cadence);
    }
    if (typeof slots.schedule.first_run === 'string') {
      slots.schedule.first_run = normalizeString(slots.schedule.first_run);
    }
  }

  if (isPlainObject(slots.chain)) {
    if (typeof slots.chain.source === 'string') {
      slots.chain.source = normalizeString(slots.chain.source);
    }
    if (typeof slots.chain.target === 'string') {
      slots.chain.target = normalizeString(slots.chain.target);
    }
  }

  normalizeAttachment(slots.attachment);
  normalizeFilterLike(slots.filter);
  normalizeFilterLike(slots.market_filter);
  normalizeFilterLike(slots.pagination);

  if (normalized.intent === AgentFlowIntentName.ResearchReport) {
    if (!hasNonEmptyString(slots.task) && hasNonEmptyString(slots.topic_hint)) {
      slots.task = slots.topic_hint;
    } else if (!hasNonEmptyString(slots.task) && hasNonEmptyString(slots.query)) {
      slots.task = slots.query;
    }
    slots.portfolio_impact = detectPortfolioImpactIntent(normalized.raw_message);
  }

  return normalized;
}

function validateSwapExecute(
  slots: SwapExecuteSlots,
  rawMessage: string,
): ValidatorDecision {
  const missing: string[] = [];
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (!hasNonEmptyString(slots.token_in?.symbol)) {
    missing.push('token_in.symbol');
  }
  if (!hasNonEmptyString(slots.token_out?.symbol)) {
    missing.push('token_out.symbol');
  }
  if (missing.length > 0) {
    if (
      /\b(?:what|which)\b[\s\S]{0,40}\b(?:tokens?|pairs?|assets?)\b[\s\S]{0,40}\b(?:swap|swaps?)\b/i.test(rawMessage) ||
      /\b(?:swap|swaps?)\b[\s\S]{0,40}\b(?:supports?|available|tokens?|pairs?)\b/i.test(rawMessage)
    ) {
      return hardDecision(
        'Swap support question should clarify supported integrated tokens instead of forcing execution slots',
        'AgentFlow currently supports the integrated USDC/EURC swap route on Arc. You can ask for `swap 1 USDC to EURC` or `swap 1 EURC to USDC` for a live quote.',
        [],
        missing,
      );
    }
    const fromToken = hasNonEmptyString(slots.token_in?.symbol) ? slots.token_in.symbol : 'the token you want to swap';
    const toToken = hasNonEmptyString(slots.token_out?.symbol) ? slots.token_out.symbol : 'the token you want to receive';
    const clarification =
      missing.length === 1 && missing[0] === 'amount.value'
        ? `How much ${fromToken} do you want to swap into ${toToken}?`
        : `Tell me which token you want to swap, which token you want to receive, and how much.`;
    return hardDecision(
      'Swap intent is missing required execution fields',
      clarification,
      [],
      missing,
    );
  }
  if (!hasNonEmptyString(slots.amount?.currency)) {
    return softDecision(
      'Swap amount has no currency; downstream may infer it from token_in',
      ['amount.value', 'token_in.symbol', 'token_out.symbol'],
      ['amount.currency'],
    );
  }
  return passDecision();
}

function validateAmountAction(
  slots:
    | VaultDepositSlots
    | VaultWithdrawSlots,
  clarification: string,
): ValidatorDecision {
  if (!hasPositiveAmount(slots.amount)) {
    return hardDecision('Amount must be present and greater than zero', clarification, [], [
      'amount.value',
    ]);
  }
  if (!hasNonEmptyString(slots.amount?.currency)) {
    return softDecision(
      'Amount currency is missing; downstream may apply a default',
      ['amount.value'],
      ['amount.currency'],
    );
  }
  return passDecision();
}

function validateBridgeExecute(slots: BridgeExecuteSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (!hasNonEmptyString(slots.chain?.source)) {
    missing.push('chain.source');
  }
  if (missing.length > 0) {
    const source = hasNonEmptyString(slots.chain?.source) ? slots.chain?.source : null;
    const clarification =
      missing.length === 1 && missing[0] === 'amount.value' && source
        ? `How much do you want to bridge from ${source} to Arc?`
        : missing.length === 1 && missing[0] === 'chain.source'
          ? 'Which source chain are you bridging from?'
          : 'Tell me how much to bridge and which source chain to bridge from.';
    return hardDecision(
      'Bridge execution requires a positive amount and a source chain',
      clarification,
      [],
      missing,
    );
  }
  return passDecision();
}

function validateMarketAddress(
  slots: PredmarketDetailSlots | PredmarketRedeemSlots | PredmarketRefundSlots,
  clarification: string,
): ValidatorDecision {
  if (!isValidHexAddress(slots.market?.address)) {
    return hardDecision(
      'A valid market address is required',
      clarification,
      [],
      ['market.address'],
    );
  }
  return passDecision();
}

function hasOutcome(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    (hasNonEmptyString(value.label) || typeof value.index === 'number')
  );
}

function validatePredmarketBuy(slots: PredmarketBuySlots): ValidatorDecision {
  const missing: string[] = [];
  if (!isValidHexAddress(slots.market?.address)) {
    missing.push('market.address');
  }
  if (!hasOutcome(slots.outcome)) {
    missing.push('outcome');
  }
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (missing.length > 0) {
    return hardDecision(
      'Prediction market buy is missing required fields',
      'Tell me which market, which outcome, and how much you want to buy.',
      [],
      missing,
    );
  }
  return passDecision();
}

function validatePredmarketSell(slots: PredmarketSellSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!isValidHexAddress(slots.market?.address)) {
    missing.push('market.address');
  }
  if (!hasOutcome(slots.outcome)) {
    missing.push('outcome');
  }
  if (!hasPositiveAmount(slots.shares)) {
    missing.push('shares.value');
  }
  if (missing.length > 0) {
    return hardDecision(
      'Prediction market sell is missing required fields',
      'Tell me which market, which outcome, and how many shares you want to sell.',
      [],
      missing,
    );
  }
  return passDecision();
}

function validateResearchReport(slots: ResearchReportSlots): ValidatorDecision {
  if (!hasNonEmptyString(slots.task)) {
    return hardDecision(
      'Research intent requires a non-empty task',
      'Tell me what topic you want researched.',
      [],
      ['task'],
    );
  }
  return passDecision();
}

function validateAgentpaySend(
  slots: AgentpaySendSlots & { confirmed?: boolean },
): ValidatorDecision {
  const missing: string[] = [];
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (missing.length > 0) {
    const recipientHandle =
      isPlainObject(slots.recipient) && hasNonEmptyString(slots.recipient.handle)
        ? slots.recipient.handle
        : null;
    const clarification =
      missing.length === 1 && missing[0] === 'amount.value' && recipientHandle
        ? `How much do you want to send to ${recipientHandle}?`
        : missing.length === 1 && missing[0] === 'recipient' && hasPositiveAmount(slots.amount)
          ? 'Who do you want to send it to?'
          : 'Tell me who to send money to and how much to send.';
    return hardDecision(
      'AgentPay send requires a recipient and a positive amount',
      clarification,
      [],
      missing,
    );
  }

  const hasHandleOnly =
    isPlainObject(slots.recipient) &&
    hasNonEmptyString(slots.recipient.handle) &&
    !isValidHexAddress(slots.resolved_address) &&
    !isValidHexAddress(slots.recipient.address);

  if (slots.confirmed === true && hasHandleOnly) {
    return hardDecision(
      'Cannot confirm a payment send without a resolved address',
      'I need to resolve that recipient before sending. Please confirm the address or let me resolve the handle first.',
      ['recipient.handle', 'amount.value'],
      ['resolved_address'],
    );
  }

  if (hasHandleOnly) {
    return softDecision(
      'Recipient handle is present without a resolved address; downstream resolution is required',
      ['recipient.handle', 'amount.value'],
      ['resolved_address'],
    );
  }

  return passDecision();
}

function validateAgentpayRequest(slots: AgentpayRequestSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (missing.length > 0) {
    const recipientHandle =
      isPlainObject(slots.recipient) && hasNonEmptyString(slots.recipient.handle)
        ? slots.recipient.handle
        : null;
    const clarification =
      missing.length === 1 && missing[0] === 'amount.value' && recipientHandle
        ? `How much do you want to request from ${recipientHandle}?`
        : missing.length === 1 && missing[0] === 'recipient' && hasPositiveAmount(slots.amount)
          ? 'Who should receive the payment request?'
          : 'Tell me who should receive the request and how much to request.';
    return hardDecision(
      'AgentPay request requires a recipient and a positive amount',
      clarification,
      [],
      missing,
    );
  }
  return passDecision();
}

function validateAgentpayPaymentLink(slots: AgentpayPaymentLinkSlots): ValidatorDecision {
  if (!hasRecipient(slots.recipient)) {
    return hardDecision(
      'Payment link requires a recipient',
      'Who should the payment link point to? For example: "payment link for jack.arc 5 USDC for coffee".',
      [],
      ['recipient'],
    );
  }
  if (!hasPositiveAmount(slots.amount)) {
    return softDecision(
      'Payment link amount is missing; an open-ended link can still be created',
      ['recipient'],
      ['amount.value'],
    );
  }
  return passDecision();
}

function validateContactsCreate(slots: ContactsCreateSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasNonEmptyString(slots.name)) {
    missing.push('name');
  }
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (missing.length > 0) {
    return hardDecision(
      'Contact creation requires a name and a recipient',
      'Tell me the contact name and the handle or address to save.',
      [],
      missing,
    );
  }
  return passDecision();
}

function validateContactsUpdate(slots: ContactsUpdateSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasNonEmptyString(slots.name)) {
    missing.push('name');
  }
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (missing.length > 0) {
    return hardDecision(
      'Contact update requires the contact name and a new recipient value',
      'Tell me which contact to update and the new handle or address.',
      [],
      missing,
    );
  }
  return passDecision();
}

function validateContactsDelete(slots: ContactsDeleteSlots): ValidatorDecision {
  if (!hasNonEmptyString(slots.name)) {
    return hardDecision(
      'Contact delete requires a contact name',
      'Tell me which contact you want to delete.',
      [],
      ['name'],
    );
  }
  return passDecision();
}

function validateScheduleCreate(slots: ScheduleCreateSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (!hasNonEmptyString(slots.schedule?.cadence)) {
    missing.push('schedule.cadence');
  }
  if (missing.length > 0) {
    const recipientHandle =
      isPlainObject(slots.recipient) && hasNonEmptyString(slots.recipient.handle)
        ? slots.recipient.handle
        : null;
    const clarification =
      missing.length === 1 && missing[0] === 'schedule.cadence'
        ? 'How often should I send it?'
        : missing.length === 1 && missing[0] === 'amount.value' && recipientHandle
          ? `How much should I send to ${recipientHandle} each time?`
          : missing.length === 1 && missing[0] === 'recipient' && hasPositiveAmount(slots.amount)
            ? 'Who should receive the scheduled payment?'
            : 'Tell me who to pay, how much, and how often.';
    return hardDecision(
      'Scheduled payment requires recipient, amount, and cadence',
      clarification,
      [],
      missing,
    );
  }
  return passDecision();
}

function validateScheduleCancel(slots: ScheduleCancelSlots): ValidatorDecision {
  const hasPaymentId = hasNonEmptyString(slots.payment_id);
  const hasRecipientFilter = hasRecipient(slots.recipient_filter);
  const hasAmount = hasPositiveAmount(slots.amount);
  const hasCadence = hasNonEmptyString(slots.schedule?.cadence);

  if (hasPaymentId || (hasRecipientFilter && hasAmount && hasCadence)) {
    return passDecision();
  }

  return hardDecision(
    'Scheduled payment cancellation is missing disambiguating information',
    "Which scheduled payment? Reply 'list scheduled' to see them.",
    [
      hasPaymentId ? 'payment_id' : '',
      hasRecipientFilter ? 'recipient_filter' : '',
      hasAmount ? 'amount.value' : '',
      hasCadence ? 'schedule.cadence' : '',
    ].filter(Boolean),
    ['payment_id or recipient_filter + amount.value + schedule.cadence'],
  );
}

function validateSplitExecute(slots: SplitExecuteSlots): ValidatorDecision {
  if (!hasPositiveAmount(slots.total_amount)) {
    return hardDecision(
      'Split requires a positive total amount',
      'What total amount do you want to split?',
      [],
      ['total_amount.value'],
    );
  }
  if (!Array.isArray(slots.recipients) || slots.recipients.length < 2) {
    return hardDecision(
      'Split requires at least two recipients',
      'Who should I split it between? Please give me at least two recipients.',
      ['total_amount.value'],
      ['recipients[2+]'],
    );
  }
  const invalidRecipient = slots.recipients.some((recipient) => !hasRecipient(recipient));
  if (invalidRecipient) {
    return hardDecision(
      'Every split recipient must include a handle or address',
      'One or more recipients is incomplete. Please provide each recipient handle or address.',
      ['total_amount.value'],
      ['recipients[*]'],
    );
  }
  return passDecision();
}

function validateBatchExecute(slots: BatchExecuteSlots): ValidatorDecision {
  if (!Array.isArray(slots.payments) || slots.payments.length < 1) {
    return hardDecision(
      'Batch execution requires at least one payment',
      'Tell me at least one payment with a recipient and amount.',
      [],
      ['payments[1+]'],
    );
  }

  for (const payment of slots.payments) {
    if (!hasRecipient(payment.recipient) || !hasPositiveAmount(payment.amount)) {
      return hardDecision(
        'Each batch payment requires a recipient and a positive amount',
        'One or more batch payments is incomplete. Please provide a recipient and amount for each row.',
        [],
        ['payments[*].recipient', 'payments[*].amount.value'],
      );
    }
  }

  return passDecision();
}

function validateInvoiceCreate(slots: InvoiceCreateSlots): ValidatorDecision {
  const missing: string[] = [];
  if (!hasRecipient(slots.recipient)) {
    missing.push('recipient');
  }
  if (!hasPositiveAmount(slots.amount)) {
    missing.push('amount.value');
  }
  if (!hasNonEmptyString(slots.description)) {
    missing.push('description');
  }
  if (missing.length > 0) {
    return hardDecision(
      'Invoice creation requires recipient, amount, and description',
      'Tell me who the invoice is for, the amount, and what it covers.',
      [],
      missing,
    );
  }
  return passDecision();
}

function validateAttachment(
  slots: VisionAnalyzeSlots | TranscribeTranscribeSlots,
  expectedKind: AttachmentSlot['kind'],
  clarification: string,
): ValidatorDecision {
  if (!isPlainObject(slots.attachment) || slots.attachment.kind !== expectedKind) {
    return hardDecision(
      `Expected an attachment of kind ${expectedKind}`,
      clarification,
      [],
      ['attachment'],
    );
  }
  return passDecision();
}

function runIntentValidation(intent: AgentFlowIntent): ValidatorDecision {
  switch (intent.intent) {
    case AgentFlowIntentName.BalanceGet:
    case AgentFlowIntentName.PortfolioReport:
    case AgentFlowIntentName.VaultList:
    case AgentFlowIntentName.VaultPosition:
    case AgentFlowIntentName.BridgePrecheck:
    case AgentFlowIntentName.PredmarketList:
    case AgentFlowIntentName.PredmarketPosition:
    case AgentFlowIntentName.AgentpayHistory:
    case AgentFlowIntentName.ContactsList:
    case AgentFlowIntentName.ScheduleList:
    case AgentFlowIntentName.InvoiceStatus:
    case AgentFlowIntentName.TreasuryStatus:
    case AgentFlowIntentName.TreasuryTopup:
    case AgentFlowIntentName.GeneralChat:
      return passDecision();
    case AgentFlowIntentName.SwapExecute:
      return validateSwapExecute(intent.slots as SwapExecuteSlots, intent.raw_message);
    case AgentFlowIntentName.VaultDeposit:
      return validateAmountAction(
        intent.slots as VaultDepositSlots,
        'Tell me how much you want to deposit into the vault.',
      );
    case AgentFlowIntentName.VaultWithdraw:
      return validateAmountAction(
        intent.slots as VaultWithdrawSlots,
        'Tell me how much you want to withdraw from the vault.',
      );
    case AgentFlowIntentName.BridgeExecute:
      return validateBridgeExecute(intent.slots as BridgeExecuteSlots);
    case AgentFlowIntentName.PredmarketDetail:
      return validateMarketAddress(
        intent.slots as PredmarketDetailSlots,
        'Please provide the prediction market address you want to inspect.',
      );
    case AgentFlowIntentName.PredmarketRedeem:
      return validateMarketAddress(
        intent.slots as PredmarketRedeemSlots,
        'Please provide the prediction market address you want to redeem.',
      );
    case AgentFlowIntentName.PredmarketRefund:
      return validateMarketAddress(
        intent.slots as PredmarketRefundSlots,
        'Please provide the prediction market address you want refunded.',
      );
    case AgentFlowIntentName.PredmarketBuy:
      return validatePredmarketBuy(intent.slots as PredmarketBuySlots);
    case AgentFlowIntentName.PredmarketSell:
      return validatePredmarketSell(intent.slots as PredmarketSellSlots);
    case AgentFlowIntentName.ResearchReport:
      return validateResearchReport(intent.slots as ResearchReportSlots);
    case AgentFlowIntentName.AgentpaySend:
      return validateAgentpaySend(intent.slots as AgentpaySendSlots & { confirmed?: boolean });
    case AgentFlowIntentName.AgentpayRequest:
      return validateAgentpayRequest(intent.slots as AgentpayRequestSlots);
    case AgentFlowIntentName.AgentpayPaymentLink:
      return validateAgentpayPaymentLink(intent.slots as AgentpayPaymentLinkSlots);
    case AgentFlowIntentName.ContactsCreate:
      return validateContactsCreate(intent.slots as ContactsCreateSlots);
    case AgentFlowIntentName.ContactsUpdate:
      return validateContactsUpdate(intent.slots as ContactsUpdateSlots);
    case AgentFlowIntentName.ContactsDelete:
      return validateContactsDelete(intent.slots as ContactsDeleteSlots);
    case AgentFlowIntentName.ScheduleCreate:
      return validateScheduleCreate(intent.slots as ScheduleCreateSlots);
    case AgentFlowIntentName.ScheduleCancel:
      return validateScheduleCancel(intent.slots as ScheduleCancelSlots);
    case AgentFlowIntentName.SplitExecute:
      return validateSplitExecute(intent.slots as SplitExecuteSlots);
    case AgentFlowIntentName.BatchExecute:
      return validateBatchExecute(intent.slots as BatchExecuteSlots);
    case AgentFlowIntentName.InvoiceCreate:
      return validateInvoiceCreate(intent.slots as InvoiceCreateSlots);
    case AgentFlowIntentName.VisionAnalyze:
      return validateAttachment(
        intent.slots as VisionAnalyzeSlots,
        'image',
        'Please attach an image to analyze.',
      );
    case AgentFlowIntentName.TranscribeTranscribe:
      return validateAttachment(
        intent.slots as TranscribeTranscribeSlots,
        'audio',
        'Please attach an audio file to transcribe.',
      );
    default:
      return passDecision();
  }
}

export function validateIntent(intent: AgentFlowIntent): ValidationResult {
  const normalizedIntent = normalizeIntent(intent);
  const decision = runIntentValidation(normalizedIntent);

  console.info('[VALIDATOR_REQUEST]', {
    intent: normalizedIntent.intent,
    confidence: normalizedIntent.confidence,
    severity: decision.severity,
  });

  if (decision.severity === 'soft') {
    console.warn('[VALIDATOR_SOFT]', {
      intent: normalizedIntent.intent,
      reason: decision.reason,
      slots_present: decision.slots_present ?? [],
      slots_missing: decision.slots_missing ?? [],
    });
  }

  if (decision.severity === 'hard') {
    console.error('[VALIDATOR_HARD_FAIL]', {
      intent: normalizedIntent.intent,
      reason: decision.reason,
      slots_present: decision.slots_present ?? [],
      slots_missing: decision.slots_missing ?? [],
    });
  }

  return {
    ok: decision.ok,
    intent: normalizedIntent,
    reason: decision.reason,
    clarification: decision.clarification,
    severity: decision.severity,
    slots_present: decision.slots_present,
    slots_missing: decision.slots_missing,
  };
}
