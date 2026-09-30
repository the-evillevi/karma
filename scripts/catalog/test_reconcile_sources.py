import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from reconcile_sources import (
    availability,
    candidate_stock_mode,
    normalize_text,
    parse_cents,
    resolve_private_directory,
    write_private_json,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class ReconcileSourceHelpersTests(unittest.TestCase):
    def test_availability_accepts_boolean_numeric_and_string_values(self):
        cases = [
            (True, True), (False, False), (1, True), (0, False),
            ("Y", True), ("yes", True), ("sí", True), ("1", True),
            ("N", False), ("no", False), ("0", False),
            (None, None), ("", None), ("pending", None),
        ]
        for value, expected in cases:
            with self.subTest(value=repr(value)):
                self.assertIs(availability(value), expected)

    def test_text_normalization_preserves_falsy_non_null_values(self):
        self.assertEqual(normalize_text(None), "")
        self.assertEqual(normalize_text(False), "false")
        self.assertEqual(normalize_text(0), "0")

    def test_centavo_parser_is_exact_and_rejects_precision_or_negative_amounts(self):
        cases = [
            (12, 1200), (12.3, 1230), (12.34, 1234),
            ("12.34", 1234), ("1,234.56", 123456), (Decimal("0.01"), 1),
            ("0", 0), ("12.345", None), ("1,23", None), (-1, None), ("", None),
        ]
        for value, expected in cases:
            with self.subTest(value=repr(value)):
                self.assertEqual(parse_cents(value), expected)

    def test_stock_mode_stays_unknown_until_piece_identity_is_confirmed(self):
        self.assertEqual(candidate_stock_mode(identity_match=False, piece_unit=True, recipe_match=False), "unknown")
        self.assertEqual(candidate_stock_mode(identity_match=True, piece_unit=False, recipe_match=False), "unknown")
        self.assertEqual(candidate_stock_mode(identity_match=True, piece_unit=True, recipe_match=True), "unknown")
        self.assertEqual(candidate_stock_mode(identity_match=True, piece_unit=True, recipe_match=False), "piece")

    def test_private_directory_refuses_repository_paths_and_secures_created_output(self):
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            resolve_private_directory(REPOSITORY_ROOT / "source-dump", REPOSITORY_ROOT)
        with tempfile.TemporaryDirectory() as temporary:
            private = resolve_private_directory(Path(temporary) / "catalog", REPOSITORY_ROOT)
            self.assertEqual(private.stat().st_mode & 0o777, 0o700)
            path = write_private_json(private, "synthetic.json", {"count": 1})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_private_writer_refuses_symlinked_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            destination = directory / "outside.json"
            destination.write_text("sentinel")
            link = directory / "candidate-catalog.json"
            link.symlink_to(destination)
            with self.assertRaisesRegex(ValueError, "cannot be a symlink"):
                write_private_json(directory, link.name, {"private": "source data"})
            self.assertEqual(destination.read_text(), "sentinel")


if __name__ == "__main__":
    unittest.main()
