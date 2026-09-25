#!/usr/bin/env python3
"""
Extract evolution chains from pokemon_complete_2026.csv
Generate evolution_chains.json with main_line and variants
Download official artwork sprites from PokeAPI
"""

import pandas as pd
import json
import re
import requests
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BASE = Path(__file__).parent.parent
CSV_PATH = BASE / "data-sources" / "pokemon_complete_2026.csv"
OUTPUT_JSON = BASE / "assets" / "data" / "evolution_chains.json"
IMAGES_DIR = BASE / "assets" / "images" / "pokemon"
POKEMON_DATA_JSON = BASE / "assets" / "data" / "pokemon_data.json"

# Variant classification patterns (order matters - more specific first)
# Handle compound variants like Pikachu-Alola-Cap (both alola and cap)
# Order matters: more specific patterns first (Totem before regional variants)
VARIANT_PATTERNS = [
    (r'-Mega(-[XY])?$', 'mega'),
    (r'-Gmax$', 'gmax'),
    (r'-Primal$', 'primal'),
    (r'-Totem', 'totem'),
    (r'-Alola(-Cap|-Starter|-Partner)?$', 'alola'),
    (r'-Galar(-Cap|-Starter|-Partner)?$', 'galar'),
    (r'-Hisui(-Cap|-Starter|-Partner)?$', 'hisui'),
    (r'-Paldea(-Cap|-Starter|-Partner)?$', 'paldea'),
    (r'-Cap$|-Starter$|-Partner$', 'cap'),
    (r'-.+$', 'other')
]

SPRITES_BASE_URL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/"

def detect_variant(name: str) -> Tuple[str, str]:
    """Detect variant type and base name from pokemon name"""
    for pattern, variant_type in VARIANT_PATTERNS:
        match = re.search(pattern, name)
        if match:
            base_name = name[:match.start()]
            return variant_type, base_name
    return 'base', name

def detect_variant(name: str) -> Tuple[str, str]:
    """Detect variant type and base name from pokemon name"""
    for pattern, variant_type in VARIANT_PATTERNS:
        match = re.search(pattern, name)
        if match:
            base_name = name[:match.start()]
            return variant_type, base_name
    return 'base', name

def classify_pokemon(name: str, pokedex_number: int, evolution_chain_id: int) -> Dict:
    """Classify pokemon into variant type and get base info"""
    variant_type, base_name = detect_variant(name)
    return {
        'id': pokedex_number,
        'name': name,
        'base_name': base_name,
        'variant_type': variant_type,
        'evolution_chain_id': evolution_chain_id
    }

