type Send = (
  url: string,
  init: { method: "PUT"; body: Uint8Array<ArrayBuffer> },
) => Promise<Response>;

/** HTTP adapter for upload policies; signed URLs and transport errors stay out of messages. */
export const createPutBytes =
  (send: Send = fetch) =>
  async (url: string, bytes: Uint8Array): Promise<void> => {
    const response = await send(url, { method: "PUT", body: bytes.slice() }).catch(() => {
      throw new Error("Upload failed: the upload server could not be reached");
    });
    if (!response.ok) throw new Error(`Upload failed with HTTP ${response.status}`);
  };

export const putBytes = createPutBytes();
