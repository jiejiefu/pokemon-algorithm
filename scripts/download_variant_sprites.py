#!/usr/bin/env python3
"""
Download variant Pokemon sprites from PokeAPI
"""
import pandas as pd
import requests
from pathlib import Path
import time

df = pd.read_csv('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/data-sources/pokemon_complete_2026.csv')
variants = df[df['pokedex_number'] > 10000]
ids = sorted(variants['pokedex_number'].unique())

IMAGES_DIR = Path('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/images/pokemon')
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

SPRITES_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'

print(f'Downloading {len(ids)} variant sprites...')
success = 0
failed = 0

for i, pid in enumerate(ids):
    filename = f'{pid}.png'
    filepath = Path('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/images/pokemon') / f'{pid}.png'

    if filepath.exists():
        if i % 50 == 0:
            print(f'[{i+1}/{len(ids)}] {filename} - already exists, skipping')
        continue

    url = f'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{pid}.png'
    try:
        resp = requests.get(url, timeout=10, stream=True)
        if resp.status_code == 200:
            with open(filepath, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            success += 1
            if success % 25 == 0:
                print(f'[{i+1}/{len(ids)}] {filename} - OK (success: {success})')
        else:
            print(f'[{i+1}/{len(ids)}] {filename} - HTTP {resp.status_code}')
            failed += 1
    except Exception as e:
        print(f'[{i+1}/{len(ids)}] {filename} - Error: {e}')
        failed += 1

    time.sleep(0.1)

print(f'Done! Success: {success}, Failed: {failed}')
