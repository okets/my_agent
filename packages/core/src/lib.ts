// Public API for consumption by other packages (dashboard, plugins)
export { createBrainQuery, streamResponse } from './brain.js'
export type {
  BrainSessionOptions,
  ContentBlock,
  TextBlock,
  ImageBlock,
  PromptContent,
} from './brain.js'
export type { Query } from '@anthropic-ai/claude-agent-sdk'

export { loadConfig, findAgentDir, loadAgentName, saveChannelToConfig } from './config.js'
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

// Channel types
export { toDisplayStatus, initialStatus } from './channels/index.js'
export type {
  ChannelDisplayStatus,
  ChannelStatus,
  ReconnectPolicy,
  WatchdogConfig,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
  ChannelInstanceConfig,
  ChannelPlugin,
  PluginFactory,
  ChannelInfo,
} from './channels/index.js'

// Utilities
export { computeBackoff, DEFAULT_BACKOFF, DedupCache, MessageDebouncer } from './utils/index.js'
export type { DedupOptions, DebouncerOptions, DebouncedMessage } from './utils/index.js'

// Calendar system
export {
  assembleCalendarContext,
  invalidateCalendarContextCache,
  loadCalendarConfig,
  loadCalendarCredentials,
  getRadicaleUrl,
  initializeCalendars,
  checkRadicaleHealth,
  createCalDAVClient,
  CalDAVClient,
} from './calendar/index.js'
export type {
  CalendarEvent,
  CreateEventInput,
  UpdateEventInput,
  Calendar,
  RecurringEditMode,
  CalendarRepository,
  CalendarHealth,
  CalendarConfig,
  CalendarCredentials,
} from './calendar/index.js'
export type { AssemblePromptOptions } from './prompt.js'
