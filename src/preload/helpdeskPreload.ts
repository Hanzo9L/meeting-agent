import { contextBridge, ipcRenderer } from "electron";
import { createHelpdeskApi } from "./helpdeskApi";

contextBridge.exposeInMainWorld("helpdeskApi", createHelpdeskApi(ipcRenderer));
