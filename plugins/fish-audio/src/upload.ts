import { isRecord, type LocalFile, type ToolResult, type UploadContext } from "@mcp-cli/core";

const firstText = (result: ToolResult): string => {
  const block = result.content.find((item) => item.type === "text");
  return block && typeof block.text === "string" ? block.text : "";
};

// get_upload_url answers with a JSON text block holding a signed PUT URL and a readable file URL.
const decodeSlot = (result: ToolResult): { uploadUrl: string; fileUrl: string } => {
  let value: unknown;
  try {
    value = JSON.parse(firstText(result));
  } catch {
    value = undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.upload_url !== "string" ||
    typeof value.file_url !== "string"
  )
    throw new Error("get_upload_url returned no upload_url and file_url");
  return { uploadUrl: value.upload_url, fileUrl: value.file_url };
};

export const uploadFile = async (file: LocalFile, context: UploadContext): Promise<string> => {
  const result = await context.callTool("get_upload_url", { filename: file.name });
  if (result.isError) throw new Error(`get_upload_url failed: ${firstText(result)}`);
  const slot = decodeSlot(result);
  await context.putBytes(slot.uploadUrl, file.bytes);
  return slot.fileUrl;
};
