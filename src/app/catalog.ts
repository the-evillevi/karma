import rawCatalog from "../../catalog/catalog.json";
import { parseCatalog } from "../domain/catalog.ts";

export const catalog = parseCatalog(rawCatalog);
