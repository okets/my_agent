export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked'
export type TodoCreator = 'agent' | 'framework' | 'delegator'

export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
  mandatory: boolean
  validation?: string
  validation_attempts?: number
  notes?: string
  created_by: TodoCreator
}

export interface TodoFile {
  items: TodoItem[]
  last_activity: string // ISO timestamp, updated on every tool call
}

export interface TodoTemplate {
  items: Array<{
    text: string
    mandatory: boolean
    validation?: string
  }>
}

export interface ValidationResult {
  pass: boolean
  message?: string
}
