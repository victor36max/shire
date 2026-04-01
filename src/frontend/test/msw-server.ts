import { setupServer } from "msw/node";
import { defaultHandlers } from "./msw-handlers";

export const server = setupServer(...defaultHandlers);
