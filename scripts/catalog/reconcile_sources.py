#!/usr/bin/env python3
"""Privately reconcile the two Karma source workbooks against the prototype seed.

The JSON output contains source rows and candidate menu values. Keep it outside
the repository. Only aggregate coverage/discrepancy counts are written to stdout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import unicodedata
import posixpath
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree


DEFAULT_STOCK = Path.home() / "Downloads/ReporteDeStock_52000822_2026-8-6-1813618144.xlsx"
DEFAULT_PRODUCTS = Path.home() / "Downloads/products-Today.xlsx"
DEFAULT_PRIVATE_DIR = Path.home() / ".codex/karma-private/catalog"
SEED_PATH = Path(__file__).resolve().parents[2] / "catalog/catalog.json"


def normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.findall(r"[a-z0-9]+", text.casefold()))


def serializable(value: object) -> object:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def column_index(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    if not letters:
        return 0
    index = 0
    for char in letters.group(0):
        index = index * 26 + ord(char) - ord("A") + 1
    return index - 1


def workbook_rows(path: Path, required_headers: set[str]) -> tuple[dict, list[dict]]:
    # Parse worksheet XML directly: one supplied workbook has reversed merged
    # range metadata that makes normal spreadsheet readers abort, although its
    # row/cell data is readable. This path is strictly read-only.
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    with zipfile.ZipFile(path) as archive:
        embedded_media_files = sum(1 for name in archive.namelist() if name.startswith("xl/media/") and not name.endswith("/"))
        workbook_xml = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        rels_xml = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationship_targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_xml}
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_xml = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = ["".join(node.itertext()) for node in shared_xml.findall("m:si", namespace)]
        sheet_summaries = []
        records = []
        for sheet_node in workbook_xml.findall("m:sheets/m:sheet", namespace):
            target = relationship_targets[sheet_node.attrib[f"{{{namespace['r']}}}id"]]
            sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            sheet_xml = ElementTree.fromstring(archive.read(sheet_path))
            dimension_node = sheet_xml.find("m:dimension", namespace)
            dimension = dimension_node.attrib.get("ref", "") if dimension_node is not None else ""
            dimension_end = dimension.split(":")[-1]
            dimension_row = int(re.search(r"\d+$", dimension_end).group(0)) if re.search(r"\d+$", dimension_end) else 0
            dimension_col = column_index(dimension_end)
            row_data = []
            formula_cells = 0
            formula_cells_without_cached_value = 0
            for row_node in sheet_xml.findall("m:sheetData/m:row", namespace):
                row_number = int(row_node.attrib.get("r", len(row_data) + 1))
                cells = {}
                for cell in row_node.findall("m:c", namespace):
                    cell_type = cell.attrib.get("t")
                    value_node = cell.find("m:v", namespace)
                    if cell.find("m:f", namespace) is not None:
                        formula_cells += 1
                        if value_node is None:
                            formula_cells_without_cached_value += 1
                    if cell_type == "inlineStr":
                        value = "".join(cell.find("m:is", namespace).itertext()) if cell.find("m:is", namespace) is not None else ""
                    elif value_node is None:
                        value = None
                    elif cell_type == "s":
                        value = shared_strings[int(value_node.text)]
                    elif cell_type == "b":
                        value = value_node.text == "1"
                    elif cell_type in {"str", "e"}:
                        value = value_node.text
                    else:
                        try:
                            numeric = Decimal(value_node.text)
                            value = int(numeric) if numeric == numeric.to_integral_value() else float(numeric)
                        except (InvalidOperation, TypeError):
                            value = value_node.text
                    cells[column_index(cell.attrib.get("r", "A1"))] = serializable(value)
                if cells:
                    row_data.append((row_number, cells))
            header_row = None
            headers = []
            for row_number, cells in row_data:
                row_headers = [str(cells.get(index) or "").strip() for index in range(max(cells, default=-1) + 1)]
                if required_headers.issubset({normalize_text(value) for value in row_headers}):
                    header_row = row_number
                    headers = row_headers
                    break
            count = 0
            if header_row is not None:
                for row_number, cells in row_data:
                    if row_number <= header_row:
                        continue
                    row = [cells.get(index) for index in range(max(cells, default=-1) + 1)]
                    if not any(value is not None for value in row):
                        continue
                    record = {headers[index]: row[index] for index in range(min(len(headers), len(row))) if headers[index] and row[index] is not None}
                    record["_sourceRow"] = row_number
                    records.append(record)
                    count += 1
            sheet_summaries.append({
                "name": sheet_node.attrib.get("name"),
                "maxRow": max(dimension_row, max((row for row, _ in row_data), default=0)),
                "maxColumn": max(dimension_col + 1, max((max(cells, default=-1) + 1 for _, cells in row_data), default=0)),
                "headerRow": header_row,
                "headers": [header for header in headers if header],
                "dataRows": count,
                "mergedCellMetadataSkipped": True,
                "formulaCells": formula_cells,
                "formulaCellsWithoutCachedValue": formula_cells_without_cached_value,
            })
    stat_result = path.stat()
    file_summary = {
        "filename": path.name,
        "sizeBytes": stat_result.st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "embeddedMediaFiles": embedded_media_files,
        "sheets": sheet_summaries,
    }
    return file_summary, records


def get_field(record: dict, normalized_header: str) -> object:
    for header, value in record.items():
        if header == "_sourceRow":
            continue
        if normalize_text(header) == normalized_header:
            return value
    return None


def parse_cents(value: object) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        pesos = Decimal(str(value).replace(",", "").replace("$", "").strip())
    except InvalidOperation:
        return None
    centavos = pesos * 100
    if not centavos.is_finite() or centavos != centavos.to_integral_value():
        return None
    return int(centavos)


def availability(value: object) -> bool | None:
    if value is None:
        return None
    normalized = normalize_text(value)
    if normalized in {"y", "yes", "si", "1", "true", "disponible"}:
        return True
    if normalized in {"n", "no", "0", "false", "no disponible"}:
        return False
    return None


def load_seed(seed_path: Path) -> dict:
    return json.loads(seed_path.read_text())


def source_key(record: dict) -> str:
    return normalize_text(get_field(record, "nombre"))


def build_reconciliation(stock_path: Path, products_path: Path, seed_path: Path) -> tuple[dict, dict]:
    stock_file, stock_records = workbook_rows(stock_path, {"categoria", "nombre", "sku", "stock actual", "unidad"})
    product_file, product_records = workbook_rows(products_path, {"categoria", "nombre", "sku", "precio del menu"})
    seed = load_seed(seed_path)

    stock_by_sku: dict[str, list[dict]] = {}
    stock_by_name: dict[str, list[dict]] = {}
    for row in stock_records:
        sku = str(get_field(row, "sku") or "").strip()
        if sku:
            stock_by_sku.setdefault(sku, []).append(row)
        key = source_key(row)
        if key:
            stock_by_name.setdefault(key, []).append(row)

    products_by_name: dict[str, list[dict]] = {}
    for row in product_records:
        key = source_key(row)
        if key:
            products_by_name.setdefault(key, []).append(row)

    candidate_products = []
    comparison_stats = {
        "exactMenuNameMatches": 0,
        "menuNameUnmatched": 0,
        "menuNameAmbiguous": 0,
        "sourceMenuPricePresent": 0,
        "prototypeVsMenuPriceDifferent": 0,
        "sourceAvailabilityKnown": 0,
        "prototypeVsSourceAvailabilityDifferent": 0,
        "categoryLabelDifferent": 0,
        "stockSkuMatches": 0,
        "stockPieceUnitCandidates": 0,
        "recipeVsPieceCandidateConflicts": 0,
        "stockSkuNameConflicts": 0,
        "stockNameFallbackMatches": 0,
        "stockMappingMissingOrAmbiguous": 0,
        "stockRowsWithoutSku": sum(1 for row in stock_records if not str(get_field(row, "sku") or "").strip()),
        "menuRowsWithoutSku": sum(1 for row in product_records if not str(get_field(row, "sku") or "").strip()),
        "duplicateNormalizedMenuNameGroups": 0,
        "duplicateMenuSkuGroups": 0,
        "duplicateStockSkuGroups": 0,
        "menuRowsWithImageFieldValue": sum(1 for row in product_records if get_field(row, "imagen") not in (None, "")),
    }
    seed_recipe_names = {
        normalize_text(product["name"]) for product in seed["products"]
        if product.get("stockControl", {}).get("mode") == "recipe"
    }
    seed_finished_good_names = {
        normalize_text(product["name"]) for product in seed["products"]
        if product.get("stockControl", {}).get("mode") == "piece"
    }
    seed_category_labels = {category["id"]: category["name"] for category in seed["categories"]}
    comparison_stats["prototypeRecipeProducts"] = len(seed_recipe_names)
    comparison_stats["prototypeFinishedGoodProducts"] = len(seed_finished_good_names)
    comparison_stats["duplicateNormalizedMenuNameGroups"] = sum(1 for matches in products_by_name.values() if len(matches) > 1)
    for rows, field, stat_name in (
        (product_records, "sku", "duplicateMenuSkuGroups"),
        (stock_records, "sku", "duplicateStockSkuGroups"),
    ):
        sku_counts: dict[str, int] = {}
        for row in rows:
            sku = str(get_field(row, field) or "").strip()
            if sku:
                sku_counts[sku] = sku_counts.get(sku, 0) + 1
        comparison_stats[stat_name] = sum(1 for count in sku_counts.values() if count > 1)

    for product in seed["products"]:
        name_key = normalize_text(product.get("name"))
        matches = products_by_name.get(name_key, [])
        entry = {
            "prototypeProductId": product["id"],
            "prototypeName": product["name"],
            "prototypeCategoryId": product["categoryId"],
            "prototypePriceCents": product["price"].get("amountCents"),
            "prototypeAvailable": bool(product.get("available")),
            "menuSourceStatus": "unmatched",
            "menuSourceRows": [],
            "stockSourceStatus": "unmatched",
            "stockSourceRows": [],
            "candidateStockMode": "unknown",
            "stockEvidence": [],
            "prototypeStockMode": product.get("stockControl", {}).get("mode", "unknown"),
        }
        if len(matches) == 1:
            match = matches[0]
            comparison_stats["exactMenuNameMatches"] += 1
            entry["menuSourceStatus"] = "exact-normalized-name-candidate-review-required"
            entry["menuSourceRows"] = [match]
            source_price = parse_cents(get_field(match, "precio del menu"))
            source_available = availability(get_field(match, "disponible"))
            entry["candidateMenuPriceCents"] = source_price
            entry["candidateCurrency"] = "MXN" if source_price is not None else None
            entry["candidateSourceName"] = get_field(match, "nombre")
            entry["candidateSourceCategory"] = get_field(match, "categoria")
            entry["candidateSku"] = str(get_field(match, "sku") or "").strip() or None
            entry["candidateSourceAvailability"] = source_available
            entry["sourceVatMenu"] = get_field(match, "iva del menu")
            if source_price is not None:
                comparison_stats["sourceMenuPricePresent"] += 1
                if entry["prototypePriceCents"] != source_price:
                    comparison_stats["prototypeVsMenuPriceDifferent"] += 1
            if source_available is not None:
                comparison_stats["sourceAvailabilityKnown"] += 1
                if entry["prototypeAvailable"] != source_available:
                    comparison_stats["prototypeVsSourceAvailabilityDifferent"] += 1
            if normalize_text(get_field(match, "categoria")) != normalize_text(seed_category_labels.get(product["categoryId"], product["categoryId"])):
                comparison_stats["categoryLabelDifferent"] += 1

            sku = entry["candidateSku"]
            stock_matches = stock_by_sku.get(sku, []) if sku else []
            if len(stock_matches) == 1:
                stock = stock_matches[0]
                comparison_stats["stockSkuMatches"] += 1
                stock_name_match = source_key(stock) == name_key
                entry["stockSourceStatus"] = "sku-name-match" if stock_name_match else "sku-match-name-conflict-review-required"
                entry["stockSourceRows"] = stock_matches
                piece_unit = normalize_text(get_field(stock, "unidad")) in {"pza", "pz", "pieza", "piezas", "piece", "pieces", "ea"}
                if piece_unit:
                    comparison_stats["stockPieceUnitCandidates"] += 1
                if piece_unit and name_key in seed_recipe_names:
                    comparison_stats["recipeVsPieceCandidateConflicts"] += 1
                entry["candidateStockMode"] = "piece" if piece_unit and name_key not in seed_recipe_names else "unknown"
                if stock_name_match:
                    entry["stockEvidence"].append("Source SKU and normalized product name match; review unit and business mapping.")
                    if name_key in seed_recipe_names:
                        entry["stockEvidence"].append("Prototype recipe also exists; the workbooks do not establish recipe contents or settle recipe-versus-piece control.")
                    elif not piece_unit:
                        entry["stockEvidence"].append("Source SKU matches, but the reported unit is not an explicit piece unit.")
                else:
                    comparison_stats["stockSkuNameConflicts"] += 1
                    entry["stockEvidence"].append("SKU matches but stock name differs; human reconciliation required.")
            elif len(stock_matches) > 1:
                comparison_stats["stockMappingMissingOrAmbiguous"] += 1
                entry["stockSourceStatus"] = "duplicate-sku-ambiguous"
            else:
                stock_name_matches = stock_by_name.get(name_key, [])
                if len(stock_name_matches) == 1:
                    comparison_stats["stockNameFallbackMatches"] += 1
                    entry["stockSourceStatus"] = "name-only-candidate-review-required"
                    entry["stockSourceRows"] = stock_name_matches
                    unit = normalize_text(get_field(stock_name_matches[0], "unidad"))
                    if unit in {"pza", "pz", "pieza", "piezas", "piece", "pieces", "ea"}:
                        comparison_stats["stockPieceUnitCandidates"] += 1
                        if name_key in seed_recipe_names:
                            comparison_stats["recipeVsPieceCandidateConflicts"] += 1
                    entry["candidateStockMode"] = "piece" if unit in {"pza", "pz", "pieza", "piezas", "piece", "pieces", "ea"} and name_key not in seed_recipe_names else "unknown"
                    entry["stockEvidence"].append("Only normalized name matches; identity and stock behavior need human review.")
                    if name_key in seed_recipe_names:
                        entry["stockEvidence"].append("Prototype recipe also exists; the workbooks do not establish recipe contents or settle recipe-versus-piece control.")
                else:
                    comparison_stats["stockMappingMissingOrAmbiguous"] += 1
                    entry["stockSourceStatus"] = "no-name-match" if not stock_name_matches else "name-ambiguous"

        elif len(matches) > 1:
            comparison_stats["menuNameAmbiguous"] += 1
            entry["menuSourceStatus"] = "duplicate-normalized-name-ambiguous"
            entry["menuSourceRows"] = matches
        else:
            comparison_stats["menuNameUnmatched"] += 1
            if name_key in seed_recipe_names:
                entry["stockEvidence"].append("Prototype recipe exists, but source recipe and quantities were not present in the inspected workbook fields.")
        candidate_products.append(entry)

    seed_name_keys = {normalize_text(product["name"]) for product in seed["products"]}
    matched_stock_skus = {
        str(get_field(row, "sku") or "").strip()
        for entry in candidate_products
        for row in entry["stockSourceRows"]
        if str(get_field(row, "sku") or "").strip()
    }
    unmatched_source_products = [row for row in product_records if source_key(row) not in seed_name_keys]
    unmatched_stock_rows = [row for row in stock_records if str(get_field(row, "sku") or "").strip() not in matched_stock_skus]
    candidate = {
        "status": "private-source-derived-candidate-awaiting-Carlos-validation",
        "currency": "MXN",
        "sourcePriceField": "Precio del menu",
        "priceUse": "candidate only; not approved for publication or runtime import",
        "products": candidate_products,
    }
    reconciliation = {
        "privacy": "private-working-file; contains source rows, SKU and menu pricing",
        "sourceFiles": {"stock": stock_file, "products": product_file},
        "sourceCoverage": {
            "stockDataRows": len(stock_records),
            "menuDataRows": len(product_records),
            "prototypeProducts": len(seed["products"]),
            "prototypeCategories": len(seed["categories"]),
            "prototypeModifierGroups": len(seed["modifierGroups"]),
        },
        "comparisons": comparison_stats,
        "candidateCatalog": candidate,
        "unmatchedSourceMenuRows": unmatched_source_products,
        "unmatchedStockRows": unmatched_stock_rows,
        "sources": {"stockRows": stock_records, "menuRows": product_records},
        "businessGates": [
            "Carlos must validate candidate product names, category/order, menu prices, VAT handling, availability, options and stock control.",
            "Photos remain unavailable and are not mapped to catalog products.",
            "No workbook field in these files supplies modifier selection rules or complete recipes/BOM quantities.",
            "Inventory stock quantities are not menu sale prices and are not substituted for them.",
        ],
    }
    return reconciliation, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stock", type=Path, default=DEFAULT_STOCK)
    parser.add_argument("--products", type=Path, default=DEFAULT_PRODUCTS)
    parser.add_argument("--private-dir", type=Path, default=DEFAULT_PRIVATE_DIR)
    parser.add_argument("--seed", type=Path, default=SEED_PATH)
    args = parser.parse_args()
    for source in (args.stock, args.products):
        if not source.is_file():
            raise SystemExit(f"Missing source workbook: {source}")
    args.private_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.private_dir.chmod(0o700)
    reconciliation, candidate = build_reconciliation(args.stock, args.products, args.seed)
    for name, payload in (("source-reconciliation.json", reconciliation), ("candidate-catalog.json", candidate)):
        path = args.private_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    print(json.dumps({
        "privateOutputDirectory": str(args.private_dir),
        "workbooks": [
            {"filename": f["filename"], "sizeBytes": f["sizeBytes"], "sha256": f["sha256"], "sheets": f["sheets"]}
            for f in reconciliation["sourceFiles"].values()
        ],
        "sourceCoverage": reconciliation["sourceCoverage"],
        "comparisons": reconciliation["comparisons"],
        "candidateStatus": candidate["status"],
        "businessGates": len(reconciliation["businessGates"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
