#!/usr/bin/env python3
"""
Phase 1: Core Data Merge
Merge pokemon_complete_2026.csv + International Names.xlsx + 
original_captions.csv + compressed_captions.csv + existing pokemon_data.json
Output: assets/data/pokemon_data.json (overwrite)
"""

import pandas as pd
import json
import os
from pathlib import Path

# ─── Paths ───
BASE = Path(__file__).parent.parent
DATA_DIR = BASE / "data-sources"
ASSETS_DIR = BASE / "assets" / "data"

CSV_MAIN = DATA_DIR / "pokemon_complete_2026.csv"
XLSX_NAMES = DATA_DIR / "International List of Pokémon Names.xlsx"
CSV_ORIGINAL = DATA_DIR / "legacy-pokemon-data" / "original_captions.csv"
CSV_COMPRESSED = DATA_DIR / "legacy-pokemon-data" / "compressed_captions.csv"
JSON_EXISTING = ASSETS_DIR / "pokemon_data.json"
JSON_OUTPUT = ASSETS_DIR / "pokemon_data.json"

# ─── Type EN → ZH Mapping ───
TYPE_EN_ZH = {
    "Normal": "一般", "Fire": "火", "Water": "水", "Electric": "電",
    "Grass": "草", "Ice": "冰", "Fighting": "格鬥", "Poison": "毒",
    "Ground": "地面", "Flying": "飛行", "Psychic": "超能力", "Bug": "蟲",
    "Rock": "岩石", "Ghost": "幽靈", "Dragon": "龍", "Dark": "惡",
    "Steel": "鋼", "Fairy": "妖精"
}

def load_all_sources():
    print("Loading data sources...")
    
    # Main CSV - most comprehensive
    df_main = pd.read_csv(CSV_MAIN)
    print(f"  Main CSV: {len(df_main)} rows")
    
    # Multilingual names from XLSX
    df_names = pd.read_excel(XLSX_NAMES, header=0)
    # Columns: key, en, ja, fr, de, es, it, ko, zh_HK, zh, es_149
    df_names = df_names[['en', 'ja', 'fr', 'de', 'es', 'it', 'ko', 'zh_HK', 'zh']]
    df_names['id'] = range(1, len(df_names) + 1)
    print(f"  Names XLSX: {len(df_names)} rows")
    
    # Original captions (EN long)
    df_orig = pd.read_csv(CSV_ORIGINAL)
    df_orig = df_orig.rename(columns={'Pokedex_number': 'id', 'Caption': 'en_long'})
    df_orig = df_orig[['id', 'en_long']]
    print(f"  Original captions: {len(df_orig)} rows")
    
    # Compressed captions (EN short)
    df_comp = pd.read_csv(CSV_COMPRESSED)
    df_comp = df_comp.rename(columns={'image': 'img', 'caption': 'en_short'})
    df_comp['id'] = df_comp['img'].str.extract(r'(\d+)').astype(int)
    df_comp = df_comp[['id', 'en_short']]
    print(f"  Compressed captions: {len(df_comp)} rows")
    
    # Existing JSON (rgb/hsv/color_group)
    with open(JSON_EXISTING, 'r', encoding='utf-8') as f:
        existing_data = {item['id']: item for item in json.load(f)}
    print(f"  Existing JSON: {len(existing_data)} entries")
    
    return df_main, df_names, df_orig, df_comp, existing_data


def merge_data(df_main, df_names, df_orig, df_comp, existing_data):
    print("Merging data...")
    
    # Merge all on pokedex_number / id
    df = df_main.merge(df_names, left_on='pokedex_number', right_on='id', how='left')
    df = df.merge(df_orig, left_on='pokedex_number', right_on='id', how='left')
    df = df.merge(df_comp, left_on='pokedex_number', right_on='id', how='left')
    
    print(f"  Merged: {len(df)} rows")
    return df


