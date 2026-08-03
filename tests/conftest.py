"""Configure isolated infrastructure before application modules are imported."""

import os


os.environ.setdefault("AI_IMAGE_GAME_DATABASE_URL", "sqlite:///:memory:")
