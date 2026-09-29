#!/usr/bin/env python3
"""
Extract evolution chains from pokemon_complete_2026.csv
Generate evolution_chains.json with main_line and variants
Download official artwork sprites from PokeAPI
"""

import pandas as pd
import json
import re
import sys
import requests
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

BASE = Path(__file__).parent.parent
CSV_PATH = BASE / "data-sources" / "pokemon_complete_2026.csv"
OUTPUT_JSON = BASE / "assets" / "data" / "evolution_chains.json"

# pokemon_data.json holds ids 1..1025 only, so this is the definition of "a real
# species" in this project; everything above it is a form. See variant_of().
SPECIES_MAX_ID = 1025
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

FORM_SPECIES_PATH = BASE / "data-sources" / "pokeapi_form_species.json"

# Populated once by build_evolution_chains(); make_node() reads it as a module
# global rather than threading a 5th argument through four call sites.
FORM_SPECIES: Dict[int, dict] = {}

# TEMPORARY SCAFFOLD -- deleted in the commit that moves form naming into the
# renderer (assets/js/form-names.js).
#
# The 127 hand-localised Mega/Gmax names in the committed evolution_chains.json
# were added by commit 034a56d and have NO reproducible source: not this script,
# not the CSV, not pokemon_data.json, not PokeAPI (whose /pokemon-form/{id} uses a
# different id namespace and carries no zh-hant). Any regeneration therefore drops
# all 127, which would be a visible regression -- 93 Mega + 34 Gmax labels turning
# from Chinese back to English -- in the commit that repairs the chains.
#
# So carry them forward from the existing file first, the same way
# enhance_pokemon_data.py carries gender_rate/hatch_counter (gotcha 29).
#
# !! TEMPORARY SCAFFOLD -- DELETE IN THE NAMING COMMIT. !! The renderer is
# supposed to own form naming (assets/js/form-names.js composes it from
# base_name_zh + qualifier), and that commit also makes the generator stop
# writing name_zh on form nodes. Both this function and the LEGACY_FORM_ZH map
# go at that point, together with the override in make_node(). They exist only
# so the chain-repair commit does not also ship a 127-label regression.
# 113 of the 127 are reproducible from two rules; the other 14 are the compound
# qualifiers (Mega-X/Y, Original-Mega, Toxtricity/Urshifu Gmax, Tatsugiri Megas).
LEGACY_FORM_ZH: Dict[int, str] = {}

def load_legacy_form_zh() -> Dict[int, str]:
    """id -> name_zh for form nodes already in the committed JSON."""
    if not OUTPUT_JSON.exists():
        return {}
    with open(OUTPUT_JSON, 'r', encoding='utf-8') as f:
        existing = json.load(f)

    carried: Dict[int, str] = {}

    def walk(o):
        if isinstance(o, dict):
            if 'id' in o and 'filename' in o:
                if o.get('form') is not None and o.get('name_zh') and o['name_zh'] != o.get('name_en'):
                    carried[o['id']] = o['name_zh']
            else:
                for v in o.values():
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(existing)
    return carried

# Six forms whose CSV `name` misspells the BASE half, so the qualifier cannot be
# recovered by stripping `pokemon_data[base_id].names.en + "-"`. These are typos in
# the CSV's base portion only; the qualifiers themselves are unambiguous.
#   10121 Gumshoos-Totem  -> Gumchoos          10189 Zamazenta-Crowned -> Zamazenta
#   10146 Kommo-O-Totem   -> Kommo-o           10288 Scolipede-Mega    -> Scoliopede
#   10166 Farfetchd-Galar -> Farfetch'd        10168 Mr-Mime-Galar     -> Mr. Mime
QUALIFIER_OVERRIDES = {
    10121: 'Totem',
    10146: 'Totem',
    10166: 'Galar',
    10168: 'Galar',
    10189: 'Crowned',
    10288: 'Mega',
}

