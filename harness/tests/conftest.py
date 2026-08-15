"""Makes the flat harness/ modules importable from tests/ without a package."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
