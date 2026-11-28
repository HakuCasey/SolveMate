const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("solvemateAppUpdate", {
  getState: () => ipcRenderer.invoke("app-update", "state"),
  download: () => ipcRenderer.invoke("app-update", "download"),
  subscribe: (listener) => {
    const callback = (_event, state) => listener(state);
    ipcRenderer.on("app-update:state", callback);
    return () => ipcRenderer.removeListener("app-update:state", callback);
  },
});
