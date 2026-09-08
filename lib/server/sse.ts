import { ApiError } from "./security";
export interface SSEFrame {
  event: string;
  data: string;
}
// UTF-8, CRLF, split lines, comments, multiline data and a final unterminated frame.
export async function* frames(
  stream: ReadableStream<Uint8Array>,
  idleMs: number,
): AsyncGenerator<SSEFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let dataLength = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ApiError(
                  504,
                  "idle_timeout",
                  "Hermes 串流閒置逾時；請查回任務狀態。",
                ),
              ),
            idleMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 2_000_000)
        throw new ApiError(502, "frame_too_large", "工具事件超過大小限制。");
      if (chunk.done && buffer && !buffer.endsWith("\n")) buffer += "\n";
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
          dataLength = 0;
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const value = line.slice(5).replace(/^ /, "");
          // Parsed lines leave buffer but remain retained until dispatch. Bound
          // their joined payload too, regardless of network chunk boundaries.
          dataLength += value.length + (data.length ? 1 : 0);
          if (dataLength > 2_000_000)
            throw new ApiError(502, "frame_too_large", "工具事件超過大小限制。");
          data.push(value);
        }
      }
      if (chunk.done) {
        if (data.length) yield { event, data: data.join("\n") };
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