def load_form_species() -> Dict[int, dict]:
    """id -> {base_id, form_name_en, has_front, has_shiny} for every form id > 1025.

    Harvested once from PokeAPI `/pokemon/{id}`; PokeAPI's own `/pokemon-form/{id}`
    uses a DIFFERENT id namespace (its 10033 is deoxys-speed, ours is Venusaur-Mega)
    and carries no `zh-hant`, so neither is usable as a naming source.

    The cache is COMMITTED, unlike the InfoPoke HTML dumps (gotcha 42). Those are
    3.1 MB of third-party markup that shifts whenever the site redesigns and have
    no upstream to pin; this is 45 KB of stable derived data that the generator
    cannot run at all without, so tracking it is what keeps a fresh clone able to
    regenerate. To re-harvest, for every id in this file over 1025:

        curl -H 'User-Agent: pokemon-algorithm' \\
             https://pokeapi.co/api/v2/pokemon/{id}
    """
    if not FORM_SPECIES_PATH.exists():
        sys.exit(
            f"Missing input: {FORM_SPECIES_PATH}\n"
            f"It is a committed PokeAPI cache (325 form ids). Restore it with\n"
            f"  git checkout HEAD -- data-sources/pokeapi_form_species.json\n"
            f"or re-harvest it -- see the docstring above."
        )
    with open(FORM_SPECIES_PATH, 'r', encoding='utf-8') as f:
        return {int(k): v for k, v in json.load(f).items()}

def detect_variant(name: str) -> Tuple[str, str]:
    """Detect variant type and base name from pokemon name"""
    for pattern, variant_type in VARIANT_PATTERNS:
        match = re.search(pattern, name)
        if match:
            base_name = name[:match.start()]
            return variant_type, base_name
    return 'base', name

def variant_of(p: dict) -> str:
    """Classify one CSV row as a base species or a named form.

    The national dex number is authoritative, NOT the name. 76 of the 1025
    species carry a hyphen in the CSV's `name` -- Nidoran-F, Mr-Mime, Kommo-O,
    Ho-Oh, Type-Null, Tapu-Koko, Wo-Chien, Iron-Thorns, Roaring-Moon and 66
    more -- so the catch-all `-.+$` pattern filed every one of them under
    special_forms.other. That emptied main_line on 51 of the 541 chains and
    silently dropped a stage from 18 others: Wormadam vanished from between
    Burmy and Mothim, Nidoran-F from the front of its own line, and Ho-Oh, the
    Tapus, all 7 paradoxes and the 12 Scarlet/Violet beasts rendered as a
    childless flex row with nothing in it.

    Name-based classification is still required for id > SPECIES_MAX_ID, where
    there is no id-based way to tell a Mega from a Galar form.
    """
    if p['id'] <= SPECIES_MAX_ID:
        return 'base'
    return detect_variant(p['name'])[0]

def resolve_qualifier(pokemon_id: int, name_en: str, base_name_en: str) -> Optional[str]:
    """Recover the qualifier from `<base name>-<qualifier>`.

    Returns None for base species. Raises rather than guessing, because a wrong
    qualifier silently produces a wrong Chinese name (see C2).
    """
    if pokemon_id in QUALIFIER_OVERRIDES:
        return QUALIFIER_OVERRIDES[pokemon_id]
    prefix = base_name_en + '-'
    if name_en.startswith(prefix):
        return name_en[len(prefix):]
    raise ValueError(
        f"Cannot resolve qualifier for #{pokemon_id}: {name_en!r} does not start "
        f"with base name {base_name_en!r}. Add it to QUALIFIER_OVERRIDES."
    )

