/**
 * Background Haiku query utility -- backward compatibility wrapper.
 *
 * Delegates to queryModel("haiku"). Existing callers continue working.
 * New code should import queryModel directly.
 */

import { queryModel } from "./query-model.js";

/**
 * @deprecated Use queryModel(prompt, systemPrompt, "haiku") instead.
 */
export async function queryHaiku(
  prompt: string,
  systemPrompt: string,
): Promise<string> {
  return queryModel(prompt, systemPrompt, "haiku");
}
