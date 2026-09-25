#!/usr/bin/env python3
"""
Phase 2: Chinese Description Scraper (Parallel Version)
Scrape Traditional Chinese descriptions from:
1. Primary: https://tw.portal-pokemon.com/pokedex/{id:04d}/
   - Extracts both text1 (primary) and text2 (secondary) descriptions
   - No fallback to wiki.52poke.com (leave empty if not found)

Output: assets/data/descriptions_zh.json { "1": {"text1": "...", "text2": "..."}, ... }
"""

import json
import re
import asyncio
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, Optional
import opencc

BASE = Path(__file__).parent.parent
JSON_OUTPUT = BASE / "assets" / "data" / "descriptions_zh.json"
POKEMON_DATA = BASE / "assets" / "data" / "pokemon_data.json"

# Parallel scraping settings
DELAY = 0.3  # seconds between requests (per worker)
MAX_RETRIES = 3
TIMEOUT = 20.0
MAX_CONCURRENT = 8  # max concurrent requests

# User agent
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

# Simplified -> Traditional Chinese converter
converter = opencc.OpenCC('s2twp')


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Fetch page with retries"""
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


def parse_portal_pokemon(html: str) -> Dict[str, str]:
    """Parse tw.portal-pokemon.com/pokedex/{id}/ page for both text1 and text2"""
    soup = BeautifulSoup(html, 'lxml')
    scripts = soup.find_all('script')
    
    for script in scripts:
        if script.string and 'text1' in script.string and 'text2' in script.string:
            s = script.string
            
            # Try both formats independently for each field
            # Single-escaped: text1":"value"
            text1_match = re.search(r'text1":"([^"]*)"', script.string)
            text2_match = re.search(r'text2":"([^"]*)"', script.string)
            
            # Double-escaped: text1\\":\\"value\\"
            if not text1_match:
                text1_match = re.search(r'text1\\\\":\\\\"([^\\\\"]*)\\\\"', script.string)
            if not text2_match:
                text2_match = re.search(r'text2\\\\":\\\\"([^\\\\"]*)\\\\"', script.string)
            
            # Fallback to JSON-style format
            if not text1_match:
                text1_match = re.search(r'"text1"\s*:\s*"([^"]*)"', script.string)
            if not text2_match:
                text2_match = re.search(r'"text2"\s*:\s*"([^"]*)"', script.string)
            
            if text1_match or text2_match:
                return {
                    'text1': text1_match.group(1) if text1_match else '',
                    'text2': text2_match.group(1) if text2_match else ''
                }
    
    # Fallback to meta tags (only text1)
    for sel in ['meta[name="description"]', 'meta[property="og:description"]']:
        elem = soup.select_one(sel)
        if elem and elem.get('content'):
            text = elem['content'].strip()
            if text and len(text) > 20:
                return {'text1': text, 'text2': ''}
    
    return {'text1': '', 'text2': ''}


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Fetch page with retries"""
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


async def scrape_pokemon(client: httpx.AsyncClient, pid: int) -> Dict[str, str]:
    # Try portal-pokemon.com first (official TW site)
    url = f"https://tw.portal-pokemon.com/pokedex/{pid:04d}/"
    html = await fetch_page(client, url)
    if html:
        desc = parse_portal_pokemon(html)
        if desc and (desc.get('text1') or desc.get('text2')):
            return desc
    
    # No fallback to wiki.52poke.com - leave empty if not found
    return {'text1': '', 'text2': ''}


async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


async def main():
    with open(POKEMON_DATA, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)
    
    # Load existing descriptions if any
    descriptions = {}
    if JSON_OUTPUT.exists():
        with open(JSON_OUTPUT, 'r', encoding='utf-8') as f:
            descriptions = json.load(f)
        print(f"Loaded {len(descriptions)} existing descriptions")
    
    # Find entries missing text2
    missing = [p for p in pokemon_data if not descriptions.get(str(p['id']), {}).get('text2')]
    print(f"Entries needing text2: {len(missing)}")
    
    # Parallel scraping with semaphore
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=4)
    async with httpx.AsyncClient(limits=limits, http2=True) as client:
        sem = asyncio.Semaphore(8)
        
        async def scrape_one(pokemon):
            pid = str(pokemon['id'])
            zh_name = pokemon['names'].get('zh', '')
            if not zh_name:
                return
            
            async with sem:
                desc = await scrape_pokemon(client, pokemon['id'])
                
                if desc and (desc.get('text1') or desc.get('text2')):
                    descriptions[str(pokemon['id'])] = desc
                    return True
                return False
            
            # Process in batches
            batch_size = 50
            for i in range(0, len(pokemon_data), batch_size):
                batch = pokemon_data[i:i+batch_size]
                tasks = [scrape_one(p) for p in batch]
                results = await asyncio.gather(*tasks)
                success = sum(results)
                
                # Write after each batch
                with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
                    json.dump(descriptions, f, ensure_ascii=False, indent=2)
                
                print(f"Batch {i//50 + 1}: {success} new text2 entries")
                await asyncio.sleep(0.5)
        
        # Final save
        with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
            json.dump(descriptions, f, ensure_ascii=False, indent=2)
        
        t2_count = sum(1 for v in descriptions.values() if v.get('text2'))
        print(f"\nComplete! With text2: {sum(1 for v in descriptions.values() if v.get('text2'))}")


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    asyncio.run(main())