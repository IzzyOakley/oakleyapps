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
    pubsub_mod = types.ModuleType("google.cloud.pubsub_v1")

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

    class _FakePublisher:
        def __init__(self, *a, **kw):
            pass

        def topic_path(self, project: str, topic: str) -> str:
            return f"projects/{project}/topics/{topic}"

        def publish(self, topic_path: str, data: bytes, **attrs):
            class _FakeFuture:
                def result(self):
                    return "fake-message-id"

            return _FakeFuture()

    firestore_mod.Client = _FakeClient
    storage_mod.Client = _FakeClient
    pubsub_mod.PublisherClient = _FakePublisher

    google.cloud = google_cloud
    google_cloud.firestore = firestore_mod
    google_cloud.storage = storage_mod
    google_cloud.pubsub_v1 = pubsub_mod

    sys.modules.setdefault("google", google)
    sys.modules["google.cloud"] = google_cloud
    sys.modules["google.cloud.firestore"] = firestore_mod
    sys.modules["google.cloud.storage"] = storage_mod
    sys.modules["google.cloud.pubsub_v1"] = pubsub_mod


_stub_google_cloud()
