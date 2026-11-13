import { DataRequestError } from "../refresh/errors";

/** 浏览器提供实际发送字节数；100% 只代表文件发送结束，保存结果仍等待服务确认。 */
export function uploadRequest(
  url: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("X-SolveMate-Client", "web");
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.timeout = 120000;
    request.upload.onprogress = (event) =>
      onProgress(Math.min(event.loaded, file.size), file.size);
    request.onload = () => {
      if (request.status === 0) {
        reject(
          new DataRequestError(
            "上传连接已中断，请刷新资料列表核对结果后重试。",
            "unavailable",
          ),
        );
        return;
      }
      resolve(
        new Response(request.responseText, {
          status: request.status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    request.onerror = () =>
      reject(
        new DataRequestError(
          "无法确认上传结果，请检查本机服务并刷新资料列表。",
          "unavailable",
        ),
      );
    request.ontimeout = () =>
      reject(
        new DataRequestError(
          "上传超时，请刷新资料列表核对结果后重试。",
          "upload_timeout",
        ),
      );
    request.onabort = () =>
      reject(
        new DataRequestError(
          "上传已中断，请刷新资料列表核对结果。",
          "upload_aborted",
        ),
      );
    request.send(file);
  });
}
