import { readFileSync, writeFileSync } from "fs";
import * as workspace from "./workspace";

export function readProjectDoc(projectId: string): string {
  try {
    return readFileSync(workspace.projectDocPath(projectId), "utf-8");
  } catch {
    return "";
  }
}

export function writeProjectDoc(projectId: string, content: string): void {
  writeFileSync(workspace.projectDocPath(projectId), content, "utf-8");
}
