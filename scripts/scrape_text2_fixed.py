#!/usr/bin/env python3
"""
Final fixed scraper for Chinese Pokémon descriptions
Correctly handles both single-escaped and double-escaped formats for BOTH text1 and text2 independently
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

DELAY = 0.5
MAX_RETRIES = 3
TIMEOUT = 20.0

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}


async def fetch_page(client: httpx.AsyncClient, url: str) -> str:
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception as e:
            print(f"  Attempt failed: {e}")
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


def parse_portal_pokemon(html: str) -> dict:
    """Parse both text1 and text2 from portal-pokemon.com"""
    soup = BeautifulSoup(html, 'lxml')
    scripts = soup.find_all('script')
    
    for script in scripts:
        if script.string and 'text1' in script.string and 'text2' in script.string:
            content = script.string
            
            # Try each field with BOTH formats independently
            text1_match = re.search(r'text1":"([^"]*)"', script.string)
            if not text1_match:
                text1_match = re.search(r'text1\\\\":\\\\"([^\\\\"]*)\\\\"', script.string)
            
            text2_match = re.search(r'text2":"([^"]*)"', script.string)
            if not text2_match:
                text2_match = re.search(r'text2\\\\":\\\\"([^\\\\"]*)\\\\"', script.string)
            
            if text1_match and text2_match:
                return {
                    'text1': text1_match.group(1),
                    'text2': text2_match.group(1)
                }
            
            # Fallback to fallback pattern
            text1_match = re.search(r'"text1"\s*:\s*"([^"]*)"', script.string)
            text2_match = re.search(r'"text2"\s*:\s*"([^"]*)"', script.string)
            if text1_match and text2_match:
                return {
                    'text1': text1_match.group(1),
                    'text2': text2_match.group(1)
                }
    
    # Fallback to meta tags
    for sel in ['meta[name="description"]', 'meta[property="og:description"]']:
        elem = soup.select_one(sel)
        if elem and elem.get('content'):
            text = elem['content'].strip()
            if text and len(text) > 20:
                return {'text1': text, 'text2': ''}
    
    return {'text1': '', 'text2': ''}


async def scrape_pokemon(client, pid, zh_name):
    # Try portal-pokemon.com first
    url = f"https://tw.portal-pokemon.com/pokedex/{pid:04d}/"
    html = await fetch_page(client, url)
    if html:
        desc = parse_portal_pokemon(html)
        if desc and (desc.get('text1') or desc.get('text2')):
            return desc
    
    # Fallback to wiki.52poke.com
    url = f"https://wiki.52poke.com/wiki/{zh_name}"
    html = await fetch_page(client, url)
    if html:
        soup = BeautifulSoup(html, 'lxml')
        headings = soup.find_all(['h2', 'h3', 'h4'])
        for h in headings:
            if '图鉴介绍' in h.get_text() or '圖鑑介紹' in h.get_text():
                current = h.next_sibling
                while current:
                    if current.name == 'table':
                        for td in current.find_all('td'):
                            text = td.get_text(strip=True)
                            if text and len(text) > 20 and not text.startswith(('本條目', '關於', '参见')):
                                return {'text1': text, 'text2': ''}
                    elif current.name and current.name.startswith('h'):
                        break
                    current = current.next_sibling
    
    return {'text1': '', 'text2': ''}


async def fetch_page(client: httpx.AsyncClient, url: str) -> str:
    for attempt in range(3):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
        except Exception as e:
            print(f"  Attempt failed: {e}")
        await asyncio.sleep(0.5 * (2 ** attempt))
    return None


async def main():
    with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/pokemon_data.json', 'r') as f:
        pokemon_data = json.load(f)
    
    descriptions = {}
    if Path('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json').exists():
        with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'r') as f:
            descriptions = json.load(f)
        print(f"Loaded {len(descriptions)} existing descriptions")
    
    limits = httpx.Limits(max_connections=5, max_keepalive_connections=2)
    async with httpx.AsyncClient(limits=limits, http2=True) as client:
        for i, pokemon in enumerate(pokemon_data):
            pid = pokemon['id']
            zh_name = pokemon['names'].get('zh', '')
            
            if str(pid) in descriptions:
                continue
            
            if not zh_name:
                descriptions[str(pid)] = {'text1': '', 'text2': ''}
                continue
            
            print(f"#{pid:04d} {zh_name}...", end=' ', flush=True)
            
            desc = await scrape_pokemon(client, pid, zh_name)
            
            if desc and (desc.get('text1') or desc.get('text2')):
                descriptions[str(pid)] = desc
                t1 = len(desc.get('text1', ''))
                t2 = len(desc.get('text2', ''))
                print(f"✓ (text1: {t1}, text2: {t2})")
            else:
                descriptions[str(pid)] = {'text1': '', 'text2': ''}
                print("✗")
            
            if len(descriptions) % 10 == 0:
                with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'w') as f:
                    json.dump(descriptions, f, ensure_ascii=False, indent=2)
            
            await asyncio.sleep(0.5)
    
    # Final save
    with open('/Users/jiejiefu/Documents/Visual_Studio_Code/pokemon-algorithm/assets/data/descriptions_zh.json', 'w') as f:
        json.dump(descriptions, f, ensure_ascii=False, indent=2)
    
    filled = sum(1 for v in descriptions.values() if v.get('text1') or v.get('text2'))
    t2_count = sum(1 for v in descriptions.values() if v.get('text2'))
    print(f"\nComplete! Total: {len(descriptions)}, Filled: {filled}, With text2: {t2_count}")


if __name__ == '__main__':
    asyncio.run(main())