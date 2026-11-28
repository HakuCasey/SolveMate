import { recordInstallerDownload } from "./download-statistics.mjs";

const endpoint = document.querySelector("script[data-download-endpoint]")
  ?.dataset.downloadEndpoint;

for (const link of document.querySelectorAll("a[data-download-target]")) {
  function record() {
    void recordInstallerDownload(endpoint, {
      version: link.dataset.downloadVersion,
      target: link.dataset.downloadTarget,
      source: "website",
    });
  }
  link.addEventListener("click", record);
  link.addEventListener("auxclick", (event) => {
    if (event.button === 1) record();
  });
}