def build_evolution_chains() -> Dict:
    """Build evolution chains from CSV data"""
    # Load CSV
    CSV_DATA = pd.read_csv(CSV_PATH)

    # Load pokemon_data.json for Chinese names and filenames
    with open(POKEMON_DATA_JSON, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)

    # Create id -> pokemon_data mapping
    pokemon_map = {p['id']: p for p in pokemon_data}

    # Load CSV
    CSV_DATA = pd.read_csv(CSV_PATH)

    # Group by evolution_chain_id
    chains = {}
    for _, row in CSV_DATA.iterrows():
        chain_id = int(row['evolution_chain_id'])
        if chain_id not in chains:
            chains[chain_id] = []
        chains[chain_id].append(row)

    # Load pokemon_data.json for Chinese names and filenames
    with open(POKEMON_DATA_JSON, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)
    pokemon_map = {p['id']: p for p in pokemon_data}

    # Create id -> Chinese name mapping from pokemon_data.json
    id_to_zh = {}
    for p in pokemon_data:
        id_to_zh[p['id']] = p['names'].get('zh', p['names'].get('zh_HK', p['names']['en']))

    evolution_chains = {}

    for chain_id, chain_rows in chains.items():
        chain_rows = sorted(chain_rows, key=lambda x: x['pokedex_number'])
        chain_df = pd.DataFrame(chain_rows)

        classified = []
        for _, row in chain_df.iterrows():
            classified.append({
                'id': int(row['pokedex_number']),
                'name': row['name'],
                'evolution_chain_id': int(row['evolution_chain_id']),
                'pokedex_number': int(row['pokedex_number']),
            })

        # Classify variants
        main_line = []
        variants = {
            'mega': [], 'gmax': [], 'primal': [],
            'alola': [], 'galar': [], 'hisui': [], 'paldea': [],
            'totem': [], 'cap': [], 'other': []
        }

        for p in classified:
            variant_type, base_name = detect_variant(p['name'])
            p['variant_type'] = variant_type
            p['base_name'] = base_name

            if variant_type == 'base':
                main_line.append(p)
            else:
                if variant_type in ['mega', 'gmax', 'primal', 'totem', 'cap']:
                    pass
                if variant_type in ['alola', 'galar', 'hisui', 'paldea']:
                    pass

        # Separate main line from variants
        main_line = [p for p in classified if detect_variant(p['name'])[0] == 'base']
        variants_list = [p for p in classified if detect_variant(p['name'])[0] != 'base']

        # Sort main line by pokedex_number
        main_line.sort(key=lambda x: x['pokedex_number'])

        # Build main line stages
        main_line_stages = []
        for i, p in enumerate(main_line):
            pdata = pokemon_map.get(p['id'], {})
            filename = pdata.get('filename', f"{p['id']}.png")
            name_zh = p.get('name_zh', p.get('name', ''))
            if not name_zh or name_zh == p['name']:
                name_zh = id_to_zh.get(p['id'], p['name'])

            stage = {
                'id': p['id'],
                'name_zh': name_zh,
                'name_en': p['name'],
                'stage': len(main_line_stages) + 1,
                'filename': filename,
                'form': None
            }
            main_line_stages.append(stage)

        # Add special forms (mega, gmax, primal) to main line
        special_forms_order = ['mega', 'gmax', 'primal']
        for form_type in special_forms_order:
            for p in classified:
                variant_type, _ = detect_variant(p['name'])
                if variant_type == form_type:
                    pdata = pokemon_map.get(p['id'], {})
                    filename = pdata.get('filename', f"{p['id']}.png")
                    name_zh = p.get('name_zh', p.get('name', ''))
                    if not name_zh or name_zh == p['name']:
                        name_zh = id_to_zh.get(p['id'], p['name'])

                    stage = {
                        'id': p['id'],
                        'name_zh': name_zh,
                        'name_en': p['name'],
                        'stage': len(main_line_stages) + 1,
                        'filename': filename,
                        'form': form_type
                    }
                    main_line_stages.append(stage)

        # Build regional variants as separate evolution lines
        regional_groups = {}
        for region in ['alola', 'galar', 'hisui', 'paldea']:
            regional_pokemon = [p for p in classified if detect_variant(p['name'])[0] == region]
            if regional_pokemon:
                regional_pokemon.sort(key=lambda x: x['pokedex_number'])
                regional_groups[region] = []
                for p in regional_pokemon:
                    pdata = pokemon_map.get(p['id'], {})
                    filename = pdata.get('filename', f"{p['id']}.png")
                    name_zh = p.get('name_zh', p.get('name', ''))
                    if not name_zh or name_zh == p['name']:
                        name_zh = id_to_zh.get(p['id'], p['name'])

                    regional_groups[region].append({
                        'id': p['id'],
                        'name_zh': name_zh,
                        'name_en': p['name'],
                        'filename': filename,
                        'form': region
                    })

        # Other special forms (cap, totem, other)
        special_forms = {}
        for form in ['totem', 'cap', 'other']:
            form_pokemon = [p for p in classified if detect_variant(p['name'])[0] == form]
            if form_pokemon:
                special_forms[form] = []
                for p in form_pokemon:
                    pdata = pokemon_map.get(p['id'], {})
                    filename = pdata.get('filename', f"{p['id']}.png")
                    name_zh = p.get('name_zh', p.get('name', ''))
                    if not name_zh or name_zh == p['name']:
                        name_zh = id_to_zh.get(p['id'], p['name'])

                    special_forms[form].append({
                        'id': p['id'],
                        'name_zh': name_zh,
                        'name_en': p['name'],
                        'filename': filename,
                        'form': form
                    })

        # Build regional variants dict - each region is a separate evolution line
        variants_dict = {}
        for region in ['alola', 'galar', 'hisui', 'paldea']:
            if region in regional_groups and regional_groups[region]:
                variants_dict[region] = regional_groups[region]

        for form in ['totem', 'cap', 'other']:
            if form in special_forms and special_forms[form]:
                variants_dict[form] = special_forms[form]

        evolution_chains[str(chain_id)] = {
            'chain_id': chain_id,
            'main_line': main_line_stages,
            'variants': {k: v for k, v in regional_groups.items() if v},
            'special_forms': {k: v for k, v in special_forms.items() if v}
        }

    return evolution_chains


def download_sprite(pokemon_id: int, filename: str) -> bool:
    """Download official artwork sprite from PokeAPI"""
    url = f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{pokemon_id}.png"
    filepath = IMAGES_DIR / filename

    if filepath.exists():
        return True

    try:
        response = requests.get(url, timeout=10, stream=True)
        if response.status_code == 200:
            filepath.parent.mkdir(parents=True, exist_ok=True)
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
    except Exception as e:
        print(f"Failed to download {filename} (ID: {pokemon_id}): {e}")
    return False


def download_all_sprites():
    """Download all missing sprites from PokeAPI using official artwork"""
    with open(POKEMON_DATA_JSON, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)

    print(f"Checking {len(pokemon_data)} sprites...")
    missing = 0
    for p in pokemon_data:
        filename = p.get('filename', f"{p['id']}.png")
        filepath = IMAGES_DIR / filename
        if not filepath.exists():
            # Use the pokedex_number from CSV for the sprite ID
            sprite_id = p['id']
            # Check if there's a variant ID in CSV
            CSV_DATA = pd.read_csv(CSV_PATH)
            row = CSV_DATA[CSV_DATA['pokedex_number'] == p['id']]
            if not row.empty:
                sprite_id = int(row.iloc[0]['pokedex_number'])

            if download_sprite(sprite_id, filename):
                missing += 1

    print(f"Downloaded {missing} missing sprites")


def main():
    print("Building evolution chains...")

    # Ensure images directory exists
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Build evolution chains
    chains = build_evolution_chains()

    # Save to JSON
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(chains, f, ensure_ascii=False, indent=2)

    print(f"Generated {len(chains)} evolution chains")

    # Download missing sprites
    download_all_sprites()

    print("Done!")


if __name__ == '__main__':
    import pandas as pd
    import requests
    main()
