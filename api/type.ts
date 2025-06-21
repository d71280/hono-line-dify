// 1. 共通のベースとなる型定義
export interface BaseEvent {
  type: string
  timestamp: number
  source: {
    type: "user" | "group" | "room"
    userId?: string
    groupId?: string
    roomId?: string
  }
}

// 2. 各イベントの型定義（例として主要なイベントのみ）
export interface MessageEvent extends BaseEvent {
  type: "message"
  replyToken: string
  message: Message
}

export type Message =
  | TextMessage
  | ImageMessage
  | VideoMessage
  | AudioMessage
  | FileMessage
  | LocationMessage
  | StickerMessage

interface BaseMessage {
  id: string
  type: string
}

interface TextMessage extends BaseMessage {
  type: "text"
  text: string
}

interface ImageMessage extends BaseMessage {
  type: "image"
  // 画像用の追加プロパティ（例: content providerなど）を必要に応じて定義
}

interface VideoMessage extends BaseMessage {
  type: "video"
  // 動画用の追加プロパティ
}

interface AudioMessage extends BaseMessage {
  type: "audio"
  // 音声用の追加プロパティ
}

interface FileMessage extends BaseMessage {
  type: "file"
  fileName: string
  fileSize: number
  // ファイル用の追加プロパティ
}

interface LocationMessage extends BaseMessage {
  type: "location"
  title: string
  address: string
  latitude: number
  longitude: number
}

interface StickerMessage extends BaseMessage {
  type: "sticker"
  packageId: string
  stickerId: string
}

interface FollowEvent extends BaseEvent {
  type: "follow"
  replyToken: string
}

interface UnfollowEvent extends BaseEvent {
  type: "unfollow"
}

interface JoinEvent extends BaseEvent {
  type: "join"
  replyToken: string
}

interface LeaveEvent extends BaseEvent {
  type: "leave"
}

interface PostbackEvent extends BaseEvent {
  type: "postback"
  replyToken: string
  postback: {
    data: string
    params?: {
      date?: string
      time?: string
      datetime?: string
    }
  }
}

interface BeaconEvent extends BaseEvent {
  type: "beacon"
  replyToken: string
  beacon: {
    hwid: string
    type: "enter" | "leave"
  }
}

interface AccountLinkEvent extends BaseEvent {
  type: "accountLink"
  replyToken: string
  accountLink: {
    result: string
    nonce: string
  }
}

// 3. Webhook全体のイベント型（Union型）
export type WebhookEvent =
  | MessageEvent
  | FollowEvent
  | UnfollowEvent
  | JoinEvent
  | LeaveEvent
  | PostbackEvent
  | BeaconEvent
  | AccountLinkEvent

export type WebhookBody = {
  destination: string
  events: WebhookEvent[]
}

export type DifyFileType = "document" | "image" | "audio" | "video" | "custom"

export type DifyChatResponse = {
  event: string
  task_id: string
  id: string
  message_id: string
  conversation_id: string
  mode: string
  answer: string
  metadata: {
    usage: Object
  }
  created_at: number
}
