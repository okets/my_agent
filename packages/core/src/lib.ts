// Public API for consumption by other packages (dashboard, plugins)

// Plugin base types
export type { Plugin, PluginType, PluginState, HealthResult, PluginStatus } from './plugin/index.js'
export { HealthMonitor } from './plugin/index.js'
export type { HealthSnapshot, HealthChangedEvent, HealthMonitorOptions } from './plugin/index.js'

export { createBrainQuery, streamResponse } from './brain.js'
export type {
  BrainSessionOptions,
  SystemPromptBlock,
  ContentBlock,
  TextBlock,
  ImageBlock,
  PromptContent,
} from './brain.js'
export type {
  Query,
  HookEvent,
  HookCallbackMatcher,
  AgentDefinition,
} from '@anthropic-ai/claude-agent-sdk'

// MCP servers (M6.5-S1)
export { createMemoryServer, createChannelServer, createTaskServer } from './mcp/index.js'
export type { MemoryServerDeps } from './mcp/index.js'

// Subagent definitions (M6.5-S1)
export { coreAgents } from './agents/index.js'

// Hooks (M6.5-S1)
export {
  createHooks,
  createAuditHook,
  createBashBlocker,
  createPathRestrictor,
} from './hooks/index.js'
export type { TrustLevel, HookFactoryOptions } from './hooks/index.js'

export {
  loadConfig,
  findAgentDir,
  loadAgentName,
  loadAgentNickname,
  loadAgentFullName,
  saveChannelToConfig,
  removeChannelFromConfig,
  loadEmbeddingsConfig,
  saveEmbeddingsConfig,
  loadPreferences,
  loadModels,
  DEFAULT_MODELS,
} from './config.js'
export type { YamlEmbeddingsConfig, UserPreferences, DebriefPreferences, ModelDefaults } from './config.js'
export type { BrainConfig, HealthConfig } from './types.js'

export { assembleSystemPrompt, loadProperties } from './prompt.js'

export { resolveAuth, validateSetupToken, isAuthenticated, clearAuth } from './auth.js'
export type { ResolvedAuth } from './auth.js'

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

// Env utility
export { getEnvValue, setEnvValue, removeEnvValue, getAllSecrets } from './env.js'

// Skill filtering
export { filterSkillsByTools, cleanupSkillFilters } from './skill-filter.js'

// Skills health check (M6.8-S2)
export { checkSkillsHealth } from './skills-health.js'

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
  CalendarScheduler,
  defaultEventHandler,
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
  SchedulerConfig,
  SchedulerStatus,
  FiredEventRecord,
} from './calendar/index.js'
export type { AssemblePromptOptions, ScheduledTaskContext } from './prompt.js'

// Task types
export type {
  Task,
  TaskStatus,
  TaskType,
  SourceType,
  CreatedBy,
  CreateTaskInput,
  ListTasksFilter,
  GetLogOptions,
  WorkItem,
  DeliveryAction,
  NotifyOnCompletion,
} from './tasks/types.js'

// Tools
export {
  NotebookEditor,
  initializeStandingOrders,
  getStandingOrdersTemplate,
} from './tools/index.js'
export type {
  NotebookOperation,
  NotebookEditParams,
  NotebookEditResult,
  NotebookEditorConfig,
} from './tools/index.js'

// Notifications
export { NotificationService } from './notifications/index.js'
export type {
  NotificationServiceConfig,
  NotificationImportance,
  EscalationSeverity,
  NotificationStatus,
  NotificationType,
  Notification,
  InputOption,
  InputRequest,
  Escalation,
  AnyNotification,
  NotifyInput,
  RequestInputInput,
  EscalateInput,
  NotificationEvent,
} from './notifications/index.js'

// Memory system
export {
  MemoryDb,
  SyncService,
  SearchService,
  initNotebook,
  migrateToNotebook,
  needsMigration,
  createStarterNotebook,
  chunkMarkdown,
  hashFileContent,
  PluginRegistry,
  LocalEmbeddingsPlugin,
  OllamaEmbeddingsPlugin,
  // Tools (M6-S2)
  recall,
  notebookRead,
  formatRecallResults,
  remember,
  dailyLog,
  notebookWrite,
  conversationSearch,
  formatConversationSearchResults,
  getPreCompactionFlushMessage,
  shouldFlushBeforeCompaction,
} from './memory/index.js'
export type {
  FileRecord,
  Chunk,
  SearchResult,
  RecallResult,
  SearchOptions,
  SyncResult,
  SyncOptions,
  IndexMeta,
  MemoryStatus,
  EmbeddingsPlugin,
  InitializeOptions,
  PluginConfig,
  EmbeddingsConfig,
  SyncServiceOptions,
  SearchServiceOptions,
  // Tool types (M6-S2)
  NotebookReadOptions,
  RememberCategory,
  RememberParams,
  RememberResult,
  DailyLogParams,
  DailyLogResult,
  NotebookWriteParams,
  NotebookWriteResult,
  ConversationSearchParams,
  ConversationSearchResult,
  ConversationSearchResponse,
  RawConversationSearchResult,
  ConversationMetadata,
} from './memory/index.js'
