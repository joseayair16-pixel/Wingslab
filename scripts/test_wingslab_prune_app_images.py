import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("wingslab-prune-app-images.py")
SPEC = importlib.util.spec_from_file_location("wingslab_prune_images", SCRIPT)
PRUNE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRUNE)


class SelectObsoleteImageTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"Repository": "wingslab-customer", "Tag": "candidate-old", "ID": "id-old", "CreatedAt": "2026-01-01"},
            {"Repository": "wingslab-customer", "Tag": "candidate-new", "ID": "id-new", "CreatedAt": "2026-02-01"},
            {"Repository": "wingslab-customer", "Tag": "same-image-alias", "ID": "id-new", "CreatedAt": "2026-02-01"},
            {"Repository": "wingslab-restaurant", "Tag": "pinned", "ID": "id-pinned", "CreatedAt": "2026-03-01"},
            {"Repository": "some-other-project", "Tag": "unrelated", "ID": "id-other", "CreatedAt": "2026-04-01"},
        ]

    def test_keeps_newest_unpinned_image_per_app_by_default(self):
        candidates = PRUNE.select_obsolete_rows(self.rows, {"id-pinned"}, 1)
        self.assertEqual([(row["Repository"], row["Tag"]) for row in candidates], [
            ("wingslab-customer", "candidate-old"),
        ])

    def test_zero_retention_removes_all_unpinned_app_tags_only(self):
        candidates = PRUNE.select_obsolete_rows(self.rows, {"id-pinned"}, 0)
        self.assertEqual({row["Tag"] for row in candidates}, {"candidate-old", "candidate-new", "same-image-alias"})

    def test_multiple_aliases_of_one_image_use_one_retention_slot(self):
        candidates = PRUNE.select_obsolete_rows(self.rows, set(), 1)
        self.assertEqual([row["Tag"] for row in candidates], ["candidate-old"])


if __name__ == "__main__":
    unittest.main()
