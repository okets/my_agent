/**
 * Visual Augmentation Hook
 *
 * Post-response hook that checks if the brain's response contains
 * chartable data but no visual was generated. If so, Haiku generates
 * an SVG chart and appends it as a follow-up message.
 *
 * This is the safety net for the visual-presenter skill — when the
 * brain follows the skill, create_chart/fetch_image is called during
 * the turn and this hook is a no-op. When the brain skips it, this
 * catches it.
 */

import { handleCreateChart } from "../mcp/chart-server.js";
import { queryModel } from "../scheduler/query-model.js";
import type { VisualActionService } from "../visual/visual-action-service.js";
import type { ConversationManager } from "../conversations/manager.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";

export interface VisualAugmentationDeps {
  visualService: VisualActionService;
  conversationManager: ConversationManager;
  connectionRegistry: ConnectionRegistry;
  log: (msg: string) => void;
}

const ANALYSIS_PROMPT = `Does this assistant response contain 3 or more numeric data points that show a trend, comparison, or distribution over time?

Rules:
- Daily readings (AQI, temperature, prices) over 3+ days → YES
- Weekly/monthly stats with 3+ values → YES
- Performance metrics, budget breakdowns with 3+ items → YES
- Casual number mentions ("I bought 3 apples, called 2 people") → NO
- A single stat or 1-2 numbers → NO
- Lists without numeric values → NO

Reply with EXACTLY one line:
- NO
- YES: <one-line chart description, e.g. "AQI trend Mon-Fri">`;

const CHART_PROMPT = `Generate an SVG chart for the data in this text. Output ONLY the raw SVG, no markdown fences, no explanation.

Rules:
- <svg xmlns="http://www.w3.org/2000/svg" width="600" height="350">
- Use inline style="" attributes, NOT <style> blocks
- Font: sans-serif only
- Colors (Tokyo Night): background #1a1b26, panel #292e42, text #c0caf5, muted #565f89, accent #7aa2f7, purple #bb9af7, pink #f7768e, green #9ece6a, yellow #e0af68
- Include axis labels, data point values, and a title
- Keep it clean and readable
- Round corners on the background rect (rx="12")`;

/**
 * Check if the brain's response should be augmented with a chart.
 * Returns true if a chart was appended.
 */
export async function maybeAugmentWithVisual(
  conversationId: string,
  assistantContent: string,
  imagesStoredDuringTurn: number,
  turnNumber: number,
  deps: VisualAugmentationDeps,
): Promise<boolean> {
  // Brain already generated visuals — skip
  if (imagesStoredDuringTurn > 0) return false;

  // Quick heuristics: skip short responses or responses without enough numbers
  if (assistantContent.length < 80) return false;
  const numbers = assistantContent.match(/\d+/g) || [];
  if (numbers.length < 3) return false;

  try {
    // Phase 1: Ask Haiku if this warrants a chart
    const analysis = await queryModel(
      `Assistant response:\n\n${assistantContent}`,
      ANALYSIS_PROMPT,
      "haiku",
    );

    if (!analysis.startsWith("YES:")) {
      deps.log("[VisualAugmentation] Haiku says no chart needed");
      return false;
    }

    const chartDescription = analysis.replace("YES:", "").trim();
    deps.log(`[VisualAugmentation] Generating chart: ${chartDescription}`);

    // Phase 2: Generate SVG with Haiku
    const svgResponse = await queryModel(
      `Data to chart (${chartDescription}):\n\n${assistantContent}`,
      CHART_PROMPT,
      "haiku",
    );

    // Extract SVG from response (might have stray text)
    const svgMatch = svgResponse.match(/<svg[\s\S]*<\/svg>/);
    if (!svgMatch) {
      deps.log("[VisualAugmentation] Haiku didn't produce valid SVG");
      return false;
    }

    // Phase 3: Store via create_chart
    const result = await handleCreateChart(
      { visualService: deps.visualService },
      { svg: svgMatch[0], description: chartDescription },
    );

    if (result.isError) {
      deps.log(`[VisualAugmentation] create_chart failed: ${JSON.stringify(result.content)}`);
      return false;
    }

    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);

    // Phase 4: Append follow-up assistant turn with the chart
    const chartContent = `![${chartDescription}](${parsed.url})`;
    const chartTurn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: chartContent,
      timestamp: new Date().toISOString(),
      turnNumber: turnNumber + 1,
    };

    await deps.conversationManager.appendTurn(conversationId, chartTurn);

    // Broadcast to connected clients — simulate a complete message stream
    deps.connectionRegistry.broadcastToConversation(conversationId, {
      type: "start" as const,
    });
    deps.connectionRegistry.broadcastToConversation(conversationId, {
      type: "text_delta" as const,
      content: chartContent,
    });
    deps.connectionRegistry.broadcastToConversation(conversationId, {
      type: "done" as const,
    });

    deps.log(`[VisualAugmentation] Chart appended: ${parsed.url}`);
    return true;
  } catch (err) {
    deps.log(`[VisualAugmentation] Error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
