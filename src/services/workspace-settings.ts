import { readFile, writeFile } from "fs/promises";
import * as workspace from "./workspace";

export async function readProjectDoc(projectId: string): Promise<string> {
  try {
    return await readFile(workspace.projectDocPath(projectId), "utf-8");
  } catch {
    return "";
  }
}

export async function writeProjectDoc(projectId: string, content: string): Promise<void> {
  await writeFile(workspace.projectDocPath(projectId), content, "utf-8");
}
