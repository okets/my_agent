/**
 * Connection Registry
 *
 * Tracks WebSocket connections and their associated conversations.
 * Supports multi-tab sync by broadcasting messages to all sockets viewing a conversation.
 */

import type { WebSocket } from "@fastify/websocket";
import type { ServerMessage } from "./protocol.js";

interface SocketInfo {
  socket: WebSocket;
  conversationId: string | null;
}

/**
 * Registry for tracking WebSocket connections per conversation
 */
export class ConnectionRegistry {
  private sockets = new Map<WebSocket, SocketInfo>();

  /**
   * Add a socket to the registry
   */
  add(socket: WebSocket, conversationId: string | null = null): void {
    this.sockets.set(socket, { socket, conversationId });
  }

  /**
   * Remove a socket from the registry
   */
  remove(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  /**
   * Switch a socket to a different conversation
   */
  switchConversation(socket: WebSocket, newConversationId: string): void {
    const info = this.sockets.get(socket);
    if (info) {
      info.conversationId = newConversationId;
    }
  }

  /**
   * Get the number of viewers for a conversation
   *
   * Used to determine if abbreviation should be queued when last viewer leaves.
   */
  getViewerCount(conversationId: string): number {
    let count = 0;
    for (const info of this.sockets.values()) {
      if (info.conversationId === conversationId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Broadcast a message to all sockets viewing a conversation
   *
   * @param conversationId - The conversation to broadcast to
   * @param message - The message to send
   * @param exclude - Optional socket to exclude from broadcast (e.g., the sender)
   */
  broadcastToConversation(
    conversationId: string,
    message: ServerMessage,
    exclude?: WebSocket,
  ): void {
    const payload = JSON.stringify(message);

    for (const info of this.sockets.values()) {
      if (
        info.conversationId === conversationId &&
        info.socket !== exclude &&
        info.socket.readyState === 1
      ) {
        // WebSocket.OPEN
        info.socket.send(payload);
      }
    }
  }

  /**
   * Broadcast a message to all connected sockets
   */
  broadcastToAll(message: ServerMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(message);

    for (const info of this.sockets.values()) {
      if (info.socket !== exclude && info.socket.readyState === 1) {
        info.socket.send(payload);
      }
    }
  }

  /**
   * Get the conversation ID for a socket
   */
  getConversationId(socket: WebSocket): string | null {
    return this.sockets.get(socket)?.conversationId ?? null;
  }

  /**
   * Get all active conversation IDs
   */
  getActiveConversations(): Set<string> {
    const active = new Set<string>();
    for (const info of this.sockets.values()) {
      if (info.conversationId) {
        active.add(info.conversationId);
      }
    }
    return active;
  }
}
