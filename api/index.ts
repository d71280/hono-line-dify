import crypto from "crypto"
import { Hono } from "hono"
import { handle } from "hono/vercel"

import { DIFY_API_ENDPOINT, LINE_REPLY_ENDPOINT } from "../const.js"
import { extractExtensionFromContentType, getDifyFileType } from "../utils.js"
import { deleteStorageFile, uploadToBlobStorage } from "./blob.js"
import { getContentByMessageId } from "./line.js"
import { DifyChatResponse, WebhookBody, WebhookEvent } from "./type.js"

// 環境変数の検証
const validateEnvVars = () => {
  const required = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_SECRET",
    "LSTEP_WEBHOOK_URL",
    "DIFY_API_KEY",
    "DIFY_LINE_BOT_ENDPOINT"
  ]
  
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    console.error(`[環境変数エラー] 以下の環境変数が設定されていません: ${missing.join(", ")}`)
    return false
  }
  return true
}

const app = new Hono().basePath("/api")

app.get("/", (c) => {
  const envValid = validateEnvVars()
  return c.json({ 
    status: envValid ? 200 : 500,
    message: envValid ? "Proxy server is running" : "Environment variables are not properly configured",
    timestamp: new Date().toISOString()
  })
}) // ヘルスチェック用

app.get("/debug", (c) => {
  const required = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_SECRET", 
    "LSTEP_WEBHOOK_URL",
    "DIFY_API_KEY",
    "DIFY_LINE_BOT_ENDPOINT"
  ]
  
  const envStatus = required.map(key => ({
    key,
    exists: !!process.env[key],
    value: process.env[key] ? `${process.env[key].substring(0, 10)}...` : null
  }))
  
  return c.json({
    envStatus,
    allKeys: Object.keys(process.env).filter(key => key.includes('LINE') || key.includes('DIFY') || key.includes('LSTEP'))
  })
}) // デバッグ用

app.post("/", async (c) => {
  // 環境変数の検証
  if (!validateEnvVars()) {
    return c.json({ status: 500, message: "Server configuration error" }, 500)
  }
  
  const rawBody = await c.req.text()
  const webhookBody: WebhookBody = await c.req.json()
  const signature = c.req.header()["x-line-signature"] || ""

  console.log(`[Webhook受信] イベント数: ${webhookBody.events.length}`)
  console.log(`[Webhook受信] Destination: ${webhookBody.destination}`)

  // LINE署名を検証
  if (!validateSignature(signature, rawBody)) {
    console.error("[エラー] LINE署名検証に失敗しました")
    return c.json({ status: 401, message: "Invalid signature" }, 401)
  }

  // Lステップへ転送（JSONと署名をそのまま）
  const forwardToLStep = async () => {
    try {
      console.log("[Lステップ転送] 開始")
      const res = await fetch(process.env.LSTEP_WEBHOOK_URL!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Line-Signature": signature
        },
        body: rawBody
      })

      if (res.ok) {
        console.log(`[Lステップ転送] 成功 - ステータス: ${res.status}`)
      } else {
        console.error(`[Lステップ転送] 失敗 - ステータス: ${res.status}`)
        const errorText = await res.text()
        console.error(`[Lステップ転送] レスポンス: ${errorText}`)
      }
    } catch (error) {
      console.error("[Lステップ転送] エラー:", error)
    }
  }
  
  // Lステップへの転送を非同期で実行（レスポンスを待たない）
  forwardToLStep()

  // Dify処理
  for (const event of webhookBody.events) {
    try {
      console.log(`[イベント処理] タイプ: ${event.type}`)
      await handleEvent(event, webhookBody.destination, signature, rawBody)
    } catch (err) {
      console.error("[イベント処理] エラー:", err)
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

const handleEvent = async (event: WebhookEvent, destination: string, originalSignature: string, originalBody: string) => {
  switch (event.type) {
    case "message":
      switch (event.message.type) {
        case "text":
          const messageText = event.message.text
          console.log(`[テキストメッセージ] 内容: ${messageText}`)
          
          if (isLStepMessage(messageText)) {
            console.log(`[フィルタリング] Lステップ専用メッセージ（【】で囲まれている）のため、Difyへの転送をスキップ`)
          } else {
            // DifyのLINEBotへテキスト送信
            console.log(`[Dify転送] テキストメッセージをDifyへ転送開始`)
            try {
              const res = await fetch(process.env.DIFY_LINE_BOT_ENDPOINT!, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                  "Content-Type": "application/json",
                  "X-Line-Signature": originalSignature
                },
                body: originalBody
              })
              
              if (res.ok) {
                console.log(`[Dify転送] 成功 - ステータス: ${res.status}`)
                const responseText = await res.text()
                console.log(`[Dify転送] レスポンス: ${responseText}`)
              } else {
                console.error(`[Dify転送] 失敗 - ステータス: ${res.status}`)
                console.error(`[Dify転送] エラーレスポンス: ${await res.text()}`)
              }
            } catch (error) {
              console.error("[Dify転送] エラー:", error)
            }
          }
          break
        case "image":
        case "audio":
        case "video":
        case "file":
          // ファイル情報取得して、DifyのAPIへ送信
          console.log(`[メディアメッセージ] タイプ: ${event.message.type}, ID: ${event.message.id}`)
          try {
            const messageId = event.message.id
            const contentBlob = await getContentByMessageId(messageId)
            const extension = extractExtensionFromContentType(contentBlob.type || "")
            console.log(`[メディア処理] コンテンツタイプ: ${contentBlob.type}, 拡張子: ${extension}`)
            
            const blobUrl = await uploadToBlobStorage(messageId, extension, contentBlob)
            console.log(`[メディア処理] Blob URLにアップロード完了: ${blobUrl}`)

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
            console.log(`[Dify API] リクエストペイロード:`, JSON.stringify(payload))
            const res = await fetch(DIFY_API_ENDPOINT, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            })

            const difyResponse = res ? ((await res.json()) as DifyChatResponse) : null
            console.log(`[Dify API] レスポンス:`, difyResponse ? `回答文字数: ${difyResponse.answer.length}` : "レスポンスなし")

            // Blobの画像削除
            if (blobUrl) {
              await deleteStorageFile(blobUrl)
              console.log(`[メディア処理] 一時ファイルを削除しました: ${blobUrl}`)
            }

            // Difyのレスポンスを使ってLINE送信
            console.log(`[LINE返信] ユーザーへの返信を送信中...`)
            const replyRes = await fetch(LINE_REPLY_ENDPOINT, {
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
            
            if (replyRes.ok) {
              console.log(`[LINE返信] 返信送信成功`)
            } else {
              console.error(`[LINE返信] 返信送信失敗 - ステータス: ${replyRes.status}`)
            }
          } catch (error) {
            console.error(`[メディア処理] エラー:`, error)
          }
          break
        default:
          // 何もしない
          console.log(`[未対応メッセージ] タイプ: ${event.message.type}`)
      }
      break
    default:
      // 何もしない
      console.log(`[未対応イベント] タイプ: ${event.type}`)
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
