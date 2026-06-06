import { AgentFlowIntentName, type AgentFlowIntent } from './types';
import { parseSupportedBridgeSourceChain } from '../bridge/supportedSources';
import { stripPortfolioImpactPhrasing } from '../portfolio-impact-intent';
import { inferResearchReasoningMode, type ResearchReasoningMode } from '../researchMode';
import { AGENTPAY_SELF_RECIPIENT_HANDLE, extractAgentpayRemark } from '../agentpay-remark';

function inferAgentpayRemark(rawMessage: string, existingRemark: unknown): string | undefined {
  if (typeof existingRemark === 'string' && existingRemark.trim()) {
    return existingRemark.trim();
  }
  return extractAgentpayRemark(rawMessage);
}

function resolvePredmarketOutcomeIndex(outcome: { index?: unknown; label?: unknown } | undefined): number | null {
  if (typeof outcome?.index === 'number' && Number.isInteger(outcome.index) && outcome.index >= 0) {
    return outcome.index;
  }

  const label = typeof outcome?.label === 'string' ? outcome.label.trim().toLowerCase() : '';
  if (!label) {
    return null;
  }
  if (label === 'yes') return 0;
  if (label === 'no') return 1;
  const indexedMatch = label.match(/^outcome\s*(\d+)$/i);
  if (indexedMatch) {
    return Number(indexedMatch[1]);
  }
  return null;
}

type WalletCtx = {
  walletAddress: string;
  executionWalletId?: string;
  executionWalletAddress?: string;
  executionTarget?: 'EOA' | 'DCW';
  profileContext?: string;
};

type QuickActionGroup = {
  title?: string;
  actions: Array<{
    label: string;
    prompt: string;
    tone?: 'primary' | 'secondary';
  }>;
};

type DispatchMeta = {
  quickActionGroups?: QuickActionGroup[];
  paymentLink?: {
    handle: string;
    displayHandle: string;
    amount: string | null;
    remark: string | null;
    path: string;
  };
  confirmation?: {
    required: boolean;
    action: 'schedule' | 'split' | 'invoice' | 'batch';
    confirmId?: string;
    confirmLabel?: string;
    choices?: Array<{ id: string; label: string; confirmId: string }>;
  };
};

export type IntentDispatchResult =
  | {
      handled: false;
      reason: 'fallthrough' | 'deferred';
    }
  | {
      handled: true;
      responseText: string;
      toolCalled: string | null;
      meta?: DispatchMeta;
      responseAlreadyStreamed?: boolean;
    };

type DispatcherDeps = {
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
    walletCtx: WalletCtx,
    sessionId: string,
    context?: { rawUserMessage?: string },
  ) => Promise<string>;
  runResearchReport: (
    researchTask: string,
    options?: { portfolioImpact?: boolean; reasoningMode?: ResearchReasoningMode },
  ) => Promise<IntentDispatchResult>;
  runSchedule: (intent: AgentFlowIntent, walletAddress: string) => Promise<IntentDispatchResult>;
  listContacts: (walletAddress: string) => Promise<IntentDispatchResult>;
  createContact: (
    walletAddress: string,
    name: string,
    recipient: { handle?: string; address?: string },
  ) => Promise<IntentDispatchResult>;
  updateContact: (
    walletAddress: string,
    name: string,
    recipient: { handle?: string; address?: string },
  ) => Promise<IntentDispatchResult>;
  deleteContact: (walletAddress: string, name: string) => Promise<IntentDispatchResult>;
  getAgentPayHistory: (walletAddress: string) => Promise<IntentDispatchResult>;
  buildPaymentLink: (
    recipient: { handle?: string; address?: string; registeredNameOwner?: string },
    amount?: number,
    remark?: string,
  ) => Promise<IntentDispatchResult>;
  runBatch: (intent: AgentFlowIntent, walletAddress: string, sessionId: string) => Promise<IntentDispatchResult>;
  runSplit: (intent: AgentFlowIntent, walletAddress: string, sessionId: string) => Promise<IntentDispatchResult>;
  createInvoice: (
    intent: AgentFlowIntent,
    walletAddress: string,
    sessionId: string,
  ) => Promise<IntentDispatchResult>;
  getInvoiceStatus: (walletAddress: string) => Promise<IntentDispatchResult>;
};

