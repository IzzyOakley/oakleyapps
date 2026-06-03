# DXF layer name configurations for SharedParams extraction.
#
# Layer names calibrated from real Oakley DXF files (3500 Madison - Morrissey).
# Oakley drafters use a "STD-*" layer convention. Floor areas are on STD-AREA.
# Floor SF values are extracted primarily from the MTEXT area schedule label
# on the STD-AREA layer in the pl1 (first floor) DXF file.
#
# "primary": True means the parameter is required for high confidence — if the area is 0,
# confidence drops to medium or low.

DXF_LAYER_CONFIG: dict[str, dict] = {
    # ── Floor area layers ─────────────────────────────────────────────────────
    # All floor areas live on STD-AREA. The MTEXT label in pl1 contains a
    # precomputed area schedule (FIRST FLOOR / SECOND FLOOR / TOTAL).
    # _extract_area is used only as a fallback when MTEXT parsing fails.
    "first_floor_sf": {
        "layers": ["STD-AREA"],
        "primary": True,
    },
    "second_floor_sf": {
        "layers": ["STD-AREA"],
        "primary": False,
    },
    "third_floor_sf": {
        "layers": ["STD-AREA"],
        "primary": False,
    },
    # Basement areas come from bsmt.dxf STD-AREA LWPOLYLINEs.
    # Larger polygon = finished basement, smaller = unfinished.
    "basement_sf_finished": {
        "layers": ["STD-AREA"],
        "primary": False,
    },
    "basement_sf_unfinished": {
        "layers": ["STD-AREA"],
        "primary": False,
    },
    "garage_sf": {
        "layers": ["STD-AREA"],
        "primary": False,
    },
    "first_floor_footprint_sf": {
        "layers": ["STD-AREA", "P-BLDG"],
        "primary": True,
    },
    # ── Block name patterns for bathroom counts (INSERT entities) ─────────────
    "bathroom_count_full": {
        "layers": ["STD-PLUMB-FIX", "A-PLUMB-FIX"],
        "block_patterns": ["wc-std", "WC-STD"],
    },
    "bathroom_count_half": {
        "layers": ["STD-PLUMB-FIX", "A-PLUMB-FIX"],
        "block_patterns": ["wc-half", "WC-HALF", "plunge", "PLUNGE"],
    },
    # ── Layer-presence check — entity on layer = True ─────────────────────────
    # STD-FUTURE 1/2 layers may contain detached garage or optional structures.
    "has_detached_garage": {
        "layers": ["STD-FUTURE 1", "STD-FUTURE 2"],
    },
}

# Layers expected in a complete Oakley DXF file.
# Used to populate layers_found / layers_missing in SharedParams.
EXPECTED_LAYERS: list[str] = [
    "STD-AREA",
    "STD-WALL",
    "STD-OPENING",
    "STD-PLUMB-FIX",
    "P-BLDG",
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
