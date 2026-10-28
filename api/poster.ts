import type { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./image";

export default async function posterHandler(req: VercelRequest, res: VercelResponse) {
  return handler(req, res);
}
