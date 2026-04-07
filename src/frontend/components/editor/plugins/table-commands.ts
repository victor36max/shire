import { createCommand } from "lexical";

export const OPEN_INSERT_TABLE_MENU_COMMAND = createCommand<void>("OPEN_INSERT_TABLE_MENU_COMMAND");

export const OPEN_TABLE_ACTION_MENU_COMMAND = createCommand<{ cellKey: string }>(
  "OPEN_TABLE_ACTION_MENU_COMMAND",
);
