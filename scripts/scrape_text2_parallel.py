#!/usr/bin/env python3
"""
Fast text2 scraper with batch writes
"""

import json
import asyncio
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
import re

BASE = Path(__file__).parent.parent
JSON_OUTPUT = BASE / "assets" / "data" / "descriptions_zh.json"
POKEMON_DATA = BASE / "assets" / "data" / "pokemon_data.json"

DELAY = 0.3  # Faster
MAX_RETRIES = 2
TIMEOUT = 15.0

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}


async def fetch_page(client: httpx.AsyncClient, url: str) -> str:
    for attempt in range(2):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.2)
    return None


def parse_text2(html: str) -> str:
    soup = BeautifulSoup(html, 'lxml')
    scripts = soup.find_all('script')
    for script in scripts:
        if script.string and 'text1' in script.string and 'text2' in script.string:
            s = script.string
            # Match text2 followed by escaped quotes and capture the content
            # Format: text2\\":\\"content\"
            m = re.search(r'text2[^"]*"[^"]*"([^"]*)"', s)
            if m:
                return m.group(1)
    return ''


async def scrape_text2(client, pid, zh_name):
    url = f"https://tw.portal-pokemon.com/pokedex/{pid:04d}/"
    html = await fetch_page(client, url)
    if html:
        text2 = parse_text2(html)
        if text2:
            return text2
    # No fallback - leave empty if not found on tw.portal-pokemon.com
    return ''


async def fetch_page(client: httpx.AsyncClient, url: str) -> str:
    for attempt in range(2):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=15, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception:
            pass
        await asyncio.sleep(0.1)
    return None


async def main():
    with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/pokemon_data.json', 'r') as f:
        pokemon_data = json.load(f)
    
    with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'r') as f:
        descriptions = json.load(f)
    print(f"Loaded {len(descriptions)} existing descriptions")
    
    # Find entries missing text2
    missing = [p for p in pokemon_data if not descriptions.get(str(p['id']), {}).get('text2')]
    print(f"Entries needing text2: {len(missing)}")
    
    limits = httpx.Limits(max_connections=8, max_keepalive_connections=4)
    async with httpx.AsyncClient(limits=limits, http2=True) as client:
        sem = asyncio.Semaphore(8)
        
        async def scrape_one(pokemon):
            pid = str(pokemon['id'])
            zh_name = pokemon['names'].get('zh', '')
            if not zh_name:
                return
            
            async with sem:
                text2 = await scrape_text2(client, pokemon['id'], pokemon['names'].get('zh', ''))
                
                if text2:
                    descriptions[str(pokemon['id'])]['text2'] = text2
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
            with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'w') as f:
                json.dump(descriptions, f, ensure_ascii=False, indent=2)
            
            print(f"Batch {i//50 + 1}: {success} new text2 entries")
            await asyncio.sleep(0.5)
    
    # Final save
    with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'w') as f:
        json.dump(descriptions, f, ensure_ascii=False, indent=2)
    
    t2_count = sum(1 for v in descriptions.values() if v.get('text2'))
    print(f"\nComplete! With text2: {sum(1 for v in descriptions.values() if v.get('text2'))}")


if __name__ == '__main__':
    asyncio.run(main())