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
    value: process.env[key] ? `${process.env[key].substring(0, 20)}...` : "NOT_SET",
    fullLength: process.env[key]?.length || 0
  }))
  
  return c.json({
    envStatus,
    allKeys: Object.keys(process.env).filter(key => key.includes('LINE') || key.includes('DIFY') || key.includes('LSTEP')),
    vercelEnv: process.env.VERCEL_ENV || "unknown",
    nodeEnv: process.env.NODE_ENV || "unknown",
    totalEnvVars: Object.keys(process.env).length,
    testEndpoints: {
      lstep: `${process.env.LSTEP_WEBHOOK_URL ? 'CONFIGURED' : 'NOT_SET'}`,
      dify: `${process.env.DIFY_LINE_BOT_ENDPOINT ? 'CONFIGURED' : 'NOT_SET'}`
    }
  })
}) // デバッグ用

app.get("/test-endpoints", async (c) => {
  const results = {
    lstep: { status: 'not_tested', error: null as string | null },
    dify: { status: 'not_tested', error: null as string | null }
  }

  // Lステップのテスト
  if (process.env.LSTEP_WEBHOOK_URL) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const response = await fetch(process.env.LSTEP_WEBHOOK_URL, {
        method: 'HEAD', // ヘッダーのみのリクエスト
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))
      
      results.lstep.status = `reachable (${response.status})`
    } catch (error) {
      results.lstep.status = 'unreachable'
      results.lstep.error = (error as any).name === 'AbortError' ? 'timeout' : (error as Error).message
    }
  } else {
    results.lstep.status = 'url_not_set'
  }

  // Difyのテスト
  if (process.env.DIFY_LINE_BOT_ENDPOINT) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      const response = await fetch(process.env.DIFY_LINE_BOT_ENDPOINT, {
        method: 'HEAD', // ヘッダーのみのリクエスト
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))
      
      results.dify.status = `reachable (${response.status})`
    } catch (error) {
      results.dify.status = 'unreachable'
      results.dify.error = (error as any).name === 'AbortError' ? 'timeout' : (error as Error).message
    }
  } else {
    results.dify.status = 'url_not_set'
  }

  return c.json({
    message: "Endpoint connectivity test results",
    results,
    timestamp: new Date().toISOString()
  })
})