def make_node(p: dict, form: Optional[str], pokemon_map: Dict[int, dict],
              id_to_zh: Dict[int, str], stage: Optional[int] = None) -> Dict:
    """Build one evolution node.

    Field order is load-bearing: it is what `json.dump(indent=2)` emits, so keeping
    `id, name_zh, name_en, [stage,] filename, form` and appending the new keys last
    is what keeps a regeneration diff to additions only.

    `base_name_en` exists because the CSV's own `name` is NOT reliably linkable --
    85 species differ from pokemon_data.json's names.en (Nidoran-F vs Nidoran♀,
    Farfetchd vs Farfetch'd), 54 of them inside chains. The href needs the spelling
    the detail page actually resolves, which is names.en, not the CSV's.
    """
    pid = p['id']
    pdata = pokemon_map.get(pid, {})
    filename = pdata.get('filename', f"{pid}.png")
    name_zh = p.get('name_zh', p.get('name', ''))
    if not name_zh or name_zh == p['name']:
        name_zh = id_to_zh.get(pid, p['name'])

    node: Dict = {'id': pid, 'name_zh': name_zh, 'name_en': p['name']}
    if stage is not None:
        node['stage'] = stage
    node['filename'] = filename
    node['form'] = form

    if form is None:
        # Base species: the node IS the detail page, so the link is its own slug.
        node['base_name_en'] = pdata.get('names', {}).get('en', p['name'])
    else:
        # A form has no detail page of its own; it links to its base species.
        spec = FORM_SPECIES.get(pid)
        if spec is None:
            raise ValueError(f"No form_species entry for form #{pid}")
        base_id = spec['base_id']
        base_pdata = pokemon_map.get(base_id)
        if base_pdata is None:
            raise ValueError(f"Form #{pid} maps to base #{base_id}, absent from pokemon_data.json")
        node['base_id'] = base_id
        node['base_name_en'] = base_pdata['names']['en']
        node['base_name_zh'] = id_to_zh.get(base_id, base_pdata['names']['en'])
        node['qualifier'] = resolve_qualifier(pid, p['name'], base_pdata['names']['en'])
        node['has_art'] = bool(spec.get('has_front'))
        # TEMPORARY: see LEGACY_FORM_ZH. Preserved so the chain-repair commit does
        # not also regress 127 already-Chinese labels.
        if pid in LEGACY_FORM_ZH:
            node['name_zh'] = LEGACY_FORM_ZH[pid]
    return node

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

    global FORM_SPECIES
    FORM_SPECIES = load_form_species()
    global LEGACY_FORM_ZH
    LEGACY_FORM_ZH = load_legacy_form_zh()

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

        # Separate main line from variants. main_line is sorted by pokedex_number
        # above (chain_rows), and that order is the evolution order for every line
        # in the dex -- which is only true because variant_of() keys off the id, so
        # Nidoran-F lands at stage 1 instead of being exiled to special_forms.
        main_line = [p for p in classified if variant_of(p) == 'base']

        # Build main line stages
        main_line_stages = []
        for p in main_line:
            main_line_stages.append(
                make_node(p, None, pokemon_map, id_to_zh, stage=len(main_line_stages) + 1)
            )

        # Add special forms (mega, gmax, primal) to main line
        special_forms_order = ['mega', 'gmax', 'primal']
        for form_type in special_forms_order:
            for p in classified:
                if variant_of(p) == form_type:
                    main_line_stages.append(
                        make_node(p, form_type, pokemon_map, id_to_zh,
                                  stage=len(main_line_stages) + 1)
                    )

        # Build regional variants as separate evolution lines
        regional_groups = {}
        for region in ['alola', 'galar', 'hisui', 'paldea']:
            regional_pokemon = [p for p in classified if variant_of(p) == region]
            if regional_pokemon:
                regional_pokemon.sort(key=lambda x: x['pokedex_number'])
                regional_groups[region] = [
                    make_node(p, region, pokemon_map, id_to_zh)
                    for p in regional_pokemon
                ]

        # Other special forms (cap, totem, other)
        special_forms = {}
        for form in ['totem', 'cap', 'other']:
            form_pokemon = [p for p in classified if variant_of(p) == form]
            if form_pokemon:
                special_forms[form] = [
                    make_node(p, form, pokemon_map, id_to_zh)
                    for p in form_pokemon
                ]

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
