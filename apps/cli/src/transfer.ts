/** HTTP adapter for upload policies; the signed URL stays out of error messages. */
export const putBytes = async (url: string, bytes: Uint8Array): Promise<void> => {
  const response = await fetch(url, { method: "PUT", body: bytes.slice() });
  if (!response.ok) throw new Error(`Upload failed with HTTP ${response.status}`);
};
