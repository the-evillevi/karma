// The bundled menu. parseCatalog throws on bad data, so a broken catalog fails
// the build's tests and the app start instead of selling wrong prices.
import rawCatalog from "../../catalog/catalog.json";
import { parseCatalog } from "../domain/catalog.ts";

export const catalog = parseCatalog(rawCatalog);
