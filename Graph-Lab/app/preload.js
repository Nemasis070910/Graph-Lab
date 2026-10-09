// Graph Lab: the only bridge between the page and the computer.
// The page can save/load its own progress file and compile-and-run C++; nothing else.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("graphlabDesktop", {
  platform: process.platform,
  getProfiles: () => ipcRenderer.invoke("profiles:get"),
  saveProfiles: (d) => ipcRenderer.invoke("profiles:save", d),
  removeProfile: (id) => ipcRenderer.invoke("profiles:remove", id),
  loadProgress: (id) => ipcRenderer.invoke("progress:load", id),
  saveProgress: (id, json) => ipcRenderer.invoke("progress:save", id, json),
  progressInfo: (id) => ipcRenderer.invoke("progress:info", id),
  exportProgress: (json, name) => ipcRenderer.invoke("progress:export", json, name),
  importProgress: () => ipcRenderer.invoke("progress:import"),
  compilerInfo: () => ipcRenderer.invoke("cpp:info"),
  compileAndRun: (job) => ipcRenderer.invoke("cpp:run", job),
});
