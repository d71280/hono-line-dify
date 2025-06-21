import crypto from "crypto"
import { Hono } from "hono"
import { handle } from "hono/vercel"

import { WebhookBody } from "./type.js"

// 環境変数の検証
const validateEnvVars = () => {
  const required = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_SECRET",
    "LSTEP_WEBHOOK_URL",
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
  
  // すべてのヘッダーを取得
  const headers = c.req.header()

  console.log(`[Webhook受信] イベント数: ${webhookBody.events.length}`)
  console.log(`[Webhook受信] Destination: ${webhookBody.destination}`)

  // LINE署名を検証
  if (!validateSignature(signature, rawBody)) {
    console.error("[エラー] LINE署名検証に失敗しました")
    return c.json({ status: 401, message: "Invalid signature" }, 401)
  }

  // 共通のヘッダー準備
  const prepareHeaders = () => {
    const forwardHeaders: any = {
      "Content-Type": "application/json",
      "X-Line-Signature": signature
    }
    
    // LINE関連のヘッダーをすべて転送
    Object.keys(headers).forEach(key => {
      if (key.toLowerCase().startsWith('x-line-')) {
        forwardHeaders[key] = headers[key]
      }
    })
    
    return forwardHeaders
  }

  // Lステップへの転送
  const forwardToLStep = async () => {
    try {
      console.log("[Lステップ転送] 開始")
      console.log(`[Lステップ転送] URL: ${process.env.LSTEP_WEBHOOK_URL}`)
      console.log(`[Lステップ転送] URL length: ${process.env.LSTEP_WEBHOOK_URL?.length}`)
      console.log(`[Lステップ転送] Body: ${rawBody.substring(0, 100)}`)
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒タイムアウト
      
      const res = await fetch(process.env.LSTEP_WEBHOOK_URL!, {
        method: "POST",
        headers: prepareHeaders(),
        body: rawBody,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))

      console.log(`[Lステップ転送] レスポンス受信 - ステータス: ${res.status}`)
      if (res.ok) {
        console.log(`[Lステップ転送] 成功 - ステータス: ${res.status}`)
        const responseText = await res.text()
        console.log(`[Lステップ転送] レスポンス内容: ${responseText.substring(0, 200)}`)
      } else {
        console.error(`[Lステップ転送] 失敗 - ステータス: ${res.status}`)
        const errorText = await res.text()
        console.error(`[Lステップ転送] エラーレスポンス: ${errorText}`)
      }
    } catch (error) {
      console.error("[Lステップ転送] エラー:", error)
    }
  }

  // Difyへの転送
  const forwardToDify = async () => {
    try {
      console.log("[Dify転送] 開始")
      console.log(`[Dify転送] URL: ${process.env.DIFY_LINE_BOT_ENDPOINT}`)
      console.log(`[Dify転送] Body size: ${rawBody.length} bytes`)
      
      const forwardHeaders = prepareHeaders()
      console.log(`[Dify転送] ヘッダー:`, JSON.stringify(forwardHeaders))
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒タイムアウト
      
      const res = await fetch(process.env.DIFY_LINE_BOT_ENDPOINT!, {
        method: "POST",
        headers: forwardHeaders,
        body: rawBody,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))
      
      console.log(`[Dify転送] レスポンス受信 - ステータス: ${res.status}`)
      if (res.ok) {
        console.log(`[Dify転送] 成功 - ステータス: ${res.status}`)
        const responseText = await res.text()
        console.log(`[Dify転送] レスポンス内容: ${responseText.substring(0, 200)}`)
      } else {
        console.error(`[Dify転送] 失敗 - ステータス: ${res.status}`)
        const errorText = await res.text()
        console.error(`[Dify転送] エラーレスポンス: ${errorText}`)
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error("[Dify転送] タイムアウトエラー: 30秒以内に応答がありませんでした")
      } else {
        console.error("[Dify転送] エラー:", error)
      }
    }
  }

  // LステップとDifyへの転送を並行実行（レスポンスを待たない）
  forwardToLStep()
  forwardToDify()

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