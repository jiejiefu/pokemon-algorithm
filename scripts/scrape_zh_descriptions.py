#!/usr/bin/env python3
"""
Phase 2: Chinese Description Scraper
Scrape Traditional Chinese descriptions from:
1. Primary: https://tw.portal-pokemon.com/pokedex/{id:04d}/
2. Fallback: https://wiki.52poke.com/wiki/{zh_name} -> extract 图鉴介绍 section, convert to Traditional Chinese

Output: assets/data/descriptions_zh.json { "1": "描述文本", ... }
"""

import json
import asyncio
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
from typing import Dict, Optional
import opencc

BASE = Path(__file__).parent.parent
JSON_OUTPUT = BASE / "assets" / "data" / "descriptions_zh.json"
POKEMON_DATA = BASE / "assets" / "data" / "pokemon_data.json"

# Rate limiting
DELAY = 0.5  # seconds between requests
MAX_RETRIES = 3
TIMEOUT = 20.0

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


def parse_portal_pokemon(html: str) -> Optional[Dict[str, str]]:
    """Parse tw.portal-pokemon.com/pokedex/{id}/ page for descriptions
    Returns dict with 'text1', 'text2' keys for the two description variants"""
    soup = BeautifulSoup(html, 'lxml')
    
    # 1. First try to extract from Next.js streaming data (contains both text1 and text2)
    # The data format in script can be either:
    # - Single-escaped: text1":"value"  (most common)
    # - Double-escaped: text1\\":\\"value\\"  (some pages)
    import re
    scripts = soup.find_all('script')
    for script in scripts:
        if script.string and 'text1' in script.string and 'text2' in script.string:
            content = script.string
            print(f"DEBUG: Found script with both text1 and text2, length={len(content)}")
            
            # Try both formats: single-escaped (text1":"value") and double-escaped (text1\\":\\"value\\")
            text1_match = re.search(r'text1":"([^"]*)"', content)
            text2_match = re.search(r'text2":"([^"]*)"', content)
            if not text1_match:
                text1_match = re.search(r'text1\\\\":\\\\"([^\\\\"]*)\\\\"', content)
            if not text2_match:
                text2_match = re.search(r'text2\\\\":\\\\"([^\\\\"]*)\\\\"', content)
            
            print(f"DEBUG: text1_match={text1_match is not None}, text2_match={text2_match is not None}")
            if text1_match and text2_match:
                print(f"DEBUG: MATCHED BOTH - returning")
                return {
                    'text1': text1_match.group(1),
                    'text2': text2_match.group(1)
                }
            print(f"DEBUG: Primary pattern failed, trying fallback")
            # Also try fallback pattern
            text1_match = re.search(r'"text1"\s*:\s*"([^"]*)"', content)
            text2_match = re.search(r'"text2"\s*:\s*"([^"]*)"', content)
            if text1_match and text2_match:
                return {
                    'text1': text1_match.group(1),
                    'text2': text2_match.group(1)
                }
            # Try to find the full pokemon object
            pokemon_match = re.search(r'"pokemon":(\{.*?\})', content)
            if pokemon_match:
                try:
                    pokemon_data = json.loads(pokemon_match.group(1))
                    return {
                        'text1': pokemon_data.get('text1', ''),
                        'text2': pokemon_data.get('text2', '')
                    }
                except json.JSONDecodeError:
                    pass
    
    # 2. Fallback to meta tags (official SEO description)
    for sel in ['meta[name="description"]', 'meta[property="og:description"]']:
        elem = soup.select_one(sel)
        if elem and elem.get('content'):
            text = elem['content'].strip()
            if text and len(text) > 20:
                return {'text1': text, 'text2': ''}
    
    # 3. Fallback to generic selectors
    selectors = [
        'main .pokemon-detail p',
        '.pokedex-pokemon__description p',
        '.pokemon-info__description p',
        'section.pokemon-detail p',
        'div.pokemon-detail p',
        '.pokemon-description p',
        '#pokemon-description',
    ]
    
    for sel in selectors:
        elem = soup.select_one(sel)
        if elem:
            text = elem.get_text(strip=True)
            if text and len(text) > 20:
                return {'text1': text, 'text2': ''}
    
    return None


