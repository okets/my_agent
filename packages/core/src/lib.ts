// Public API for consumption by other packages (dashboard, plugins)
export { createBrainQuery, streamResponse } from './brain.js'
export type { BrainSessionOptions } from './brain.js'
export type { Query } from '@anthropic-ai/claude-agent-sdk'

export { loadConfig, findAgentDir, loadAgentName } from './config.js'
export type { BrainConfig } from './types.js'

export { assembleSystemPrompt } from './prompt.js'

export { resolveAuth, readAuthFile, writeAuthFile, validateSetupToken } from './auth.js'
export type { AuthProfile, ResolvedAuth } from './auth.js'

export { isHatched, allSteps } from './hatching/index.js'
export type { HatchingStep } from './hatching/index.js'

export {
  createDirectoryStructure,
  writeMinimalConfig,
  writeHatchedMarker,
  writeIdentity,
  getPersonalities,
  applyPersonality,
  writeCustomPersonality,
  checkEnvAuth,
  saveAuth,
  writeOperatingRules,
} from './hatching/logic.js'
export type { IdentityData, PersonalityOption, OperatingRulesData } from './hatching/logic.js'
