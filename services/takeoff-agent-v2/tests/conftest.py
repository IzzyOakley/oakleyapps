"""
Stub out google.cloud packages so tests that import main.py work locally
without google-cloud-firestore / google-cloud-storage installed.
CI installs the real packages from requirements.txt.
"""

import sys
import types


def _stub_google_cloud():
    if "google.cloud.firestore" in sys.modules:
        return

    google = types.ModuleType("google")
    google_cloud = types.ModuleType("google.cloud")
    firestore_mod = types.ModuleType("google.cloud.firestore")
    storage_mod = types.ModuleType("google.cloud.storage")

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

    firestore_mod.Client = _FakeClient
    storage_mod.Client = _FakeClient

    google.cloud = google_cloud
    google_cloud.firestore = firestore_mod
    google_cloud.storage = storage_mod

    sys.modules.setdefault("google", google)
    sys.modules["google.cloud"] = google_cloud
    sys.modules["google.cloud.firestore"] = firestore_mod
    sys.modules["google.cloud.storage"] = storage_mod


_stub_google_cloud()
