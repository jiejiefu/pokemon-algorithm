#!/usr/bin/env python3
"""
Phase 2: Chinese Description Scraper
Scrape Traditional Chinese descriptions from:
1. Primary: https://tw.portal-pokemon.com/play/pokedex/{id:04d}/
2. Fallback: https://wiki.52poke.com/wiki/{zh_name}

Output: assets/data/descriptions_zh.json { "1": "描述文本", ... }
"""

import json
import time
import asyncio
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, Optional

BASE = Path(__file__).parent.parent
JSON_OUTPUT = BASE / "assets" / "data" / "descriptions_zh.json"
POKEMON_DATA = BASE / "assets" / "data" / "pokemon_data.json"

# Rate limiting
DELAY = 0.5  # seconds between requests
MAX_RETRIES = 3
TIMEOUT = 15.0

# User agent
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
}

async def fetch_page(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Fetch page with retries"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
            elif resp.status_code == 404:
                return None
            else:
                print(f"  HTTP {resp.status_code} for {url}")
        except Exception as e:
            print(f"  Attempt {attempt+1} failed for {url}: {e}")
        
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(DELAY * (2 ** attempt))
    
    return None


def parse_portal_pokemon(html: str) -> Optional[str]:
    """Parse tw.portal-pokemon.com page for description"""
    soup = BeautifulSoup(html, 'lxml')
    
    # Try multiple selectors for description
    selectors = [
        '.pokemon-detail__description',
        '.pokemon-info__description',
        '.pokedex-pokemon__description',
        'div.description',
        'p.description',
        '.pokemon-detail-text',
        '.pokemon-description',
        '#pokemon-description',
    ]
    
    for sel in selectors:
        elem = soup.select_one(sel)
        if elem:
            text = elem.get_text(strip=True)
            if text and len(text) > 20:
                return text
    
    # Fallback: look for any text containing Chinese characters in main content
    main = soup.select_one('main, .main, .content, #content')
    if main:
        text = main.get_text(strip=True)
        # Find Chinese description-like text
        import re
        # Look for sentences with Chinese punctuation
        sentences = re.findall(r'[^。！？]*[。！？]', text)
        for s in sentences:
            s = s.strip()
            if len(s) > 30 and any('\u4e00' <= c <= '\u9fff' for c in s):
                return s
    
    return None


def parse_52poke(html: str) -> Optional[str]:
    """Parse wiki.52poke.com page for description"""
    soup = BeautifulSoup(html, 'lxml')
    
    # 52poke wiki structure - look for the main content
    content = soup.select_one('#mw-content-text, .mw-parser-output')
    if not content:
        return None
    
    # Get first few paragraphs
    paragraphs = content.select('p')
    for p in paragraphs:
        text = p.get_text(strip=True)
        if text and len(text) > 30:
            # Skip navigation/infobox text
            if not text.startswith(('本條目', '關於', '参见', '跳转', '导航', '搜索')):
                return text
    
    return None


async def scrape_pokemon(client: httpx.AsyncClient, pid: int, zh_name: str) -> Optional[str]:
    """Scrape Chinese description for one Pokémon"""
    
    # Try portal-pokemon.com first (official TW site)
    url1 = f"https://tw.portal-pokemon.com/play/pokedex/{pid:04d}/"
    html = await fetch_page(client, url1)
    if html:
        desc = parse_portal_pokemon(html)
        if desc:
            return desc
    
    # Fallback to wiki.52poke.com
    url2 = f"https://wiki.52poke.com/wiki/{zh_name}"
    html = await fetch_page(client, url2)
    if html:
        desc = parse_52poke(html)
        if desc:
            return desc
    
    return None


async def main():
    # Load Pokémon data to get names
    with open(POKEMON_DATA, 'r', encoding='utf-8') as f:
        pokemon_data = json.load(f)
    
    # Load existing descriptions if any
    descriptions = {}
    if JSON_OUTPUT.exists():
        with open(JSON_OUTPUT, 'r', encoding='utf-8') as f:
            descriptions = json.load(f)
        print(f"Loaded {len(descriptions)} existing descriptions")
    
    # Create async client
    limits = httpx.Limits(max_connections=5, max_keepalive_connections=2)
    async with httpx.AsyncClient(limits=limits, http2=True) as client:
        
        for pokemon in pokemon_data:
            pid = pokemon['id']
            zh_name = pokemon['names'].get('zh', '')
            
            # Skip if already have description
            if str(pid) in descriptions:
                continue
            
            if not zh_name:
                print(f"#{pid:04d}: No Chinese name, skipping")
                descriptions[str(pid)] = ""
                continue
            
            print(f"#{pid:04d} {zh_name}...", end=' ', flush=True)
            
            desc = await scrape_pokemon(client, pid, zh_name)
            
            if desc:
                descriptions[str(pid)] = desc
                print(f"✓ ({len(desc)} chars)")
            else:
                descriptions[str(pid)] = ""
                print("✗")
            
            # Save progress every 10
            if len(descriptions) % 10 == 0:
                with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
                    json.dump(descriptions, f, ensure_ascii=False, indent=2)
            
            await asyncio.sleep(DELAY)
    
    # Final save
    with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(descriptions, f, ensure_ascii=False, indent=2)
    
    print(f"\nComplete! Total: {len(descriptions)} descriptions")
    filled = sum(1 for v in descriptions.values() if v)
    print(f"Filled: {filled}, Empty: {len(descriptions) - filled}")


if __name__ == '__main__':
    asyncio.run(main())