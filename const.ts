// 公開情報なので定数
export const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply"
export const DIFY_API_ENDPOINT = "https://api.dify.ai/v1/chat-messages"

// 【説明用】機密情報なので実際は環境変数に設定（ここには値を入れないでください）
const LINE_CHANNEL_ACCESS_TOKEN = "********" // LINE DeveloperのMessaging APIで発行した値を使ってください
const LINE_CHANNEL_SECRET = "********" // LINE DeveloperのMessaging APIで発行した値を使ってください
const LSTEP_WEBHOOK_URL = "********" // Lステップ管理画面から確認してください
const DIFY_API_KEY = "********" // Difyの設定画面で発行した値を使ってください
const DIFY_LINE_BOT_ENDPOINT = "********" // DifyのLINE Botプラグインで発行した値を使ってください
