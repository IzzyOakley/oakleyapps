# Agent registry — maps cost_code → agent definition.
# agent_type values: sf_formula | dxf_count | dxf_area | dxf_geometry | project_flag | historical_avg | manual_hold | skip
# Layer names in agent_config are best-guess defaults — UPDATE from real DXF files in Phase 16.
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
    "1200": {
        "agent_class_name": "FoundationDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "perimeter",
            "target_layers": ["A-WALL-FNDN", "A-FNDTN", "S-FNDN"],
            "unit": "CY",
        },
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
    "1500": {
        "agent_class_name": "StructuralSteelDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["S-BEAM", "S-COL", "S-STRU"],
            "block_name_patterns": ["BEAM", "COLUMN", "W_BEAM", "HSS"],
            "unit": "EA",
        },
    },
    "1600": {
        "agent_class_name": "RoofingDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "roof_area",
            "target_layers": ["A-ROOF", "A-ROOF-OTLN", "A-ROOF-PLAN"],
            "default_pitch": "8/12",
            "unit": "SQ",
        },
    },
    "1700": {
        "agent_class_name": "SidingDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "wall_area",
            "target_layers": ["A-WALL-EXTR", "A-ELEV"],
            "unit": "SF",
        },
    },
    "1800": {
        "agent_class_name": "MasonryDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-WALL-MSNR", "A-FINSH-MSNR", "A-STONE"],
            "min_area_sf": 5.0,
            "unit": "SF",
        },
    },
    "1900": {
        "agent_class_name": "StuccoHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    "2000": {
        "agent_class_name": "WindowsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-GLAZ", "A-WIND", "A-WINDOW"],
            "block_name_patterns": ["WIN", "WINDOW", "GLAZ", "WND"],
            "unit": "EA",
        },
    },
    "2100": {
        "agent_class_name": "ExteriorDoorsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-DOOR", "A-DOOR-EXT"],
            "block_name_patterns": ["DOOR_EXT", "EXT_DOOR", "DR_EXT"],
            "unit": "EA",
        },
    },
    "2200": {
        "agent_class_name": "FrontDoorDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-DOOR", "A-DOOR-FRONT"],
            "block_name_patterns": [
                "DOOR_FRONT",
                "FRONT_DOOR",
                "DR_FRONT",
                "ENTRY_DOOR",
            ],
            "unit": "EA",
        },
    },
    "2300": {
        "agent_class_name": "GarageDoorDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-DOOR-GAR", "A-GARAGE-DOOR"],
            "block_name_patterns": ["GARAGE_DOOR", "GAR_DR", "OVERHEAD_DOOR"],
            "unit": "EA",
        },
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
    "2600": {
        "agent_class_name": "InteriorDoorsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-DOOR-INT", "A-DOOR"],
            "block_name_patterns": ["DOOR_INT", "INT_DOOR", "DR_INT"],
            "unit": "EA",
        },
    },
    "2700": {
        "agent_class_name": "InteriorTrimHistoricalAvgAgent",
        "agent_type": "historical_avg",
        "requires_dxf": False,
        "agent_config": {"unit": "LS"},
    },
    "2800": {
        "agent_class_name": "CabinetsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FURN-CASE", "A-CASEWORK", "A-CABINET"],
            "block_name_patterns": ["CAB", "CABINET", "CASEWORK", "CASE"],
            "unit": "LF",
        },
    },
    "2900": {
        "agent_class_name": "CountertopsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FURN-CASE", "A-CASEWORK"],
            "block_name_patterns": ["CTRTP", "COUNTERTOP", "CTR_TOP"],
            "unit": "LF",
        },
    },
    "3000": {
        "agent_class_name": "HardwoodDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FINSH-HARD", "A-FLOOR-WOOD", "A-HARDWOOD"],
            "min_area_sf": 5.0,
            "unit": "SF",
        },
    },
    "3100": {
        "agent_class_name": "TileMaterialsDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FINSH-TILE", "A-FLOOR-TILE", "A-TILE"],
            "min_area_sf": 5.0,
            "unit": "SF",
        },
    },
    "3200": {
        "agent_class_name": "TileInstallationDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FINSH-TILE", "A-FLOOR-TILE", "A-TILE"],
            "min_area_sf": 5.0,
            "unit": "SF",
        },
    },
    "3300": {
        "agent_class_name": "CarpetDXFAreaAgent",
        "agent_type": "dxf_area",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FINSH-CARP", "A-FLOOR-CARP", "A-CARPET"],
            "min_area_sf": 5.0,
            "unit": "SY",
        },
    },
    "3400": {
        "agent_class_name": "StairsDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-STRS", "A-STAIR"],
            "block_name_patterns": ["STAIR", "STAIRS", "STR"],
            "unit": "Flight",
        },
    },
    "3500": {
        "agent_class_name": "GuttersDXFGeometryAgent",
        "agent_type": "dxf_geometry",
        "requires_dxf": True,
        "agent_config": {
            "geometry_type": "eave_perimeter",
            "target_layers": ["A-ROOF", "A-ROOF-OTLN", "A-EAVE"],
            "unit": "LF",
        },
    },
    "3600": {
        "agent_class_name": "PlumbingDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["P-FIXT", "P-PLMB", "PLUMBING"],
            "block_name_patterns": [
                "BATH_FULL",
                "BATH_HALF",
                "TOILET",
                "SINK",
                "TUB",
                "SHOWER",
                "WH",
                "HOSE_BIB",
                "LAVATORY",
                "LAV",
                "WC",
                "HB",
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
    "4000": {
        "agent_class_name": "AppliancesDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-EQPM", "A-APPL", "A-KITCHEN"],
            "block_name_patterns": [
                "FRIDGE",
                "REFRIGERATOR",
                "RANGE",
                "DISHWASHER",
                "OVEN",
                "MICROWAVE",
                "WASHER",
                "DRYER",
                "HOOD",
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
    "4700": {
        "agent_class_name": "FireplaceDXFCountAgent",
        "agent_type": "dxf_count",
        "requires_dxf": True,
        "agent_config": {
            "target_layers": ["A-FPCE", "A-FIREPLACE"],
            "block_name_patterns": ["FIREPLACE", "FP", "FPCE"],
            "unit": "EA",
        },
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
    # ── Project-Flag agents (Phase 12) ────────────────────────────────────────
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