def build_pokemon_entry(row, existing_data):
    pid = int(row['pokedex_number'])
    
    # Types
    types = [row['type_1']]
    if pd.notna(row['type_2']) and row['type_2']:
        types.append(row['type_2'])
    types_zh = [TYPE_EN_ZH.get(t, t) for t in types]
    
    # Stats
    stats = {
        'hp': int(row['hp']),
        'attack': int(row['attack']),
        'defense': int(row['defense']),
        'sp_attack': int(row['sp_attack']),
        'sp_defense': int(row['sp_defense']),
        'speed': int(row['speed']),
        'total': int(row['base_stat_total'])
    }
    
    # Abilities
    abilities = []
    if pd.notna(row['abilities']):
        abilities = [a.strip() for a in str(row['abilities']).split('|')]
    hidden_ability = row['hidden_ability'] if pd.notna(row['hidden_ability']) else None
    
    # Egg groups
    egg_groups = []
    if pd.notna(row['egg_groups']):
        egg_groups = [g.strip() for g in str(row['egg_groups']).split('|')]
    
    # Names
    names = {
        'en': row['en'] if pd.notna(row['en']) else '',
        'ja': row['ja'] if pd.notna(row['ja']) else '',
        'fr': row['fr'] if pd.notna(row['fr']) else '',
        'de': row['de'] if pd.notna(row['de']) else '',
        'es': row['es'] if pd.notna(row['es']) else '',
        'it': row['it'] if pd.notna(row['it']) else '',
        'ko': row['ko'] if pd.notna(row['ko']) else '',
        'zh': row['zh'] if pd.notna(row['zh']) else '',
        'zh_HK': row['zh_HK'] if pd.notna(row['zh_HK']) else ''
    }
    
    # Existing RGB/HSV data
    existing = existing_data.get(pid, {})
    
    # Generation parsing (must be before entry dict)
    gen_str = str(row['generation']) if pd.notna(row['generation']) else 'gen-i'
    gen_map = {'gen-i': 1, 'gen-ii': 2, 'gen-iii': 3, 'gen-iv': 4, 'gen-v': 5, 'gen-vi': 6, 'gen-vii': 7, 'gen-viii': 8, 'gen-ix': 9}
    generation = gen_map.get(gen_str.lower(), 1)
    
    # Build entry
    entry = {
        'id': pid,
        'filename': f"{pid}.png",
        
        # Names
        'names': names,
        
        # Types
        'types': types,
        'types_zh': types_zh,
        
        # Stats
        'stats': stats,
        
        # Physical
        'height_m': float(row['height_m']) if pd.notna(row['height_m']) else 0,
        'weight_kg': float(row['weight_kg']) if pd.notna(row['weight_kg']) else 0,
        'base_experience': int(row['base_experience']) if pd.notna(row['base_experience']) else 0,
        
        # Abilities
        'abilities': abilities,
        'hidden_ability': hidden_ability,
        
        # Game data
        'generation': generation,
        'is_legendary': bool(row['is_legendary']),
        'is_mythical': bool(row['is_mythical']),
        'is_baby': bool(row['is_baby']),
        'color': row['color'] if pd.notna(row['color']) else 'gray',
        'shape': row['shape'] if pd.notna(row['shape']) else '',
        'egg_groups': egg_groups,
        'habitat': row['habitat'] if pd.notna(row['habitat']) else '',
        'growth_rate': row['growth_rate'] if pd.notna(row['growth_rate']) else '',
        'capture_rate': int(row['capture_rate']) if pd.notna(row['capture_rate']) else 0,
        'base_happiness': int(row['base_happiness']) if pd.notna(row['base_happiness']) else 0,
        'genus': row['genus'] if pd.notna(row['genus']) else '',
        'evolution_chain_id': int(row['evolution_chain_id']) if pd.notna(row['evolution_chain_id']) else 0,
        
        # Breeding (PokeAPI /pokemon-species, not /pokemon — see
        # fetch_breeding_data.py). No CSV column carries these, so they are
        # carried from the previous JSON exactly like the colour block below.
        # gender_rate is eighths female; -1 means the species is genderless.
        'gender_rate': int(existing['gender_rate']) if existing.get('gender_rate') is not None else -1,
        'hatch_counter': int(existing['hatch_counter']) if existing.get('hatch_counter') is not None else 0,

        # Color (legacy - keep for visual sorting)
        'rgb': existing.get('rgb', [128, 128, 128]),
        'hsv': existing.get('hsv', [0, 0, 0.5]),
        'hue': existing.get('hue', 0),
        'sat': existing.get('sat', 0),
        'val': existing.get('val', 0.5),
        
        # Descriptions (EN from CSV, ZH will be added later)
        'descriptions': {
            'en_long': row['en_long'] if pd.notna(row['en_long']) else '',
            'en_short': row['en_short'] if pd.notna(row['en_short']) else '',
            'en_flavor': row['flavor_text'] if pd.notna(row['flavor_text']) else '',
            'zh': ''  # To be filled by scraper
        },
        
        # Official sprite
        'official_sprite_url': row['sprite_url'] if pd.notna(row['sprite_url']) else ''
    }
    
    return entry


def main():
    df_main, df_names, df_orig, df_comp, existing_data = load_all_sources()
    df = merge_data(df_main, df_names, df_orig, df_comp, existing_data)
    
    print("Building enhanced entries...")
    enhanced = []
    for _, row in df.iterrows():
        entry = build_pokemon_entry(row, existing_data)
        enhanced.append(entry)
    
    # Sort by id
    enhanced.sort(key=lambda x: x['id'])
    
    # Write output
    print(f"Writing {len(enhanced)} entries to {JSON_OUTPUT}")
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(enhanced, f, ensure_ascii=False, indent=2)
    
    print("Done!")
    
    # Print sample
    print("\nSample entry (id=1):")
    print(json.dumps(enhanced[0], ensure_ascii=False, indent=2)[:2000])


if __name__ == '__main__':
    main()