import { DifyFileType } from "./api/type.js"

const mimeToExtension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "application/json": "json",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-yaml": "yml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt"
}

export const extractExtensionFromContentType = (contentType: string): string => {
  const mime = contentType.split(";")[0].trim().toLowerCase()
  return mimeToExtension[mime] || "txt"
}

export const getDifyFileType = (extension: string): DifyFileType => {
  const documentExts = [
    "TXT",
    "MD",
    "MARKDOWN",
    "PDF",
    "HTML",
    "XLSX",
    "XLS",
    "DOCX",
    "CSV",
    "EML",
    "MSG",
    "PPTX",
    "PPT",
    "XML",
    "EPUB"
  ]
  const imageExts = ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"]
  const audioExts = ["MP3", "M4A", "WAV", "WEBM", "AMR"]
  const videoExts = ["MP4", "MOV", "MPEG", "MPGA"]

  const ext = extension.toUpperCase()
  if (documentExts.includes(ext)) return "document"
  if (imageExts.includes(ext)) return "image"
  if (audioExts.includes(ext)) return "audio"
  if (videoExts.includes(ext)) return "video"

  return "custom"
}
