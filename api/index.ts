import crypto from "crypto"
import { Hono } from "hono"
import { handle } from "hono/vercel"

import { DIFY_API_ENDPOINT, LINE_REPLY_ENDPOINT } from "../const.js"
import { extractExtensionFromContentType, getDifyFileType } from "../utils.js"
import { deleteStorageFile, uploadToBlobStorage } from "./blob.js"
import { getContentByMessageId } from "./line.js"
import { DifyChatResponse, WebhookBody, WebhookEvent } from "./type.js"

const app = new Hono().basePath("/api")

app.get("/", (c) => c.json({ status: 200 })) // ヘルスチェック用

app.post("/", async (c) => {
  const rawBody = await c.req.text()
  const webhookBody: WebhookBody = await c.req.json()
  const signature = c.req.header()["x-line-signature"] || ""

  console.log(`rawBody:`, rawBody)

  // LINE署名を検証
  if (!validateSignature(signature, rawBody)) {
    console.error("署名検証に失敗")
  }

  // Lステップへ転送（JSONと署名をそのまま）
  try {
    const res = await fetch(process.env.LSTEP_WEBHOOK_URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Line-Signature": signature
      },
      body: rawBody
    }).catch((e) => console.error("Lステップ転送エラー:", e))

    console.log(JSON.stringify(res))
  } catch (error) {
    console.log(error)
  }

  // Dify処理
  for (const event of webhookBody.events) {
    try {
      await handleEvent(event, webhookBody.destination)
    } catch (err) {
      console.error("イベント処理中にエラー:", err)
    }
  }

  return c.json({ status: 200 })
})

const handler = handle(app)

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const OPTIONS = handler

// 署名作成
const createSignature = (body: string) => {
  return crypto.createHmac("sha256", process.env.LINE_CHANNEL_SECRET!).update(body).digest("base64")
}

// 署名検証
const validateSignature = (signature: string, body: string) => {
  return signature === createSignature(body)
}

const handleEvent = async (event: WebhookEvent, destination: string) => {
  switch (event.type) {
    case "message":
      switch (event.message.type) {
        case "text":
          if (!isLStepMessage(event.message.text)) {
            // DifyのLINEBotへテキスト送信
            // TODO: 分岐処理が必要になったら、KVSと組み合わせてメッセージ先頭への追記処理
            try {
              const body = JSON.stringify({
                destination: destination,
                events: [event]
              })
              const res = await fetch(process.env.DIFY_LINE_BOT_ENDPOINT!, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                  "Content-Type": "application/json",
                  "X-Line-Signature": createSignature(body)
                },
                body: body
              }).catch((e) => console.error("Dify LINE Bot転送エラー:", e))
              if (res) console.log(`LINE Botプラグインレスポンス：\n${await res.text()}`)
            } catch (error) {
              console.log(error)
            }
          }
          break
        case "image":
        case "audio":
        case "video":
        case "file":
          // ファイル情報取得して、DifyのAPIへ送信
          try {
            const messageId = event.message.id
            const contentBlob = await getContentByMessageId(messageId)
            const extension = extractExtensionFromContentType(contentBlob.type || "")
            const blobUrl = await uploadToBlobStorage(messageId, extension, contentBlob)

            const payload = {
              inputs: {},
              query: "未使用のquery", // MEMO: 空文字は許容されない
              response_mode: "blocking",
              conversation_id: "",
              user: "motekuri-line-test",
              files: [
                {
                  type: getDifyFileType(extension),
                  transfer_method: "remote_url",
                  url: blobUrl
                }
              ]
            }
            console.log(JSON.stringify(payload))
            const res = await fetch(DIFY_API_ENDPOINT, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            }).catch((e) => console.error("Dify API転送エラー:", e))

            const difyResponse = res ? ((await res.json()) as DifyChatResponse) : null

            // Blobの画像削除
            if (blobUrl) await deleteStorageFile(blobUrl)

            // Difyのレスポンスを使ってLINE送信
            await fetch(LINE_REPLY_ENDPOINT, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: difyResponse?.answer || "ファイル解析に失敗しました。"
                  }
                ]
              })
            })
          } catch (error) {
            console.log(error)
          }
          break
        default:
          // 何もしない
          console.log(`other event: ${event.message.type}`)
      }
      break
    default:
    // 何もしない
  }
}

const isLStepMessage = (text: string): boolean => {
  return text.startsWith("【") && text.endsWith("】")
}

// const getRequestToDify = (event: MessageEvent): MessageEvent => {
//   if (event.message.type === "text") {
//     // Dify内の分岐用テキストを添える
//     event.message.text = `【AIプロフィール添削】\n${event.message.text}`
//   }
//   return event
// }
