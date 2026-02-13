// Public API for consumption by other packages (dashboard, plugins)
export { createBrainQuery, streamResponse } from './brain.js'
export type { BrainSessionOptions } from './brain.js'

export { loadConfig, findAgentDir } from './config.js'
export type { BrainConfig } from './types.js'

export { assembleSystemPrompt } from './prompt.js'

export { resolveAuth, readAuthFile, writeAuthFile, validateSetupToken } from './auth.js'
export type { AuthProfile, ResolvedAuth } from './auth.js'

export { isHatched, allSteps } from './hatching/index.js'
export type { HatchingStep } from './hatching/index.js'
