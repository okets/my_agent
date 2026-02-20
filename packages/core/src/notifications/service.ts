/**
 * Notification Service
 *
 * In-process notification routing service.
 * Provides notify/requestInput/escalate API.
 * Emits events for dashboard to consume via WebSocket.
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  AnyNotification,
  Notification,
  InputRequest,
  Escalation,
  NotifyInput,
  RequestInputInput,
  EscalateInput,
  NotificationEvent,
  InputOption,
} from './types.js'

/**
 * Configuration for NotificationService
 */
export interface NotificationServiceConfig {
  /** Max notifications to keep in memory */
  maxNotifications?: number
}

/**
 * NotificationService — routes notifications to dashboard
 */
export class NotificationService extends EventEmitter {
  private notifications: Map<string, AnyNotification> = new Map()
  private maxNotifications: number

  constructor(config: NotificationServiceConfig = {}) {
    super()
    this.maxNotifications = config.maxNotifications ?? 1000
  }

  /**
   * Create a simple notification (fire-and-forget)
   */
  notify(input: NotifyInput): Notification {
    const notification: Notification = {
      id: randomUUID(),
      type: 'notify',
      message: input.message,
      importance: input.importance ?? 'info',
      taskId: input.taskId,
      created: new Date(),
      status: 'pending',
    }

    this.addNotification(notification)
    this.emitEvent('notification:created', notification)

    return notification
  }

  /**
   * Create a request for user input
   */
  requestInput(input: RequestInputInput): InputRequest {
    // Normalize options to InputOption[]
    const options: InputOption[] = input.options.map((opt) =>
      typeof opt === 'string' ? { label: opt, value: opt } : opt,
    )

    const request: InputRequest = {
      id: randomUUID(),
      type: 'request_input',
      question: input.question,
      options,
      taskId: input.taskId,
      created: new Date(),
      status: 'pending',
    }

    this.addNotification(request)
    this.emitEvent('notification:created', request)

    return request
  }

  /**
   * Create an escalation (urgent notification)
   */
  escalate(input: EscalateInput): Escalation {
    const escalation: Escalation = {
      id: randomUUID(),
      type: 'escalate',
      problem: input.problem,
      severity: input.severity ?? 'medium',
      taskId: input.taskId,
      created: new Date(),
      status: 'pending',
    }

    this.addNotification(escalation)
    this.emitEvent('notification:created', escalation)

    return escalation
  }

  /**
   * Mark notification as delivered
   */
  markDelivered(id: string): boolean {
    const notification = this.notifications.get(id)
    if (!notification || notification.status !== 'pending') {
      return false
    }

    notification.status = 'delivered'
    this.emitEvent('notification:delivered', notification)
    return true
  }

  /**
   * Mark notification as read
   */
  markRead(id: string): boolean {
    const notification = this.notifications.get(id)
    if (!notification) {
      return false
    }

    notification.status = 'read'
    notification.readAt = new Date()
    this.emitEvent('notification:read', notification)
    return true
  }

  /**
   * Respond to an input request
   */
  respond(id: string, response: string): boolean {
    const notification = this.notifications.get(id)
    if (!notification || notification.type !== 'request_input') {
      return false
    }

    const request = notification as InputRequest
    request.response = response
    request.respondedAt = new Date()
    request.status = 'read'
    this.emitEvent('notification:responded', request)
    return true
  }

  /**
   * Dismiss a notification
   */
  dismiss(id: string): boolean {
    const notification = this.notifications.get(id)
    if (!notification) {
      return false
    }

    notification.status = 'dismissed'
    this.emitEvent('notification:read', notification)
    return true
  }

  /**
   * Get a notification by ID
   */
  get(id: string): AnyNotification | undefined {
    return this.notifications.get(id)
  }

  /**
   * Get all pending notifications (needs attention)
   */
  getPending(): AnyNotification[] {
    return Array.from(this.notifications.values())
      .filter((n) => n.status === 'pending' || n.status === 'delivered')
      .sort((a, b) => b.created.getTime() - a.created.getTime())
  }

  /**
   * Get pending input requests
   */
  getPendingInputRequests(): InputRequest[] {
    return this.getPending().filter((n) => n.type === 'request_input') as InputRequest[]
  }

  /**
   * Get all notifications (for history)
   */
  getAll(): AnyNotification[] {
    return Array.from(this.notifications.values()).sort(
      (a, b) => b.created.getTime() - a.created.getTime(),
    )
  }

  /**
   * Get notifications for a specific task
   */
  getForTask(taskId: string): AnyNotification[] {
    return Array.from(this.notifications.values())
      .filter((n) => n.taskId === taskId)
      .sort((a, b) => b.created.getTime() - a.created.getTime())
  }

  /**
   * Clear all notifications
   */
  clear(): void {
    this.notifications.clear()
  }

  /**
   * Add notification to store (with eviction)
   */
  private addNotification(notification: AnyNotification): void {
    // Evict oldest if at capacity
    if (this.notifications.size >= this.maxNotifications) {
      const oldest = Array.from(this.notifications.entries())
        .filter(([, n]) => n.status === 'read' || n.status === 'dismissed')
        .sort((a, b) => a[1].created.getTime() - b[1].created.getTime())[0]

      if (oldest) {
        this.notifications.delete(oldest[0])
      }
    }

    this.notifications.set(notification.id, notification)
  }

  /**
   * Emit typed notification event
   */
  private emitEvent(type: NotificationEvent['type'], notification: AnyNotification): void {
    const event: NotificationEvent = { type, notification }
    this.emit(type, event)
    this.emit('notification', event) // Generic event for all notifications
  }
}