def parse_52poke(html: str) -> Optional[str]:
    """Parse wiki.52poke.com page for 图鉴介绍 section"""
    soup = BeautifulSoup(html, 'lxml')
    
    # Find the 图鉴介绍 section - look for h2/h3 with this text
    headings = soup.find_all(['h2', 'h3', 'h4'])
    for h in headings:
        if '图鉴介绍' in h.get_text() or '圖鑑介紹' in h.get_text():
            current = h.next_sibling
            while current:
                if current.name == 'table':
                    desc = extract_description_from_table(current)
                    if desc:
                        return desc
                elif current.name and current.name.startswith('h'):
                    break
                current = current.next_sibling
    
    # Method 2: Direct table search
    tables = soup.find_all('table')
    for table in tables:
        text = table.get_text()
        if '图鉴介绍' in text or '圖鑑介紹' in text:
            desc = extract_description_from_table(table)
            if desc:
                return desc
    
    # Method 3: Search for the specific content pattern
    for elem in soup.find_all(string=True):
        text = elem.strip()
        if '从出生的时候开始' in text or '從出生的時候開始' in text:
            if len(text) > 20:
                return text
    
    return None


def extract_description_from_table(table) -> Optional[str]:
    """Extract description text from a table cell"""
    # Look for td with the description
    for td in table.find_all('td'):
        text = td.get_text(strip=True)
        if text and len(text) > 20:
            # Skip navigation/UI text
            if not text.startswith(('本條目', '關於', '参见', '跳转', '导航', '搜索', '移动', '命名空间', '页面', '讨论', '查看', '编辑', '历史')):
                # Check if it's a description (contains typical description words)
                if any(kw in text for kw in ['种子', '背上', '出生', '长大', '成长', '进化', '特性', '能力', '会', '会逐渐', '会随着']):
                    return text
    return None


async def scrape_pokemon(client: httpx.AsyncClient, pid: int, zh_name: str) -> Optional[Dict[str, str]]:
    """Scrape Chinese description for one Pokémon
    Returns dict with 'text1', 'text2' keys for the two description variants"""
    
    # Try portal-pokemon.com first (official TW site) - CORRECT URL
    url1 = f"https://tw.portal-pokemon.com/pokedex/{pid:04d}/"
    html = await fetch_page(client, url1)
    if html:
        desc = parse_portal_pokemon(html)
        if desc:
            return desc
    
    # Fallback to wiki.52poke.com - extract 图鉴介绍 section
    url2 = f"https://wiki.52poke.com/wiki/{zh_name}"
    html = await fetch_page(client, url2)
    if html:
        desc = parse_52poke(html)
        if desc:
            # Convert Simplified to Traditional Chinese
            return {'text1': converter.convert(desc), 'text2': ''}
    
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
                descriptions[str(pid)] = {"text1": "", "text2": ""}
                continue
            
            print(f"#{pid:04d} {zh_name}...", end=' ', flush=True)
            
            desc = await scrape_pokemon(client, pid, zh_name)
            
            if desc:
                descriptions[str(pid)] = desc
                total_chars = len(desc.get('text1', '')) + len(desc.get('text2', ''))
                print(f"✓ (text1: {len(desc.get('text1', ''))}, text2: {len(desc.get('text2', ''))})")
            else:
                descriptions[str(pid)] = {"text1": "", "text2": ""}
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
    filled = sum(1 for v in descriptions.values() if v.get('text1') or v.get('text2'))
    print(f"Filled: {filled}, Empty: {len(descriptions) - filled}")


if __name__ == '__main__':
    import json
    asyncio.run(main())