export async function dispatchIntent(input: {
  intent: AgentFlowIntent;
  walletCtx: WalletCtx;
  sessionId: string;
  deps: DispatcherDeps;
}): Promise<IntentDispatchResult> {
  const { intent, walletCtx, sessionId, deps } = input;
  const slots = intent.slots as Record<string, any>;
  const informationalPredmarketPattern =
    /^(?:\s*)(?:how|when|why|what|can|could|should|do|does|is|are)\b/i;
  const isInformationalPredmarketQuestion = (message: string): boolean =>
    informationalPredmarketPattern.test(message) &&
    /\b(redeem|refund|sell|buy|claim|winning|won|resolved|resolve)\b/i.test(message);
  switch (intent.intent) {
    case AgentFlowIntentName.BalanceGet:
      return {
        handled: true,
        responseText: await deps.executeTool('get_balance', {}, walletCtx, sessionId),
        toolCalled: 'get_balance',
      };
    case AgentFlowIntentName.PortfolioReport:
      return {
        handled: true,
        responseText: await deps.executeTool('get_portfolio', {}, walletCtx, sessionId),
        toolCalled: 'get_portfolio',
      };
    case AgentFlowIntentName.SwapExecute:
      return {
        handled: true,
        responseText: await deps.executeTool(
          'swap_tokens',
          {
            amount: slots.amount?.value,
            tokenIn: slots.token_in?.symbol,
            tokenOut: slots.token_out?.symbol,
            confirmed: slots.confirmed ?? false,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'swap_tokens',
      };
    case AgentFlowIntentName.VaultList:
    case AgentFlowIntentName.VaultPosition:
    case AgentFlowIntentName.VaultDeposit:
    case AgentFlowIntentName.VaultWithdraw: {
      const actionMap: Record<string, string> = {
        [AgentFlowIntentName.VaultList]: 'list',
        [AgentFlowIntentName.VaultPosition]: 'position',
        [AgentFlowIntentName.VaultDeposit]: 'deposit',
        [AgentFlowIntentName.VaultWithdraw]: 'withdraw',
      };

      return {
        handled: true,
        responseText: await deps.executeTool(
          'vault_action',
          {
            action: actionMap[intent.intent],
            amount: slots.amount?.value,
            amountTokenHint: slots.amount?.currency,
            confirmed: slots.confirmed ?? false,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'vault_action',
      };
    }
    case AgentFlowIntentName.BridgePrecheck:
      return {
        handled: true,
        responseText: await deps.executeTool(
          'bridge_precheck',
          {
            sourceChain: parseSupportedBridgeSourceChain(slots.chain?.source),
            amount: slots.amount?.value,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'bridge_precheck',
      };
    case AgentFlowIntentName.BridgeExecute:
      return {
        handled: true,
        responseText: [
          'Bridge to Arc starts from your connected wallet on the source chain and finishes in your AgentFlow wallet on Arc.',
          'Tell me the source chain and amount, like "bridge 10 USDC from Base Sepolia to Arc", or ask for the supported bridge source chains first.',
        ].join('\n'),
        toolCalled: 'bridge_precheck',
      };
    case AgentFlowIntentName.PredmarketList:
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'list',
            filter: slots.filter,
            listMode: slots.pagination?.mode,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketDetail:
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'detail',
            marketAddress: slots.market?.address,
            provider: slots.provider ?? 'achmarket',
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketPosition:
      return {
        handled: true,
        responseText: await deps.executeTool('predict_action', { action: 'position' }, walletCtx, sessionId),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketBuy:
      if (resolvePredmarketOutcomeIndex(slots.outcome) === null) {
        return {
          handled: true,
          responseText: 'Tell me which outcome you want for that market.',
          toolCalled: null,
        };
      }
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'buy',
            marketAddress: slots.market?.address,
            outcomeIdx: resolvePredmarketOutcomeIndex(slots.outcome),
            amount: slots.amount?.value,
            confirmed: slots.confirmed ?? false,
            provider: slots.provider ?? 'achmarket',
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketSell:
      if (resolvePredmarketOutcomeIndex(slots.outcome) === null) {
        return {
          handled: true,
          responseText: 'Tell me which outcome shares you want to sell for that market.',
          toolCalled: null,
        };
      }
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'sell',
            marketAddress: slots.market?.address,
            outcomeIdx: resolvePredmarketOutcomeIndex(slots.outcome),
            sharesWad: slots.shares?.value,
            confirmed: slots.confirmed ?? false,
            provider: slots.provider ?? 'achmarket',
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketRedeem:
      if (isInformationalPredmarketQuestion(intent.raw_message)) {
        return { handled: false, reason: 'fallthrough' };
      }
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'redeem',
            marketAddress: slots.market?.address,
            confirmed: false,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.PredmarketRefund:
      if (isInformationalPredmarketQuestion(intent.raw_message)) {
        return { handled: false, reason: 'fallthrough' };
      }
      return {
        handled: true,
        responseText: await deps.executeTool(
          'predict_action',
          {
            action: 'refund',
            marketAddress: slots.market?.address,
            confirmed: false,
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'predict_action',
      };
    case AgentFlowIntentName.ResearchReport:
      return walletCtx.walletAddress
        ? deps.runResearchReport(
            stripPortfolioImpactPhrasing(
              typeof slots.task === 'string' && slots.task.trim() ? slots.task.trim() : intent.raw_message,
            ),
            {
              portfolioImpact: slots.portfolio_impact === true,
              reasoningMode: inferResearchReasoningMode({
                task: intent.raw_message,
                explicitMode: slots.reasoning_mode,
                deepResearch: slots.deep_research,
                defaultMode: 'fast',
              }),
            },
          )
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.ScheduleCreate:
    case AgentFlowIntentName.ScheduleCancel:
    case AgentFlowIntentName.ScheduleList:
      return walletCtx.walletAddress
        ? deps.runSchedule(intent, walletCtx.walletAddress)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.ContactsList:
      return walletCtx.walletAddress
        ? deps.listContacts(walletCtx.walletAddress)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.ContactsCreate:
      return walletCtx.walletAddress
        ? deps.createContact(
            walletCtx.walletAddress,
            String(slots.name || '').trim().toLowerCase(),
            slots.recipient || {},
          )
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.ContactsUpdate:
      return walletCtx.walletAddress
        ? deps.updateContact(
            walletCtx.walletAddress,
            String(slots.name || '').trim().toLowerCase(),
            slots.recipient || {},
          )
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.ContactsDelete:
      return walletCtx.walletAddress
        ? deps.deleteContact(walletCtx.walletAddress, String(slots.name || '').trim().toLowerCase())
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.AgentpayHistory:
      return walletCtx.walletAddress
        ? deps.getAgentPayHistory(walletCtx.walletAddress)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.AgentpayPaymentLink:
      return deps.buildPaymentLink(
        slots.recipient?.handle === AGENTPAY_SELF_RECIPIENT_HANDLE
          ? {
              address: walletCtx.walletAddress,
              registeredNameOwner: walletCtx.executionWalletAddress || walletCtx.walletAddress,
            }
          : slots.recipient || {},
        slots.amount?.value,
        inferAgentpayRemark(intent.raw_message, slots.remark),
      );
    case AgentFlowIntentName.BatchExecute:
      return walletCtx.walletAddress
        ? deps.runBatch(intent, walletCtx.walletAddress, sessionId)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.SplitExecute:
      return walletCtx.walletAddress
        ? deps.runSplit(intent, walletCtx.walletAddress, sessionId)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.InvoiceCreate:
      return walletCtx.walletAddress
        ? deps.createInvoice(intent, walletCtx.walletAddress, sessionId)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.InvoiceStatus:
      return walletCtx.walletAddress
        ? deps.getInvoiceStatus(walletCtx.walletAddress)
        : { handled: false, reason: 'fallthrough' };
    case AgentFlowIntentName.AgentpaySend:
      {
        const remark = inferAgentpayRemark(intent.raw_message, slots.remark);
      return {
        handled: true,
        responseText: await deps.executeTool(
          'agentpay_send',
          {
            to: slots.recipient?.handle || slots.recipient?.address || '',
            amount: String(slots.amount?.value || ''),
            remark,
          },
          walletCtx,
          sessionId,
          { rawUserMessage: intent.raw_message },
        ),
        toolCalled: 'agentpay_send',
      };
      }
    case AgentFlowIntentName.AgentpayRequest:
      {
        const remark = inferAgentpayRemark(intent.raw_message, slots.remark);
      return {
        handled: true,
        responseText: await deps.executeTool(
          'agentpay_request',
          {
            from:
              slots.recipient?.handle ||
              slots.recipient?.address ||
              '',
            amount: String(slots.amount?.value || ''),
            ...(remark ? { remark } : {}),
          },
          walletCtx,
          sessionId,
        ),
        toolCalled: 'agentpay_request',
      };
      }
    case AgentFlowIntentName.VisionAnalyze:
      // vision/transcribe attachment routing deferred until frontend attachment threading is unified
      return { handled: false, reason: 'deferred' };
    case AgentFlowIntentName.TranscribeTranscribe:
      // vision/transcribe attachment routing deferred until frontend attachment threading is unified
      return { handled: false, reason: 'deferred' };
    case AgentFlowIntentName.TreasuryStatus:
    case AgentFlowIntentName.TreasuryTopup:
      // treasury admin gate not yet implemented
      return { handled: false, reason: 'deferred' };
    case AgentFlowIntentName.GeneralChat:
    default:
      return { handled: false, reason: 'fallthrough' };
  }
}
