# Agent registry — maps cost_code → agent definition.
# agent_type values: sf_formula | dxf_count | dxf_area | dxf_geometry | project_flag | historical_avg | manual_hold | skip
# Layer names calibrated from real Oakley DXF files (Madison Morrissey, Lot 6, Lot 7) — Phase 16.
# dxf_file_hint selects the correct DXF sheet when a project has multiple files.
# requires_dxf=False agents run without a DXF file present.

AGENT_REGISTRY: dict[str, dict] = {
    "1000": {
        "agent_class_name": "DemoSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "first_floor_footprint_sf + garage_sf",
            "inputs": ["first_floor_footprint_sf", "garage_sf"],
            "unit": "SF",
        },
    },
    "1100": {
        "agent_class_name": "ExcavationSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "first_floor_footprint_sf",
            "inputs": ["first_floor_footprint_sf"],
            "unit": "CY",
            "depth_factor": 0.125,  # CY per SF — calibrate from pilot
        },
    },
    # 1200: Foundation walls are drawn as LINE entities in Oakley DXFs, not LWPOLYLINE.
    # dxf_geometry requires LWPOLYLINE — switch to historical_avg until LINE perimeter
    # support is added.
    "1200": {
        "agent_class_name": "FoundationHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "CY"},
    },
    "1300": {
        "agent_class_name": "FramingLaborSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf + garage_sf",
            "inputs": ["total_finished_sf", "garage_sf"],
            "unit": "SF",
        },
    },
    "1400": {
        "agent_class_name": "FramingLumberSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf",
            "inputs": ["total_finished_sf"],
            "unit": "BF",
            "lumber_factor": 6.0,  # BF per SF — calibrate from pilot
        },
    },
    # 1500: Steel beams appear as INSERT blocks named W6X*, W8X*, etc. on any layer.
    # Use fdn.dxf — structural beams are shown on the foundation/structural plan.
    "1500": {
        "agent_class_name": "StructuralSteelDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": [],  # any layer — beam blocks are not layer-isolated
            "block_name_patterns": ["W6X", "W8X", "W10X", "W12X", "W14X", "W16X"],
            "unit": "EA",
            "dxf_file_hint": "fdn",
        },
    },
    # 1600: Roof outline is layer EXT-TRIM-3 (closed LWPOLYLINE) on the roof DXF.
    "1600": {
        "agent_class_name": "RoofingDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "roof_area",
            "target_layers": ["EXT-TRIM-3"],
            "default_pitch": "8/12",
            "unit": "SQ",
            "dxf_file_hint": "roof",
        },
    },
    # 1700: Siding area has no closed LWPOLYLINE in Oakley elevation DXFs.
    # Switch to historical_avg until elevation parsing improves.
    "1700": {
        "agent_class_name": "SidingHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "SF"},
    },
    # 1800: Stone and brick hatches on elevation DXF use EXT-HATCH-STONE / EXT-HATCH-BRICK.
    "1800": {
        "agent_class_name": "MasonryDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["EXT-HATCH-STONE", "EXT-HATCH-BRICK"],
            "min_area_sf": 5.0,
            "unit": "SF",
            "dxf_file_hint": "elev",
        },
    },
    "1900": {
        "agent_class_name": "StuccoHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    # 2000: Windows are drawn as LINE entities on EXT-WINDOW — no INSERT blocks.
    # Switch to historical_avg.
    "2000": {
        "agent_class_name": "WindowsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "EA"},
    },
    # 2100-2300: Exterior / front / garage doors are not layer-separated from interior
    # doors in Oakley DXFs — can't reliably distinguish. Switch to historical_avg.
    "2100": {
        "agent_class_name": "ExteriorDoorsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "EA"},
    },
    "2200": {
        "agent_class_name": "FrontDoorHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "EA"},
    },
    "2300": {
        "agent_class_name": "GarageDoorHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "EA"},
    },
    "2400": {
        "agent_class_name": "InsulationSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf + garage_sf",
            "inputs": ["total_finished_sf", "garage_sf"],
            "unit": "SF",
        },
    },
    "2500": {
        "agent_class_name": "DrywallSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf * 1.15",
            "inputs": ["total_finished_sf"],
            "multiplier": 1.15,
            "unit": "SF",
        },
    },
    # 2600: All door openings are INSERT blocks on layer STD-OPENING.
    # Block names observed: DOOR, DR1H variants.
    "2600": {
        "agent_class_name": "InteriorDoorsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["STD-OPENING"],
            "block_name_patterns": ["DOOR", "DR1H"],
            "unit": "EA",
        },
    },
    "2700": {
        "agent_class_name": "InteriorTrimHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    # 2800-2900: Cabinets and countertops are drawn as LINE entities on STD-CABINET /
    # STD-COUNTER — no INSERT blocks to count. Switch to historical_avg.
    "2800": {
        "agent_class_name": "CabinetsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LF"},
    },
    "2900": {
        "agent_class_name": "CountertopsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LF"},
    },
    # 3000-3300: Flooring types (hardwood, tile, carpet) have no polygon or hatch areas
    # in Oakley plan DXFs. Switch to historical_avg.
    "3000": {
        "agent_class_name": "HardwoodHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "SF"},
    },
    "3100": {
        "agent_class_name": "TileMaterialsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "SF"},
    },
    "3200": {
        "agent_class_name": "TileInstallationHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "SF"},
    },
    "3300": {
        "agent_class_name": "CarpetHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "SY"},
    },
    # 3400: Stair arrows on STD-STAIR are directional symbols, not flight-count markers.
    # Arrow count does not equal flight count. Switch to historical_avg.
    "3400": {
        "agent_class_name": "StairsHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "Flight"},
    },
    # 3500: Eave perimeter is layer EXT-TRIM-3 (same outline used for roof area).
    "3500": {
        "agent_class_name": "GuttersDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "eave_perimeter",
            "target_layers": ["EXT-TRIM-3"],
            "unit": "LF",
            "dxf_file_hint": "roof",
        },
    },
    # 3600: Plumbing fixtures are INSERT blocks on STD-PLUMB-FIX (toilets, sinks, tubs,
    # showers) and STD-PLUMB-FLUSH (flush valves), STD-OPTL (optional items like ice
    # makers, bar sinks). Block names observed across Madison, Lot 6, Lot 7.
    "3600": {
        "agent_class_name": "PlumbingDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": [
                "STD-PLUMB-FIX",
                "A-PLUMB-FIX",
                "STD-PLUMB-FLUSH",
                "STD-OPTL",
            ],
            "block_name_patterns": [
                "wc-std",
                "b-lav-std",
                "b-tub-std",
                "shwr",
                "TUB",
                "OVALTUB",
                "SINGBOWLSINK",
                "VEGSINK",
                "kit sing bowl",
                "K-DBLOV",
                "plunge",
            ],
            "unit": "Fix",
        },
    },
    "3700": {
        "agent_class_name": "HVACSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf + basement_sf_finished",
            "inputs": ["total_finished_sf", "basement_sf_finished"],
            "unit": "SF",
        },
    },
    "3800": {
        "agent_class_name": "ElectricalManualHoldAgent",
        "agent_type": "manual_hold",
        "requires_dxf": False,
        "agent_config": {
            "note": "Manual entry required — contact Karen for electrical estimate.",
            "unit": "LS",
        },
    },
    "3900": {
        "agent_class_name": "LightingManualHoldAgent",
        "agent_type": "manual_hold",
        "requires_dxf": False,
        "agent_config": {
            "note": "Manual entry required — contact Karen for lighting estimate.",
            "unit": "LS",
        },
    },
    # 4000: Appliances are INSERT blocks on layer STD-APPLIANCE.
    # Block names observed: washer/dryer combos, dishwasher, refrigerators, ranges, ice makers.
    "4000": {
        "agent_class_name": "AppliancesDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["STD-APPLIANCE"],
            "block_name_patterns": [
                "l-wd-sbs-std",
                "stack-wd",
                "k-dw-std",
                "k-ref",
                "k-ucabref",
                "ICEMKR",
                "BIGRANGE",
                "RANGE",
                "wd",
            ],
            "unit": "EA",
        },
    },
    "4100": {
        "agent_class_name": "PaintingSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf * 3.5",
            "inputs": ["total_finished_sf"],
            "multiplier": 3.5,
            "unit": "SF",
        },
    },
    "4200": {
        "agent_class_name": "LandscapingHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    "4300": {
        "agent_class_name": "SewerWaterHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    "4400": {
        "agent_class_name": "FireSprinklerSFFormulaAgent",
        "agent_type": "sf_formula",
        "requires_dxf": False,
        "agent_config": {
            "formula": "total_finished_sf",
            "inputs": ["total_finished_sf"],
            "unit": "SF",
        },
    },
    "4500": {
        "agent_class_name": "LowVoltageHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    "4600": {
        "agent_class_name": "RadonSystemHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    # 4700: Fireplace presence cannot be reliably detected from a fixed block name —
    # use ProjectFlagAgent (Claude text scan of DXF labels) instead.
    "4700": {
        "agent_class_name": "FireplaceProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "fireplace", "unit": "EA"},
    },
    "4800": {
        "agent_class_name": "ArchLightingManualHoldAgent",
        "agent_type": "manual_hold",
        "requires_dxf": False,
        "agent_config": {
            "note": "Manual entry required — contact Karen for architectural lighting estimate.",
            "unit": "LS",
        },
    },
    # ── Project-Flag agents ────────────────────────────────────────────────────
    # Detect optional features by scanning DXF text corpus with Claude.
    # quantity=1 if present, 0 if absent.  Layer names N/A — text-based only.
    "4900": {
        "agent_class_name": "WineCellarProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "wine cellar", "unit": "EA"},
    },
    "5000": {
        "agent_class_name": "PoolProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "pool", "unit": "EA"},
    },
    "5100": {
        "agent_class_name": "GolfSimulatorProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "golf simulator", "unit": "EA"},
    },
    "5200": {
        "agent_class_name": "SaunaProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "sauna", "unit": "EA"},
    },
    "5300": {
        "agent_class_name": "PlasterFinishProjectFlagAgent",
        "agent_type": "project_flag",
        "requires_dxf": True,
        "agent_config": {"feature": "plaster finish", "unit": "EA"},
    },
}
