import { del, put } from "@vercel/blob"

export const uploadToBlobStorage = async (messageId: string, extension: string, blob: Blob) => {
  try {
    const { url } = await put(`dify/tmp/${messageId}.${extension}`, blob, {
      access: "public"
    })
    return url
  } catch (error) {
    console.log(error)
  }
}

export const deleteStorageFile = async (url: string): Promise<void> => {
  try {
    await del(url)
  } catch (error) {
    console.log(error)
  }
}
