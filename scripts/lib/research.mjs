/**
 * Research pass: Claude checks each candidate leg on the web (injuries,
 * lineups, rotation, motivation, stand-ins, goalies, pitchers...) and returns a
 * bounded probability adjustment or an exclusion. Prices never come from
 * here — they stay the Polymarket ones — so the model cannot invent odds.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

// Bounds from the analyst rules, in probability points.
const BOUNDS = {
  core: { up: 5, down: 5 },
  high_confidence: { up: 3, down: 10 },
};

const SYSTEM = `You are a disciplined sports-betting analyst. You are given candidate parlay legs priced from Polymarket (a sharp market). Prices are already de-vigged into p_market. Your job is to research each leg on the web and decide whether to keep it, and whether evidence justifies nudging its probability.

Principles:
- Market first. The price is the best single estimate; research only nudges it.
- Core lane (football, CS2): adjust by at most ±5 points. High-confidence lane (other sports): at most +3 or −10 points.
- Every non-zero adjustment needs a specific reason with a source you actually read today.
- Exclude a leg when: key injury or availability news is unconfirmed; a CS2 roster uses a stand-in or has visa problems; the match is a dead rubber or heavy rotation is likely; the price drifted 5%+ in the last 24h without an explanation; or you cannot verify the fixture (date, teams, competition, not a youth/B/women's side with the same name).
- Pre-mortem: for every leg write the single most likely way it loses, then look for evidence of exactly that. If you find it, exclude or lower.

Checklists:
- Football: injuries, suspensions, probable lineups; rotation (midweek Europe, cup priorities); motivation; xG form over 6–10 games; venue and travel; manager changes.
- CS2: HLTV/VRS ranking and 3-month form; stand-ins and roster changes; map pools and likely veto; Bo3+ on LAN; fatigue.
- Tennis: fitness, fatigue from previous round, surface, best-of-5 vs 3, retirement risk.
- Basketball: official injury report, rest/load management, back-to-backs.
- Ice hockey: confirmed starting goalie, back-to-backs.
- American football: QB and key injuries, weather.
- Baseball: confirmed starting pitchers, bullpen usage.
- MMA: weigh-in results, short-notice replacements.
- Other esports: tier-1, Bo3+, stand-ins, patch changes.

Never invent injuries, lineups, rankings or results. If you are unsure, adjust toward zero or exclude. Never call anything a lock.

When you are done, call submit_research exactly once with an entry for every candidate id.`;

const SUBMIT_TOOL = {
  name: 'submit_research',
  description:
    'Submit the research verdict for every candidate leg. Call exactly once, after researching, with one entry per candidate id.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'legs'],
    properties: {
      summary: { type: 'string', description: 'Two sentences on the day overall.' },
      legs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'exclude', 'adjustment_pp', 'reason', 'main_risk'],
          properties: {
            id: { type: 'string' },
            exclude: { type: 'boolean' },
            adjustment_pp: {
              type: 'number',
              description: 'Probability change in percentage points, e.g. 2 or -4.',
            },
            reason: { type: 'string', description: 'One line, with the source.' },
            main_risk: { type: 'string', description: 'One line: the most likely way it loses.' },
          },
        },
      },
    },
  },
};

function describe(legs) {
  return legs
    .map(
      (l) =>
        `- id=${l.id} | ${l.league} | ${l.event} | starts ${l.start} UTC | lane=${l.lane} | ${l.label}: ${l.selection} | p_market=${(l.p_market * 100).toFixed(1)}% | fair odds ${l.odds}`
    )
    .join('\n');
}

function validate(input, legs) {
  if (!input || !Array.isArray(input.legs)) return null;
  const byId = new Map(legs.map((l) => [l.id, l]));
  const verdicts = new Map();
  for (const v of input.legs) {
    const leg = byId.get(v?.id);
    if (!leg || typeof v.exclude !== 'boolean') continue;
    const bound = BOUNDS[leg.lane];
    const pp = Math.max(-bound.down, Math.min(bound.up, Number(v.adjustment_pp) || 0));
    verdicts.set(leg.id, {
      exclude: v.exclude,
      adjustment_pp: pp,
      reason: String(v.reason || '').slice(0, 300),
      main_risk: String(v.main_risk || '').slice(0, 300),
    });
  }
  return { summary: String(input.summary || '').slice(0, 600), verdicts };
}

/**
 * Returns { summary, verdicts: Map<id, verdict> } or null when research is
 * unavailable (no key, refusal, or no verdict submitted). A leg missing from
 * verdicts was not researched and must not be used.
 */
export async function researchLegs(legs, { today }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();

  const messages = [
    {
      role: 'user',
      content: `Today is ${today} (Europe/Belgrade). Research these candidate legs and submit a verdict for each.\n\n${describe(legs)}`,
    },
  ];

  let nudged = false;
  for (let turn = 0; turn < 10; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 40 }, SUBMIT_TOOL],
      messages,
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      console.warn('Research declined:', message.stop_details?.category ?? 'unknown');
      return null;
    }

    const call = message.content.find((b) => b.type === 'tool_use' && b.name === 'submit_research');
    if (call) return validate(call.input, legs);

    messages.push({ role: 'assistant', content: message.content });
    if (message.stop_reason === 'pause_turn') continue;
    if (message.stop_reason === 'end_turn' && !nudged) {
      nudged = true;
      messages.push({ role: 'user', content: 'Now call submit_research with your verdicts.' });
      continue;
    }
    console.warn('Research ended without a verdict, stop_reason:', message.stop_reason);
    return null;
  }
  return null;
}
