# DXF layer name configurations for SharedParams extraction.
#
# IMPORTANT: These are best-guess defaults based on common architectural DXF conventions.
# They MUST be verified and updated from real Oakley DXF files in Phase 16.
#
# "primary": True means the parameter is required for high confidence — if the area is 0,
# confidence drops to medium or low.

DXF_LAYER_CONFIG: dict[str, dict] = {
    # ── Floor area layers (LWPOLYLINE closed or HATCH) ────────────────────────
    "first_floor_sf": {
        "layers": [
            "FIRST_FLOOR",
            "1ST_FLOOR",
            "FLOOR_1",
            "FIRST FLOOR",
            "1ST FLOOR",
            "FF",
        ],
        "primary": True,
    },
    "second_floor_sf": {
        "layers": [
            "SECOND_FLOOR",
            "2ND_FLOOR",
            "FLOOR_2",
            "SECOND FLOOR",
            "2ND FLOOR",
            "SF",
        ],
        "primary": False,
    },
    "third_floor_sf": {
        "layers": [
            "THIRD_FLOOR",
            "3RD_FLOOR",
            "FLOOR_3",
            "THIRD FLOOR",
            "3RD FLOOR",
            "TF",
        ],
        "primary": False,
    },
    "basement_sf_finished": {
        "layers": [
            "BSMT_FINISHED",
            "BASEMENT_FINISHED",
            "BSMT FIN",
            "BASEMENT FIN",
            "BSMT_FIN",
        ],
        "primary": False,
    },
    "basement_sf_unfinished": {
        "layers": [
            "BSMT_UNFINISHED",
            "BASEMENT_UNFINISHED",
            "BSMT UNFIN",
            "BASEMENT UNFIN",
            "BSMT_UNFIN",
        ],
        "primary": False,
    },
    "garage_sf": {
        "layers": [
            "GARAGE",
            "GARAGE_AREA",
            "ATTACHED_GARAGE",
            "ATT_GARAGE",
            "ATT GARAGE",
            "GAR",
        ],
        "primary": False,
    },
    "first_floor_footprint_sf": {
        "layers": [
            "FOOTPRINT",
            "BLDG_FOOTPRINT",
            "BUILDING_FOOTPRINT",
            "BLDG FOOTPRINT",
            "BLDG_OUTLINE",
            "BUILDING OUTLINE",
        ],
        "primary": True,
    },
    # ── Block name patterns for bathroom counts (INSERT entities) ─────────────
    "bathroom_count_full": {
        "layers": ["PLUMBING", "FIXTURES", "BATH", "BATHROOM"],
        "block_patterns": ["BATH", "FULL_BATH", "FULL BATH", "FULL-BATH", "BATHROOM"],
    },
    "bathroom_count_half": {
        "layers": ["PLUMBING", "FIXTURES", "BATH", "BATHROOM"],
        "block_patterns": [
            "HALF_BATH",
            "HALF BATH",
            "HALF-BATH",
            "POWDER",
            "POWDER_ROOM",
            "POWDER ROOM",
        ],
    },
    # ── Layer-presence check — entity on layer = True ─────────────────────────
    "has_detached_garage": {
        "layers": ["DETACHED_GARAGE", "DET_GARAGE", "DETACHED GARAGE", "DET GARAGE"],
    },
}

# Layers expected in a complete Oakley DXF file.
# Used to populate layers_found / layers_missing in SharedParams.
# Update from real DXF files in Phase 16.
EXPECTED_LAYERS: list[str] = [
    "FIRST_FLOOR",
    "SECOND_FLOOR",
    "FOOTPRINT",
    "GARAGE",
    "BASEMENT_FINISHED",
    "BASEMENT_UNFINISHED",
]

# DXF $INSUNITS integer → linear units per foot.
# Area conversion: area_sf = area_drawing_units² / (linear_per_foot²)
# See DXF spec table for full list.
INSUNITS_TO_FEET: dict[int, tuple[float, str]] = {
    0: (1.0, "unitless — assuming feet"),
    1: (12.0, "inches"),
    2: (1.0, "feet"),
    4: (3280.84, "millimeters"),  # mm → ft: 1 ft = 304.8 mm → 1 mm = 1/304.8 ft
    5: (328.084, "centimeters"),
    6: (3.28084, "meters"),
}
