# LINE Webhook Proxy Server

LINEの公式アカウントからのWebhookを受信し、LステップとDifyの両方に転送するプロキシサーバーです。

## 構成図

```
LINE公式アカウント
    ↓ (Webhook)
プロキシサーバー (このアプリケーション)
    ├─→ Lステップ (全てのWebhookを転送)
    └─→ Dify (条件に応じて転送)
```

## 機能

- **Webhook受信**: LINE公式アカウントからのWebhookを受信
- **署名検証**: LINE署名を検証してセキュリティを確保
- **Lステップ転送**: 全てのWebhookをLステップに転送
- **Dify転送**: 
  - テキストメッセージ: 【】で囲まれていないメッセージのみDifyに転送
  - メディアメッセージ: 画像、音声、動画、ファイルをDify APIで処理
- **環境変数検証**: 起動時に必要な環境変数をチェック
- **詳細なログ**: 各処理ステップの詳細なログ出力

## セットアップ

### 1. 環境変数の設定

`.env.example`をコピーして`.env`ファイルを作成し、必要な値を設定してください：

```bash
cp .env.example .env
```

必要な環境変数：
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging APIのアクセストークン
- `LINE_CHANNEL_SECRET`: LINE Messaging APIのChannel Secret
- `LSTEP_WEBHOOK_URL`: LステップのWebhook URL
- `DIFY_API_KEY`: DifyのAPIキー
- `DIFY_LINE_BOT_ENDPOINT`: DifyのLINE Bot Webhook URL

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

### 4. デプロイ (Vercel)

```bash
vercel
```

## LINE公式アカウントの設定

1. LINE Developersコンソールでプロバイダーとチャネルを作成
2. Webhook URLに以下を設定：
   ```
   https://your-vercel-domain.vercel.app/api
   ```
3. Webhookを有効化

## メッセージ処理フロー

### テキストメッセージ
1. 【】で囲まれたメッセージ → Lステップのみに転送
2. それ以外のメッセージ → LステップとDifyの両方に転送

### メディアメッセージ（画像、音声、動画、ファイル）
1. LINEからコンテンツをダウンロード
2. Vercel Blob Storageに一時保存
3. Dify APIで処理
4. 処理結果をLINEユーザーに返信
5. 一時ファイルを削除

## ログ形式

各処理ステップで以下の形式でログが出力されます：

- `[Webhook受信]`: Webhook受信時の情報
- `[Lステップ転送]`: Lステップへの転送状況
- `[Dify転送]`: Difyへの転送状況
- `[メディア処理]`: メディアファイルの処理状況
- `[LINE返信]`: ユーザーへの返信送信状況
- `[エラー]`: エラー情報

## トラブルシューティング

### ヘルスチェック

以下のURLにアクセスして、サーバーの状態を確認できます：
```
GET https://your-vercel-domain.vercel.app/api
```

正常な応答：
```json
{
  "status": 200,
  "message": "Proxy server is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 環境変数エラー

環境変数が正しく設定されていない場合、ヘルスチェックで以下の応答が返されます：
```json
{
  "status": 500,
  "message": "Environment variables are not properly configured"
}
```

## 注意事項

- Difyからの返信内容はLステップのトーク画面には表示されません
- メディアファイルの処理にはVercel Blob Storageの設定が必要な場合があります
- 本番環境では必ずHTTPS経由でアクセスしてください