app.post("/", async (c) => {
  // 環境変数の検証
  if (!validateEnvVars()) {
    return c.json({ status: 500, message: "Server configuration error" }, 500)
  }
  
  const rawBody = await c.req.text()
  const webhookBody: WebhookBody = JSON.parse(rawBody)
  const originalSignature = c.req.header()["x-line-signature"] || ""
  
  // すべてのヘッダーを取得
  const headers = c.req.header()

  console.log(`[Webhook受信] イベント数: ${webhookBody.events.length}`)
  console.log(`[Webhook受信] Destination: ${webhookBody.destination}`)

  // LINE署名を検証
  if (!validateSignature(originalSignature, rawBody)) {
    console.error("[エラー] LINE署名検証に失敗しました")
    return c.json({ status: 401, message: "Invalid signature" }, 401)
  }

  // ✅ 修正版：プロキシ情報完全除去
  const prepareLINEHeaders = (includeSignature: boolean = true) => {
    const forwardHeaders: any = {
      "Content-Type": "application/json",
      "User-Agent": "LineBotWebhook/1.0",
      "Accept": "application/json",
      "Cache-Control": "no-cache"
    }
    
    // 署名を含めるかどうかを選択
    if (includeSignature) {
      forwardHeaders["X-Line-Signature"] = originalSignature
    }
    
    // ✅ LINE特有のヘッダーのみ厳選して転送
    Object.keys(headers).forEach(key => {
      const lowerKey = key.toLowerCase()
      if (lowerKey.startsWith('x-line-') && 
          lowerKey !== 'x-line-signature' &&
          !lowerKey.includes('forwarded') &&
          !lowerKey.includes('host') &&
          !lowerKey.includes('proxy')) {
        forwardHeaders[key] = headers[key]
      }
    })
    
    // ✅ プロキシ関連ヘッダーを完全除去
    const blacklistedHeaders = [
      'host', 'referer', 'origin', 
      'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
      'x-real-ip', 'x-vercel-id', 'x-vercel-cache',
      'cf-ray', 'cf-connecting-ip'
    ]
    
    blacklistedHeaders.forEach(header => {
      delete forwardHeaders[header]
      delete forwardHeaders[header.toUpperCase()]
    })
    
    return forwardHeaders
  }

  // Lステップへの転送（完全模倣）
  const forwardToLStep = async () => {
    try {
      console.log("[Lステップ転送] 開始")
      console.log(`[Lステップ転送] URL: ${process.env.LSTEP_WEBHOOK_URL}`)
      
      const headers = prepareLINEHeaders(true)  // Lステップには署名を含める
      console.log(`[Lステップ転送] ヘッダー:`, JSON.stringify(headers))
      console.log(`[Lステップ転送] ボディサイズ: ${rawBody.length} bytes`)
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log("[Lステップ転送] 10秒でタイムアウトします")
        controller.abort()
      }, 10000) // 10秒に短縮
      
      console.log("[Lステップ転送] fetch開始")
      const res = await fetch(process.env.LSTEP_WEBHOOK_URL!, {
        method: "POST",
        headers: headers,
        body: rawBody,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))

      console.log(`[Lステップ転送] fetch完了 - ステータス: ${res.status}`)
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
      if (error.name === 'AbortError') {
        console.error("[Lステップ転送] タイムアウトエラー: 10秒以内に応答がありませんでした")
        console.error("[Lステップ転送] Lステップのサーバーが応答していない可能性があります")
      } else {
        console.error("[Lステップ転送] エラー:", error)
      }
    }
  }

  // Difyプラグインへの転送（LINE Webhook → Dify Plugin）
  const forwardToDify = async () => {
    try {
      console.log("[Dify転送] 開始")
      console.log(`[Dify転送] URL: ${process.env.DIFY_LINE_BOT_ENDPOINT}`)
      
      const headers = prepareLINEHeaders(false)  // Difyプラグインには署名を含めない
      console.log(`[Dify転送] ヘッダー:`, JSON.stringify(headers))
      console.log(`[Dify転送] ボディサイズ: ${rawBody.length} bytes`)
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        console.log("[Dify転送] 10秒でタイムアウトします")
        controller.abort()
      }, 10000)
      
      console.log("[Dify転送] fetch開始")
      const res = await fetch(process.env.DIFY_LINE_BOT_ENDPOINT!, {
        method: "POST",
        headers: headers,
        body: rawBody,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))
      
      console.log(`[Dify転送] レスポンス受信 - ステータス: ${res.status}`)
      if (res.ok) {
        console.log(`[Dify転送] 成功 - ステータス: ${res.status}`)
        const responseText = await res.text()
        console.log(`[Dify転送] レスポンス内容: ${responseText.substring(0, 500)}`)
      } else {
        console.error(`[Dify転送] 失敗 - ステータス: ${res.status}`)
        const errorText = await res.text()
        console.error(`[Dify転送] エラーレスポンス: ${errorText}`)
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error("[Dify転送] タイムアウトエラー: 10秒以内に応答がありませんでした")
        console.error("[Dify転送] Difyプラグインサーバーが応答していない可能性があります")
      } else {
        console.error("[Dify転送] エラー:", error)
      }
    }
  }

  // LステップとDifyへの転送を並行実行（結果を待機）
  console.log("[転送開始] LステップとDifyへの並行転送を開始します")
  
  try {
    await Promise.allSettled([
      forwardToLStep(),
      forwardToDify()
    ])
    console.log("[転送完了] すべての転送処理が完了しました")
  } catch (error) {
    console.error("[転送エラー] 予期しないエラーが発生しました:", error)
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