import { expect, test } from "bun:test";
import { createPutBytes } from "../src/transfer";

const signed = "https://bucket.example/obj?X-Amz-Signature=secret";

test("putBytes sends the bytes with PUT and accepts 2xx responses", async () => {
  const sent: Array<[string, string, number[]]> = [];
  const put = createPutBytes(async (url, init) => {
    sent.push([url, init.method, [...init.body]]);
    return new Response(null, { status: 200 });
  });
  await put(signed, new Uint8Array([1, 2]));
  expect(sent).toEqual([[signed, "PUT", [1, 2]]]);
});

test("putBytes errors never include the signed URL or the transport message", async () => {
  const failures = [
    createPutBytes(async () => new Response("denied", { status: 403 })),
    createPutBytes(async (url) => Promise.reject(new TypeError(`fetch failed for ${url}`))),
  ];
  const messages = await Promise.all(
    failures.map((put) =>
      put(signed, new Uint8Array([1])).then(
        () => "",
        (error: Error) => error.message,
      ),
    ),
  );
  expect(messages).toEqual([
    "Upload failed with HTTP 403",
    "Upload failed: the upload server could not be reached",
  ]);
  for (const message of messages) expect(message).not.toContain("secret");
});
