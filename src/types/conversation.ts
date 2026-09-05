/** Metadata we can obtain without reading message content. All optional until proven reliable. */
export interface Conversation {
  id: string;
  title: string;
  href?: string;
  createdAt?: number;
  updatedAt?: number;
  messageCount?: number;
  isPinned?: boolean;
  projectId?: string | null;
  archived?: boolean;
  isTemporary?: boolean;
  /** Where this record came from, so the spike can compare sources. */
  source: 'dom' | 'api';
}

/** All ChatGPT-specific behavior lives behind this. */
export interface ConversationAdapter {
  readonly name: string;
  listVisibleConversations(): Promise<Conversation[]>;
  archive(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}
