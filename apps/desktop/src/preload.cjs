const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("solvemateAppUpdate", {
  getState: () => ipcRenderer.invoke("app-update", "state"),
  check: () => ipcRenderer.invoke("app-update", "check"),
  download: () => ipcRenderer.invoke("app-update", "download"),
  install: () => ipcRenderer.invoke("app-update", "install"),
  subscribe: (listener) => {
    const callback = (_event, state) => listener(state);
    ipcRenderer.on("app-update:state", callback);
    return () => ipcRenderer.removeListener("app-update:state", callback);
  },
});
