import * as prompts from '../lib/agentPrompts';
import { callHermesDeep, callHermesFast } from '../lib/hermes';
import { fetchLiveData } from '../lib/live-data';
import { finalizeReportMarkdown } from '../lib/reportPipeline';
import { buildAnalystModelInput, buildWriterModelInput } from '../lib/reportInputs';

const task = 'Iran-US Tensions and Global Shipping Routes Impact Report';

function safeParseObject(value: string): Record<string, unknown> {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const withoutTrailingCommas = cleaned.replace(/,\s*([}\]])/g, '$1');

  const extractBalancedObject = (input: string): string | null => {
    const start = input.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let index = start; index < input.length; index += 1) {
      const char = input[index];

      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === '\\') {
        escaping = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return input.slice(start, index + 1);
        }
      }
    }

    return null;
  };

  try {
    return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
  } catch {
    const balanced = extractBalancedObject(withoutTrailingCommas);
    if (balanced) {
      return JSON.parse(balanced.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
    }
    throw new Error('Unable to parse model output as JSON');
  }
}

async function main(): Promise<void> {
  const liveDataText = await fetchLiveData(task);
  const liveData = safeParseObject(liveDataText);

  const researchInput = `AS OF ${new Date().toISOString()}

LIVE DATA JSON:
${liveDataText}

USER TASK:
${task}

  Use the LIVE DATA JSON above for current figures and dated evidence. Verify the user's premise before accepting it. If the evidence supports only tensions, reported planning, isolated strikes, or older background context, say that plainly instead of repeating the user's framing. If LIVE DATA current_events framing_signals are present, follow them exactly for broader conflict status, Strait of Hormuz route status, and Red Sea route status.`;

  const researchText = await callHermesFast(prompts.RESEARCH_SYSTEM_PROMPT, researchInput);
  const research = safeParseObject(researchText);

  const analystText = await callHermesFast(
    prompts.ANALYST_SYSTEM_PROMPT,
    buildAnalystModelInput({ task, researchText, research, liveData }),
  );
  const analysis = safeParseObject(analystText);

  const writerText = await callHermesDeep(
    prompts.WRITER_SYSTEM_PROMPT,
    buildWriterModelInput({
      task,
      researchText,
      analysisText: analystText,
      research,
      analysis,
      liveData,
    }),
  );

  const finalReport = finalizeReportMarkdown({
    task,
    writerMarkdown: writerText,
    research,
    analysis,
    liveData,
  });

  const executiveSummary =
    finalReport.markdown.match(/## Executive Summary\n\n([\s\S]*?)\n\n## Current Status/i)?.[1] ??
    '';
  const currentStatus =
    finalReport.markdown.match(/## Current Status\n\n([\s\S]*?)\n\n## Reported Developments/i)?.[1] ??
    '';

  console.log(
    JSON.stringify(
      {
        framingSignals: (liveData.current_events as { framing_signals?: unknown } | undefined)
          ?.framing_signals,
        validationIssues: finalReport.validationIssues,
        executiveSummary,
        currentStatus,
        sources: finalReport.sources,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
